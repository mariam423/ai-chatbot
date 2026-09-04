#!/usr/bin/env bash
set -Eeuo pipefail

# Deploy the checked-out application on a single EC2 host.
# Required tools: git, node/npm, curl, Prisma (via npm), and PM2.

APP_DIR="${APP_DIR:-$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"
APP_NAME="${APP_NAME:-pulse-ai}"
WORKER_NAME="${WORKER_NAME:-pulse-ai-worker}"
PM2_CONFIG="${PM2_CONFIG:-ecosystem.config.cjs}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/api/health}"
LOCK_DIR="${DEPLOY_LOCK_DIR:-/tmp/${APP_NAME}.deploy.lock}"

log() {
  printf '[deploy] %s\n' "$*"
}

cleanup() {
  rmdir "$LOCK_DIR" 2>/dev/null || true
}
trap cleanup EXIT

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  printf '[deploy] another deployment is already running (%s)\n' "$LOCK_DIR" >&2
  exit 1
fi

cd "$APP_DIR"

if [[ ! -f package-lock.json ]]; then
  printf '[deploy] package-lock.json is required for a reproducible deployment\n' >&2
  exit 1
fi
if [[ ! -f "$PM2_CONFIG" ]]; then
  printf '[deploy] PM2 config not found: %s\n' "$PM2_CONFIG" >&2
  exit 1
fi

current_branch="$(git branch --show-current)"
if [[ "$current_branch" != "$DEPLOY_BRANCH" ]]; then
  printf '[deploy] expected branch %q, found %q\n' "$DEPLOY_BRANCH" "$current_branch" >&2
  exit 1
fi

log "pulling ${DEPLOY_BRANCH}"
git pull --ff-only origin "$DEPLOY_BRANCH"

log 'installing dependencies'
npm install

log 'applying Prisma migrations'
npx prisma migrate deploy

log 'building Next.js production bundle'
npm run build

if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  log "reloading PM2 processes"
  pm2 reload "$APP_NAME" --env production --update-env 2>/dev/null || true
  pm2 reload "$WORKER_NAME" --env production --update-env 2>/dev/null || true
else
  log "starting PM2 processes from ${PM2_CONFIG}"
  pm2 start "$PM2_CONFIG" --env production --update-env
fi

pm2 save

log "checking ${HEALTH_URL}"
curl --fail --silent --show-error --retry 10 --retry-delay 2 --max-time 10 "$HEALTH_URL" >/dev/null
log 'deployment completed successfully'
