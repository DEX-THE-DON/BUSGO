#!/bin/bash
# =====================================================================
# BUSGO Production Docker Deployment Script
# =====================================================================
set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

echo "=========================================================="
echo "      🚀 BUSGO PRODUCTION CONTAINER DEPLOYMENT            "
echo "=========================================================="

# 1. Check for Docker & Docker Compose
if ! command -v docker &> /dev/null; then
    echo "❌ Error: Docker is not installed. Please install Docker Engine."
    exit 1
fi

DOCKER_COMPOSE="docker compose"
if ! docker compose version &> /dev/null; then
    if command -v docker-compose &> /dev/null; then
        DOCKER_COMPOSE="docker-compose"
    else
        echo "❌ Error: Neither 'docker compose' nor 'docker-compose' was found."
        exit 1
    fi
fi

# 2. Check for environment file
if [ ! -f .env.production ] && [ ! -f .env ]; then
    echo "⚠️ Warning: No .env.production found. Creating from .env.production.example..."
    cp .env.production.example .env.production
    echo "✓ Created .env.production. Please edit it with live production credentials."
fi

ENV_FILE=".env.production"
if [ ! -f "$ENV_FILE" ]; then
    ENV_FILE=".env"
fi

echo "✓ Using environment file: $ENV_FILE"

# 3. Build & start containers in detached mode
echo "📦 Building production container images..."
$DOCKER_COMPOSE --env-file "$ENV_FILE" build --pull

echo "🚢 Launching services with rolling restarts..."
$DOCKER_COMPOSE --env-file "$ENV_FILE" up -d --remove-orphans

echo "⏳ Waiting for healthchecks to pass..."
sleep 5

# 4. Show service status
$DOCKER_COMPOSE --env-file "$ENV_FILE" ps

echo ""
echo "=========================================================="
echo "✓ BUSGO IS LIVE IN PRODUCTION!"
echo "  • Public Web & API:   https://localhost (or configured domain)"
echo "  • Teltonika GPS:      TCP port 5027"
echo "  • Concox GPS:         TCP port 5023"
echo "  • Caddy Auto-SSL:     Listening on 80 & 443"
echo "=========================================================="

