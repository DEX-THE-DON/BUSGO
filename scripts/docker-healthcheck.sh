#!/bin/bash
# =====================================================================
# BUSGO Production Container Healthcheck Inspector
# =====================================================================

set -e
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

echo "=== Checking BUSGO Container Health ==="

# Check backend health endpoint
echo -n "• Backend API (http://localhost:8000/api/health): "
if curl -s -f http://localhost:8000/api/health > /dev/null 2>&1; then
    echo "✓ ONLINE (HTTP 200)"
else
    echo "❌ OFFLINE or UNREACHABLE"
fi

# Check frontend
echo -n "• Frontend Web (http://localhost:3000): "
if curl -s -f http://localhost:3000 > /dev/null 2>&1; then
    echo "✓ ONLINE (HTTP 200)"
else
    echo "❌ OFFLINE or UNREACHABLE"
fi

# Check Teltonika GPS TCP Port 5027
echo -n "• Teltonika GPS TCP Listener (Port 5027): "
if nc -z localhost 5027 2>/dev/null; then
    echo "✓ LISTENING"
else
    echo "❌ CLOSED or UNBOUND"
fi

# Check Concox GT06 GPS TCP Port 5023
echo -n "• Concox GPS TCP Listener (Port 5023): "
if nc -z localhost 5023 2>/dev/null; then
    echo "✓ LISTENING"
else
    echo "❌ CLOSED or UNBOUND"
fi

echo "=== Healthcheck Complete ==="

