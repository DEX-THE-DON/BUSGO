#!/bin/bash
set -e

echo "=========================================="
echo "   BUSGO LOCAL DEV ENVIRONMENT LAUNCHER   "
echo "=========================================="

echo "[1/3] Checking PostgreSQL service..."
if ! sudo systemctl start postgresql; then
    echo "❌ Failed to start postgresql via systemctl."
    echo "Checking cluster status:"
    pg_lsclusters
    echo "Attempting pg_ctlcluster:"
    sudo pg_ctlcluster 18 main start
fi

echo "[2/3] Verifying database connection on port 5432..."
until pg_isready -h localhost -p 5432 >/dev/null 2>&1; do
    echo "Waiting for PostgreSQL to accept connections..."
    sleep 1
done
echo "✓ PostgreSQL is ONLINE and ready!"

echo "[3/3] Starting BUSGO Backend API on http://localhost:8000..."
cd /home/denno/Documents/PROJECT/busgo-project
export DATABASE_URL="${DATABASE_URL:-postgresql+asyncpg://postgres:DEX@localhost:5432/busgo_db}"

# Free port 8000 if occupied
fuser -k 8000/tcp 2>/dev/null || true

echo "✓ Starting Uvicorn (FastAPI)..."
exec ./backend/venv/bin/python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload

