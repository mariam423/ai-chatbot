# AWS EC2 deployment

This project runs as a single Next.js process behind Nginx. PM2 keeps the
process alive and Nginx terminates TLS and preserves streaming responses.
The checked-in templates are:

- `ecosystem.config.cjs` — PM2 configuration used by the deploy script.
- `ecosystem.config.js` — conventional PM2 template for installations that
  load ecosystem files outside Node's ESM `require()` boundary.
- `scripts/deploy.sh` — fast-forward deploy, dependency install, Prisma
  migrations, production build, PM2 reload/start, and health verification.
- `nginx.conf.example` — HTTPS reverse proxy with SSE/WebSocket forwarding.

## 1. Create and secure the EC2 host

Use an Ubuntu 22.04/24.04 LTS instance with a security group allowing:

- TCP 22 from your administration IP only
- TCP 80 from the internet (Let's Encrypt and HTTP → HTTPS redirect)
- TCP 443 from the internet

Do not expose port 3000. The PM2 process binds to `127.0.0.1` and is reachable
only through Nginx.

Install the system packages and Node.js 20+ using your organization's approved
package source:

```bash
sudo apt update
sudo apt install -y git nginx curl certbot
node --version
npm --version
sudo npm install --global pm2
```

Clone the repository into a stable directory owned by the deploy user:

```bash
sudo mkdir -p /var/www/chatbot
sudo chown "$USER":"$USER" /var/www/chatbot
git clone <repository-url> /var/www/chatbot
cd /var/www/chatbot
npm install
```

## 2. Configure production environment

Create `.env.local` on the host and keep it out of Git. Use real production
values for the LLM, Auth.js, database, encryption, and Stripe settings. At a
minimum, set:

```env
NODE_ENV=production
DATABASE_URL="file:./prisma/dev.db"
AUTH_SECRET=<long-random-secret>
AUTH_TRUST_HOST=true
NEXT_PUBLIC_APP_URL=https://chat.example.com
OPENROUTER_API_KEY=<server-only-key>
ENCRYPTION_KEY=<stable-encryption-key>
AUTH_DISABLED=false
```

Add the OAuth and Stripe variables documented in `.env.example` when those
features are enabled. Never put provider secrets in `NEXT_PUBLIC_*` variables.
For a multi-instance deployment, use a hosted LibSQL database and Redis for
shared rate limits instead of the local SQLite file and in-memory limiter.

Apply migrations and build once before starting PM2:

```bash
npx prisma migrate deploy
npm run build
```

## 3. Configure PM2

The repository is an ESM package, so `ecosystem.config.cjs` is the file used by
the deployment script; PM2 loads it reliably through CommonJS. It starts two
processes:

**pulse-ai** (main app) — `next start` on `127.0.0.1:3000`:
- automatic crash restarts and a 5-second restart delay
- a 512 MB memory restart ceiling
- bounded unstable-restart protection
- graceful reload/termination timeouts
- production environment variables and merged timestamped logs

**pulse-ai-worker** (background task processor) — handles BullMQ jobs:
- document RAG post-processing, Stripe webhook side-effects, cache invalidation
- 256 MB memory ceiling, 3-second restart delay
- requires `REDIS_URL` to be set; exits immediately otherwise
- 5 concurrent jobs, rate-limited to 30/sec

Start both and configure boot persistence:

```bash
cd /var/www/pulse-ai
pm2 start ecosystem.config.cjs --env production --update-env
pm2 save
pm2 startup systemd
# Run the sudo command printed by `pm2 startup`, then:
pm2 save
```

To start only the main app (no worker):
```bash
pm2 start ecosystem.config.cjs --only pulse-ai --env production --update-env
```

To start only the worker:
```bash
pm2 start ecosystem.config.cjs --only pulse-ai-worker --env production --update-env
```

The health endpoint is available locally at
`http://127.0.0.1:3000/api/health`. It returns `200` only when the application
and database readiness check succeed; database failure returns `503` without
including internal error details.

## 4. Configure Nginx

Replace `example.com` in `nginx.conf.example` with the real hostname. The
configuration includes the HTTP challenge/redirect server and the HTTPS
server. Obtain the certificate before enabling the HTTPS server block:

```bash
sudo mkdir -p /var/www/certbot
sudo systemctl stop nginx
sudo certbot certonly --standalone \
  --non-interactive --agree-tos \
  --email ops@example.com \
  -d chat.example.com -d www.chat.example.com
sudo systemctl start nginx
```

Copy the template and update the certificate paths/domain if needed:

```bash
sudo cp nginx.conf.example /etc/nginx/conf.d/chatbot.conf
sudo sed -i 's/example.com/chat.example.com/g' /etc/nginx/conf.d/chatbot.conf
sudo nginx -t
sudo systemctl reload nginx
```

If DNS for the hostname is not live yet, Certbot's standalone challenge will
fail. Create the DNS A/AAAA records first and ensure the security group allows
TCP 80. Certbot installs a renewal timer; verify it with:

```bash
sudo certbot renew --dry-run
```

The Nginx template disables proxy buffering, cache, request buffering, and
response compression for the proxied stream. It forwards HTTP/1.1 Upgrade and
Connection headers for WebSockets, allows long-lived SSE reads, and retains the
application's `Retry-After` responses. It also applies HSTS, CSP,
clickjacking, MIME-sniffing, referrer, permissions, and proxy rate-limit
headers.

## 5. Deploy updates

Run deployments as the application user from the repository directory. The
script requires the working tree to be cleanly on `main` and uses a lock to
prevent concurrent deployments:

```bash
cd /var/www/chatbot
chmod +x scripts/deploy.sh
APP_DIR=/var/www/chatbot DEPLOY_BRANCH=main ./scripts/deploy.sh
```

The script performs, in order:

1. `git pull --ff-only origin main`
2. `npm install`
3. `npx prisma migrate deploy`
4. `npm run build`
5. PM2 reload (or initial start) with updated environment
6. `pm2 save`
7. Retried `/api/health` check

A failed migration or build stops the script before PM2 is reloaded. Keep the
previous process running until the new build has completed successfully.

## 6. Monitoring and operations

Useful commands:

```bash
pm2 status
pm2 logs chatbot --lines 100
pm2 monit
curl --fail https://chat.example.com/api/health
sudo nginx -t
sudo journalctl -u nginx -n 100 --no-pager
```

The health response intentionally contains only `status`, check names, and a
timestamp. Configure an external monitor or an ALB target check against
`/api/health`; alert on non-200 responses and on repeated PM2 restarts.
