// CommonJS is intentional: package.json declares the application as ESM,
// while PM2 loads ecosystem files through require().
module.exports = {
  apps: [
    {
      name: 'chatbot',
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
  ],
}
