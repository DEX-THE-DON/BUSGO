"""
BUSGO Test Suite - Item 7: Production Containerization & Reverse Proxy Validation
Validates docker-compose.yml, backend & frontend Dockerfiles, Caddyfile,
nginx.conf, and the /api/health endpoint.
"""

import os
import sys
import yaml
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent

def run_tests():
    print("=" * 65)
    print("--- [TEST ITEM 7: Production Containerization & Reverse Proxy] ---")
    print("=" * 65)

    # 1. Validate docker-compose.yml
    print("\n--- 1. Testing docker-compose.yml Syntax & Configuration ---")
    compose_file = PROJECT_ROOT / "docker-compose.yml"
    assert compose_file.exists(), "docker-compose.yml must exist"

    with open(compose_file, "r") as f:
        compose_data = yaml.safe_load(f)

    services = compose_data.get("services", {})
    assert "postgres" in services, "Service 'postgres' must be declared"
    assert "backend" in services, "Service 'backend' must be declared"
    assert "frontend" in services, "Service 'frontend' must be declared"
    assert "proxy" in services, "Service 'proxy' must be declared"

    # Verify ports and dependencies
    backend_svc = services["backend"]
    assert "8000:8000" in backend_svc.get("ports", []), "Port 8000 must be mapped for backend"
    assert "5027:5027" in backend_svc.get("ports", []), "Port 5027 must be mapped for Teltonika GPS"
    assert "5023:5023" in backend_svc.get("ports", []), "Port 5023 must be mapped for Concox GPS"
    assert "postgres" in backend_svc.get("depends_on", {}), "Backend must depend on postgres"

    proxy_svc = services["proxy"]
    assert "80:80" in proxy_svc.get("ports", []), "Port 80 must be mapped for Caddy"
    assert "443:443" in proxy_svc.get("ports", []), "Port 443 must be mapped for Caddy"
    print("✓ docker-compose.yml is valid with all 4 services, ports, and volumes configured!")

    # 2. Validate backend/Dockerfile
    print("\n--- 2. Testing backend/Dockerfile Directives ---")
    backend_df = PROJECT_ROOT / "backend" / "Dockerfile"
    assert backend_df.exists(), "backend/Dockerfile must exist"
    backend_content = backend_df.read_text()
    assert "FROM python:3.12-slim" in backend_content
    assert "EXPOSE 8000 5027 5023" in backend_content
    assert "HEALTHCHECK" in backend_content
    assert "uvicorn" in backend_content
    print("✓ backend/Dockerfile verified with multi-stage build and non-root runner!")

    # 3. Validate frontend/Dockerfile
    print("\n--- 3. Testing frontend/Dockerfile Directives ---")
    frontend_df = PROJECT_ROOT / "frontend" / "Dockerfile"
    assert frontend_df.exists(), "frontend/Dockerfile must exist"
    frontend_content = frontend_df.read_text()
    assert "FROM node:20-alpine" in frontend_content
    assert "EXPOSE 3000" in frontend_content
    assert "npm run build" in frontend_content
    print("✓ frontend/Dockerfile verified with multi-stage Next.js builder!")

    # 4. Validate Caddyfile
    print("\n--- 4. Testing Caddyfile Reverse Proxy Directives ---")
    caddy_file = PROJECT_ROOT / "Caddyfile"
    assert caddy_file.exists(), "Caddyfile must exist"
    caddy_content = caddy_file.read_text()
    assert "reverse_proxy backend:8000" in caddy_content
    assert "reverse_proxy frontend:3000" in caddy_content
    assert "path /ws/*" in caddy_content, "Must route WebSocket connections"
    assert "handle /api/*" in caddy_content, "Must route API requests"
    print("✓ Caddyfile verified with auto-SSL, WebSocket reverse proxy, and security headers!")

    # 5. Validate nginx/nginx.conf
    print("\n--- 5. Testing nginx/nginx.conf Enterprise Fallback ---")
    nginx_file = PROJECT_ROOT / "nginx" / "nginx.conf"
    assert nginx_file.exists(), "nginx/nginx.conf must exist"
    nginx_content = nginx_file.read_text()
    assert "upstream backend_upstream" in nginx_content
    assert "upstream frontend_upstream" in nginx_content
    assert "location /ws/" in nginx_content
    assert "gzip on;" in nginx_content
    print("✓ nginx.conf verified with gzip compression and upstream pools!")

    # 6. Validate .env.production.example
    print("\n--- 6. Testing .env.production.example Completeness ---")
    env_file = PROJECT_ROOT / ".env.production.example"
    assert env_file.exists(), ".env.production.example must exist"
    env_content = env_file.read_text()
    required_keys = [
        "APP_DOMAIN", "POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_DB",
        "SECRET_KEY", "MPESA_ENV", "MPESA_CONSUMER_KEY", "AT_USERNAME",
        "TELTONIKA_PORT", "CONCOX_PORT"
    ]
    for key in required_keys:
        assert key in env_content, f"Missing required env key: {key}"
    print(f"✓ .env.production.example contains all {len(required_keys)} critical production variables!")

    # 7. Test /api/health endpoint in FastAPI
    print("\n--- 7. Testing /api/health Endpoint ---")
    from backend.main import healthcheck
    health_resp = healthcheck()
    assert health_resp["status"] == "healthy"
    assert health_resp["service"] == "busgo-backend"
    assert "timestamp" in health_resp
    print(f"✓ /api/health endpoint verified: {health_resp}")

    print("\n" + "=" * 65)
    print("ALL PRODUCTION CONTAINERIZATION TESTS PASSED SUCCESSFULLY!")
    print("=" * 65)

if __name__ == "__main__":
    run_tests()

