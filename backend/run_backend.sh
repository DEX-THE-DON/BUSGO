#!/bin/bash
# Starts the BUSGO backend API server detached from the terminal.
cd /home/denno/Documents/PROJECT/busgo-project
export DATABASE_URL="${DATABASE_URL:-postgresql+asyncpg://postgres:DEX@localhost:5432/busgo_db}"
# Bind 0.0.0.0 so phones / other machines on the LAN can reach the API too
# (the frontend must then set NEXT_PUBLIC_API_URL to this machine's LAN IP).
exec setsid backend/venv/bin/python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 >> /tmp/busgo_uvicorn.log 2>&1
