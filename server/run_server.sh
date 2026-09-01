#!/bin/bash
# Starts the BUSGO TypeScript backend API server detached from the terminal.
set -e
cd "$(dirname "$0")/.."
export DATABASE_URL="${DATABASE_URL:-postgresql://postgres:DEX@localhost:5432/busgo_db}"
# Build the workspace once if it has not been compiled yet (both the server
# and the shared-types package must have their dist/ folders).
if [ ! -d server/dist ] || [ ! -d packages/types/dist ]; then
  npm install
  npm run build
fi
# Bind 0.0.0.0 so phones / other machines on the LAN can reach the API too
# (the frontend must then set NEXT_PUBLIC_API_URL to this machine's LAN IP).
exec setsid node server/dist/index.js >> /tmp/busgo_server.log 2>&1
