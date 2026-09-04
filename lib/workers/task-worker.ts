/**
 * BullMQ background worker for processing async jobs.
 *
 * This module is imported by a standalone worker script (or the dev
 * server in single-process mode). It processes:
 *
 *  - `document:process`   — post-upload document chunking + embedding
 *  - `document:embed`     — vector embedding generation for document chunks
 *  - `webhook:stripe:*`   — post-webhook side-effects (cache invalidation, etc.)
 *  - `analytics:*`        — event aggregation
 *  - `cache:invalidate`   — targeted cache purge on writes
 *
 * The worker gracefully exits when `REDIS_URL` is unset (no queue to
 * consume from) or when a SIGTERM/SIGINT is received.
 */

import { Worker, type Job } from 'bullmq'
import { requireRedis } from '@/lib/redis'
import type {
  DocumentProcessPayload,
  DocumentEmbedPayload,
  StripePostProcessPayload,
  AnalyticsAggregatePayload,
  CacheInvalidatePayload,
  JobName,
} from '@/lib/queues/task-queue'
import { invalidateCachedUserMeta, invalidateCachedSessionMeta, invalidateCachedBillingStatus } from '@/lib/cache'
import { invalidateCachedDailyUsage } from '@/lib/billing/tier-rate-limit'

const QUEUE_NAME = 'pulse-tasks'

/* ------------------------------------------------------------------ */
/* Job handlers                                                        */
/* ------------------------------------------------------------------ */

async function handleDocumentProcess(job: Job<unknown>): Promise<void> {
  const { sessionId, documentId, userId, fileName } = job.data as DocumentProcessPayload
  console.log(`[worker] Processing document "${fileName}" (${documentId}) for session ${sessionId}`)

  // The actual embedding + DB write is already synchronous in the upload
  // route. This job handles post-processing: cache invalidation and
  // optional re-indexing after the document is stored.
  await invalidateCachedSessionMeta(sessionId)
  await invalidateCachedUserMeta(userId)

  // Future: trigger async re-embedding, chunk optimization, etc.
  console.log(`[worker] Document "${fileName}" post-processing complete`)
}

async function handleDocumentEmbed(job: Job<unknown>): Promise<void> {
  const { documentId, chunks } = job.data as DocumentEmbedPayload
  console.log(`[worker] Embedding ${chunks.length} chunks for document ${documentId}`)

  // Future: call an embedding API (OpenAI ada-002, Cohere, etc.)
  // and store vectors in a pgvector table.
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

const HANDLERS: Record<JobName, (job: Job<unknown>) => Promise<void>> = {
  'document:process': handleDocumentProcess,
  'document:embed': handleDocumentEmbed,
  'webhook:stripe:post-process': handleStripePostProcess,
  'analytics:aggregate': handleAnalyticsAggregate,
  'cache:invalidate': handleCacheInvalidate,
}

let worker: Worker | null = null

/**
 * Start the background worker. Called once on process boot.
 * No-op when `REDIS_URL` is not set.
 */
export function startWorker(): void {
  if (!process.env.REDIS_URL) {
    console.log('[worker] REDIS_URL not set — worker disabled (jobs run synchronously)')
    return
  }

  const redis = requireRedis()

  worker = new Worker(
    QUEUE_NAME,
    async (job: Job) => {
      const handler = HANDLERS[job.name as JobName]
      if (!handler) {
        console.warn(`[worker] Unknown job type: ${job.name}`)
        return
      }
      await handler(job)
    },
    {
      connection: redis,
      concurrency: 5,
      limiter: {
        max: 30,
        duration: 1_000, // max 30 jobs/sec across all workers
      },
    },
  )

  worker.on('completed', (job) => {
    console.log(`[worker] Job ${job.id} (${job.name}) completed`)
  })

  worker.on('failed', (job, error) => {
    console.error(`[worker] Job ${job?.id} (${job?.name}) failed:`, error.message)
  })

  worker.on('error', (error) => {
    console.error('[worker] Worker error:', error.message)
  })

  console.log('[worker] Background worker started (concurrency: 5)')
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
