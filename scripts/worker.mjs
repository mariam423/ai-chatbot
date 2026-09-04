/**
 * Standalone worker entry point — run alongside the Next.js app server.
 *
 * Usage:
 *   npm run worker          # = npx tsx scripts/worker.mjs
 *   pm2 start ecosystem.config.cjs --only pulse-ai-worker
 *
 * tsx is required: the worker imports TypeScript modules that use the `@/`
 * path alias (tsconfig paths), which plain Node cannot resolve. In
 * production, run this as a separate process (PM2, systemd, Docker) with
 * the same environment as the app server.
 *
 * Requires REDIS_URL to be set (otherwise the worker is a no-op).
 *
 * Environment: the worker is a plain Node process (unlike the Next app, it
 * never loads .env files itself), so this entry point loads `.env.local`
 * (then `.env`) exactly like the app does — real process env (e.g. PM2
 * env_production) always wins, and `.env.local` beats `.env` for anything
 * still unset.
 */

import dotenv from 'dotenv'

// quiet: true keeps dotenv's "nothing loaded" tips out of PM2 logs when
// one of the files is absent (the normal single-file case).
dotenv.config({ path: '.env.local', quiet: true })
dotenv.config({ quiet: true })

import { startWorker, stopWorker } from '../lib/workers/task-worker.ts'

startWorker()

const shutdown = async () => {
  console.log('[worker] Shutting down...')
  await stopWorker()
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
