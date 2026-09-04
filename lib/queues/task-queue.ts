/**
 * BullMQ task queue for dispatching background jobs.
 *
 * Heavy, non-blocking work (document RAG processing, Stripe webhook
 * side-effects, analytics aggregation) is offloaded here so the API
 * route returns immediately. Workers process jobs asynchronously in
 * separate processes (or the same process in dev via the inline worker).
 *
 * The queue is env-gated: when `REDIS_URL` is unset, `addTask` is a
 * no-op that returns a dummy id — the caller should fall back to
 * synchronous processing in that case.
 */

import { Queue, type JobOptions } from 'bullmq'
import { createBullMqConnection } from '@/lib/redis'

/* ------------------------------------------------------------------ */
/* Job type definitions                                                */
/* ------------------------------------------------------------------ */

export type JobName =
  | 'document:process'
  | 'document:embed'
  | 'webhook:stripe:post-process'
  | 'analytics:aggregate'
  | 'cache:invalidate'

export interface DocumentProcessPayload {
  sessionId: string
  documentId: string
  userId: string
  /** Original file name for logging. */
  fileName: string
  /**
   * Extracted document text, present on the large-document offload path.
   * The worker then chunks, embeds, and persists the chunk rows; when
   * absent the job is post-processing only (cache invalidation) — the
   * upload route already stored everything synchronously.
   */
  text?: string
}

export interface DocumentEmbedPayload {
  documentId: string
  chunks: Array<{ chunkIndex: number; content: string }>
}

export interface StripePostProcessPayload {
  userId: string
  eventType: string
  /** Stripe subscription id when applicable. */
  subscriptionId?: string
}

export interface AnalyticsAggregatePayload {
  userId: string
  event: string
  metadata?: Record<string, unknown>
}

export interface CacheInvalidatePayload {
  pattern: string
  userId?: string
}

/** Discriminated union of all job payloads. */
export type JobPayload =
  | { name: 'document:process'; data: DocumentProcessPayload }
  | { name: 'document:embed'; data: DocumentEmbedPayload }
  | { name: 'webhook:stripe:post-process'; data: StripePostProcessPayload }
  | { name: 'analytics:aggregate'; data: AnalyticsAggregatePayload }
  | { name: 'cache:invalidate'; data: CacheInvalidatePayload }

/* ------------------------------------------------------------------ */
/* Queue singleton                                                     */
/* ------------------------------------------------------------------ */

const QUEUE_NAME = 'pulse-tasks'

let queue: Queue | null = null

/**
 * Get or create the shared BullMQ queue. Requires `REDIS_URL`.
 * In dev, the queue and worker share the same process; in production
 * they run in separate worker processes.
 */
function getQueue(): Queue | null {
  if (queue) return queue
  if (!process.env.REDIS_URL) return null

  try {
    const redis = createBullMqConnection()
    queue = new Queue(QUEUE_NAME, {
      connection: redis,
      defaultJobOptions: {
        removeOnComplete: { age: 86_400, count: 1_000 }, // keep 24h or 1k jobs
        removeOnFail: { age: 604_800, count: 5_000 }, // keep 7d of failures
        attempts: 3,
        backoff: { type: 'exponential', delay: 2_000 },
      },
    })
    return queue
  } catch (error) {
    console.warn('[task-queue] Failed to create queue:', error)
    return null
  }
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Add a job to the task queue. Returns the job id, or `null` when
 * Redis is unavailable (caller should process synchronously as fallback).
 *
 * ```ts
 * const jobId = await addTask('document:process', {
 *   sessionId, documentId, userId, fileName,
 * })
 * if (!jobId) {
 *   // Redis unavailable — process synchronously
 *   await processDocumentSync(payload)
 * }
 * ```
 */
export async function addTask<N extends JobName>(
  name: N,
  data: Extract<JobPayload, { name: N }>['data'],
  options?: Partial<JobOptions>,
): Promise<string | null> {
  const q = getQueue()
  if (!q) return null

  try {
    const job = await q.add(name, data as unknown as Record<string, unknown>, options)
    return job.id ?? null
  } catch (error) {
    console.error(`[task-queue] Failed to add job "${name}":`, error)
    return null
  }
}

/**
 * Get queue metrics (for admin / debug endpoints).
 */
export async function getQueueMetrics(): Promise<{
  waiting: number
  active: number
  completed: number
  failed: number
  delayed: number
} | null> {
  const q = getQueue()
  if (!q) return null

  try {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      q.getWaitingCount(),
      q.getActiveCount(),
      q.getCompletedCount(),
      q.getFailedCount(),
      q.getDelayedCount(),
    ])
    return { waiting, active, completed, failed, delayed }
  } catch {
    return null
  }
}

/**
 * Graceful shutdown — close the queue connection.
 */
export async function closeTaskQueue(): Promise<void> {
  if (queue) {
    await queue.close().catch(() => {})
    queue = null
  }
}
