#!/usr/bin/env bash
# Starts the local dev Postgres container (docker-compose.yml) and waits for it to report
# healthy before returning — apps/api's DATABASE_URL/APP_DATABASE_URL (localhost:5433) and
# apps/web's dev flow assume this is already up before you run `pnpm dev`.
set -euo pipefail
cd "$(dirname "$0")/.."

docker compose up -d --wait postgres

echo ""
echo "Postgres is up on localhost:5433 (db: tm_dev, user: tm)."
echo "Next: pnpm dev (from repo root) to start apps/api and apps/web."
