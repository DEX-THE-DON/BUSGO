#!/bin/bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"

echo "=== 1. Starting Workspace PostgreSQL Instance ==="
# Stop any existing pg_ctl running on db_data
/usr/lib/postgresql/18/bin/pg_ctl -D "$DIR/db_data" -m fast stop 2>/dev/null || true

# Start postgres in background
/usr/lib/postgresql/18/bin/postgres -D "$DIR/db_data" -k "$DIR/db_data" -p 5432 &
PG_PID=$!
echo "PostgreSQL started with PID $PG_PID"

# Wait until postgres is ready
echo "Waiting for PostgreSQL to be ready..."
for i in {1..20}; do
    if /usr/lib/postgresql/18/bin/pg_isready -h "$DIR/db_data" -p 5432 >/dev/null 2>&1; then
        echo "✓ PostgreSQL is ready on port 5432!"
        break
    fi
    sleep 0.5
done

# Create busgo_db if it doesn't exist
/usr/lib/postgresql/18/bin/createdb -h "$DIR/db_data" -U postgres busgo_db 2>/dev/null || echo "Database busgo_db already exists or created."

echo "=== 2. Starting BUSGO FastAPI Backend (Port 8000) ==="
export DATABASE_URL="postgresql+asyncpg://postgres@127.0.0.1:5432/busgo_db"

# Kill anything on port 8000
fuser -k 8000/tcp 2>/dev/null || true

# Start FastAPI Uvicorn server
exec ./backend/venv/bin/python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
