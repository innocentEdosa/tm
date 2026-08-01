#!/usr/bin/env bash
# Stops the local dev Postgres container. By default the `postgres_data` volume is kept, so
# your local dev DB survives across restarts — pass --volumes (or -v) to wipe it for a clean slate.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ "${1:-}" == "--volumes" || "${1:-}" == "-v" ]]; then
  echo "Stopping Postgres and deleting its data volume (tm_dev will be empty on next start)..."
  docker compose down --volumes
else
  docker compose down
fi

echo "Postgres stopped."
