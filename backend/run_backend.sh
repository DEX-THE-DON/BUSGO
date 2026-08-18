#!/bin/bash
# Starts the BUSGO backend API server detached from the terminal.
cd /home/denno/Documents/PROJECT/busgo-project
export DATABASE_URL="${DATABASE_URL:-postgresql+asyncpg://postgres:DEX@localhost:5432/busgo_db}"
exec setsid backend/venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 >> /tmp/busgo_uvicorn.log 2>&1
