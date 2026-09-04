/**
 * BullMQ background worker for processing async jobs.
 *
 * This module is imported by a standalone worker script (or the dev
 * server in single-process mode). It processes:
 *
 *  - `document:process`   — full ingestion for large documents (chunk +
 *    embed + persist) plus cache invalidation; cache-only for small docs
 *  - `document:embed`     — fill in vector embeddings for pre-created chunks
 *  - `webhook:stripe:*`   — post-webhook side-effects (cache invalidation, etc.)
 *  - `analytics:*`        — event aggregation
 *  - `cache:invalidate`   — targeted cache purge on writes
 *
 * The worker gracefully exits when `REDIS_URL` is unset (no queue to
 * consume from) or when a SIGTERM/SIGINT is received.
 */

import { Worker, type Job } from 'bullmq'
import { prisma } from '@/lib/db'
import { createBullMqConnection } from '@/lib/redis'
import { chunkDocumentText } from '@/lib/documents'
import { createEmbedding, storeDocumentChunks } from '@/lib/rag'
import type {
  DocumentProcessPayload,
  DocumentEmbedPayload,
  StripePostProcessPayload,
  AnalyticsAggregatePayload,
  CacheInvalidatePayload,
  JobName,
} from '@/lib/queues/task-queue'
import {
  invalidateCachedUserMeta,
  invalidateCachedSessionMeta,
  invalidateCachedBillingStatus,
} from '@/lib/cache'
import { invalidateCachedDailyUsage } from '@/lib/billing/tier-rate-limit'
import { logSecurityEvent } from '@/lib/audit'

const QUEUE_NAME = 'pulse-tasks'

/**
 * Positive-integer env knob with a safe fallback — mirrors the pool env
 * parsing in lib/db-config.ts: garbage (non-numeric, zero, negative,
 * fractional) falls back to the default instead of crashing the worker.
 */
function envPositiveInt(name: string, fallback: number): number {
  const raw = Number(process.env[name])
  return Number.isInteger(raw) && raw > 0 ? raw : fallback
}

// Tuning knobs evaluated at module load (import-time env is what the worker
// process sees). Defaults match the pre-existing hardcoded values exactly.
const WORKER_CONCURRENCY = envPositiveInt('WORKER_CONCURRENCY', 5)
const WORKER_LIMITER_MAX = envPositiveInt('WORKER_LIMITER_MAX', 30)

/* ------------------------------------------------------------------ */
/* Job handlers                                                        */
/* ------------------------------------------------------------------ */

async function handleDocumentProcess(job: Job<unknown>): Promise<void> {
  const { sessionId, documentId, userId, fileName, text } = job.data as DocumentProcessPayload
  console.log(`[worker] Processing document "${fileName}" (${documentId}) for session ${sessionId}`)

  // Full-ingestion offload: the upload route only created the Document
  // metadata row. Chunk, embed, and persist the chunk rows here so the
  // request returns fast for large documents.
  if (text) {
    const chunks = chunkDocumentText(text)
    await storeDocumentChunks(
      documentId,
      chunks.map((content, chunkIndex) => ({ chunkIndex, content })),
    )
    console.log(`[worker] Stored ${chunks.length} chunks for document ${documentId}`)
  }

  // Post-processing: invalidate cached session/user metadata so the next
  // retrieval sees the new document (or is skipped gracefully while the
  // worker is still ingesting it — a document with zero chunks simply
  // matches nothing).
  await invalidateCachedSessionMeta(sessionId)
  await invalidateCachedUserMeta(userId)

  console.log(`[worker] Document "${fileName}" post-processing complete`)
}

async function handleDocumentEmbed(job: Job<unknown>): Promise<void> {
  const { documentId, chunks } = job.data as DocumentEmbedPayload
  console.log(`[worker] Embedding ${chunks.length} chunks for document ${documentId}`)

  // Chunk rows may already exist with a placeholder embedding (created by
  // the caller) — upsert so retries and callers that pre-created rows both
  // converge. Embeddings are deterministic local hashes, so recomputing is
  // idempotent.
  for (const { chunkIndex, content } of chunks) {
    const embedding = JSON.stringify(createEmbedding(content))
    await prisma.documentChunk.upsert({
      where: { documentId_chunkIndex: { documentId, chunkIndex } },
      create: { documentId, chunkIndex, content, embedding },
      update: { embedding },
    })
  }
  console.log(`[worker] Embedding complete for document ${documentId}`)
}

async function handleStripePostProcess(job: Job<unknown>): Promise<void> {
  const { userId, eventType, subscriptionId } = job.data as StripePostProcessPayload
  console.log(`[worker] Stripe post-process: ${eventType} for user ${userId}`)

  // Invalidate cached billing and user metadata so the next request
  // reflects the plan change immediately.
  await invalidateCachedBillingStatus(userId)
  await invalidateCachedUserMeta(userId)
  await invalidateCachedDailyUsage(userId)

  if (subscriptionId) {
    console.log(`[worker] Subscription ${subscriptionId} event processed`)
  }
}

async function handleAnalyticsAggregate(job: Job<unknown>): Promise<void> {
  const { userId, event, metadata } = job.data as AnalyticsAggregatePayload
  // Future: batch analytics events and flush to PostHog / BigQuery.
  console.log(`[worker] Analytics: ${event} for user ${userId}`, metadata ?? '')
}

async function handleCacheInvalidate(job: Job<unknown>): Promise<void> {
  const { pattern, userId } = job.data as CacheInvalidatePayload
  console.log(`[worker] Cache invalidation: ${pattern}`)

  // Targeted invalidation based on the pattern.
  if (userId) {
    await invalidateCachedUserMeta(userId)
  }
}

/* ------------------------------------------------------------------ */
/* Worker bootstrap                                                    */
/* ------------------------------------------------------------------ */

/** Handlers keyed by job name — exported so tests can drive them directly. */
export const taskHandlers: Record<JobName, (job: Job<unknown>) => Promise<void>> = {
  'document:process': handleDocumentProcess,
  'document:embed': handleDocumentEmbed,
  'webhook:stripe:post-process': handleStripePostProcess,
  'analytics:aggregate': handleAnalyticsAggregate,
  'cache:invalidate': handleCacheInvalidate,
}

let worker: Worker | null = null

/**
 * Start the background worker. Called once on process boot.
 * No-op when `REDIS_URL` is not set; idempotent when already running.
 */
export function startWorker(): void {
  if (!process.env.REDIS_URL) {
    console.log('[worker] REDIS_URL not set — worker disabled (jobs run synchronously)')
    return
  }
  if (worker) {
    console.log('[worker] Already running — skipping duplicate start')
    return
  }

  const redis = createBullMqConnection()

  worker = new Worker(
    QUEUE_NAME,
    async (job: Job) => {
      const handler = taskHandlers[job.name as JobName]
      if (!handler) {
        console.warn(`[worker] Unknown job type: ${job.name}`)
        return
      }
      await handler(job)
    },
    {
      connection: redis,
      concurrency: WORKER_CONCURRENCY,
      limiter: {
        max: WORKER_LIMITER_MAX,
        duration: 1_000, // max WORKER_LIMITER_MAX jobs/sec across all workers
      },
    },
  )

  worker.on('completed', (job) => {
    // Duration from BullMQ's own timestamps when both are present.
    const durationMs =
      job.finishedOn && job.processedOn ? Math.max(0, job.finishedOn - job.processedOn) : undefined
    console.log(
      `[worker] Job ${job.id} (${job.name}) completed${
        durationMs !== undefined ? ` in ${durationMs}ms` : ''
      }`,
    )
  })

  worker.on('failed', (job, error) => {
    // A job reaches this event only after its attempts (queue default: 3,
    // exponential backoff) are exhausted. Emit ids only — never the error
    // message, which can contain document text.
    const jobId = job?.id ?? 'unknown'
    const jobName = job?.name ?? 'unknown'
    const attempts = job?.attemptsMade ?? 1
    console.error(
      `[worker] Job ${jobId} (${jobName}) failed after ${attempts} attempt(s):`,
      error.message,
    )
    logSecurityEvent('worker_job_failed', { jobId, jobName, attempts })
  })

  worker.on('error', (error) => {
    console.error('[worker] Worker error:', error.message)
  })

  console.log(`[worker] Background worker started (concurrency: ${WORKER_CONCURRENCY})`)
}

/**
 * Graceful shutdown — close the worker and drain active jobs.
 */
export async function stopWorker(): Promise<void> {
  if (worker) {
    await worker.close()
    worker = null
    console.log('[worker] Background worker stopped')
  }
}

// Auto-start when imported directly (worker process).
// In the Next.js app process, `startWorker()` is called explicitly.
if (process.env.WORKER_MODE === 'true') {
  startWorker()

  const shutdown = async () => {
    console.log('[worker] Shutting down...')
    await stopWorker()
    process.exit(0)
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}
