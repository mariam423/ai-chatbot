/**
 * Standable worker entry point — run alongside the Next.js app server.
 *
 * Usage:
 *   WORKER_MODE=true node scripts/worker.mjs
 *
 * In production, run this as a separate process (PM2, systemd, Docker).
 * In development, the worker auto-starts when imported with WORKER_MODE=true.
 *
 * Requires REDIS_URL to be set.
 */

import '../lib/workers/task-worker.js'
import { startWorker, stopWorker } from '../lib/workers/task-worker.js'

startWorker()

const shutdown = async () => {
  console.log('[worker] Shutting down...')
  await stopWorker()
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
