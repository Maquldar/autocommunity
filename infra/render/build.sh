#!/usr/bin/env bash
# Render build for the single-service demo (web + API in one container). See DEPLOY.md.
set -euo pipefail
cd "$(dirname "$0")/../.."

PNPM="npx --yes pnpm@10.0.0"
# Dev dependencies (Nest CLI, TypeScript, Tailwind) are needed to build.
NODE_ENV=development $PNPM install --frozen-lockfile
$PNPM --filter @autoc/shared build
$PNPM --filter @autoc/api build
# The browser talks to the web origin only; Next proxies /api/v1 and /media to the API on localhost.
NEXT_PUBLIC_API_URL=/ API_PROXY_TARGET=http://127.0.0.1:4000 $PNPM --filter @autoc/web build
