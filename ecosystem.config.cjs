// CommonJS is intentional: package.json declares the application as ESM,
// while PM2 loads ecosystem files through require().
//
// Usage:
//   pm2 start ecosystem.config.cjs                # start app + worker
//   pm2 start ecosystem.config.cjs --only pulse-ai # start app only
//   pm2 start ecosystem.config.cjs --only pulse-ai-worker # start worker only
module.exports = {
  apps: [
    {
      name: 'pulse-ai',
      cwd: __dirname,
      script: 'node_modules/next/dist/bin/next',
      args: 'start',
      interpreter: 'node',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 5000,
      kill_timeout: 5000,
      listen_timeout: 10000,
      time: true,
      merge_logs: true,
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
        HOSTNAME: '127.0.0.1',
      },
    },
    {
      // Background task worker — processes BullMQ jobs (document RAG,
      // Stripe webhook side-effects, cache invalidation). Only runs
      // when REDIS_URL is set; exits immediately otherwise.
      name: 'pulse-ai-worker',
      cwd: __dirname,
      script: 'scripts/worker.mjs',
      interpreter: 'node',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '256M',
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 3000,
      kill_timeout: 5000,
      listen_timeout: 5000,
      time: true,
      merge_logs: true,
      env_production: {
        NODE_ENV: 'production',
        WORKER_MODE: 'true',
      },
    },
  ],
}
