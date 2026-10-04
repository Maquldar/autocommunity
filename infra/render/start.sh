#!/usr/bin/env bash
# Starts the API (internal port 4000) and the web app (Render's $PORT) in one container.
# If either process exits, the container exits so Render restarts it.
set -euo pipefail
cd "$(dirname "$0")/../.."

export NODE_ENV=production
# RENDER_EXTERNAL_URL is set by Render for every web service (https://<name>.onrender.com).
export WEB_ORIGIN="${WEB_ORIGIN:-${RENDER_EXTERNAL_URL:?WEB_ORIGIN or RENDER_EXTERNAL_URL must be set}}"

(
  cd apps/api
  npx prisma migrate deploy
  npx tsx prisma/seed/index.ts --if-empty
  # The free plan has 512 MB for both processes; cap each heap so neither can starve the other.
  API_PORT=4000 exec node --max-old-space-size=160 dist/main.js
) &

(
  cd apps/web
  NODE_OPTIONS="--max-old-space-size=224" exec npx next start -p "${PORT:-3000}" -H 0.0.0.0
) &

wait -n
exit 1
