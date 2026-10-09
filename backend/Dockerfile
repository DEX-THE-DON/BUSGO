# =====================================================================
# BUSGO Production Backend Dockerfile (FastAPI + Uvicorn + GPS Servers)
# =====================================================================

# Stage 1: Build dependencies with compiler tools
FROM python:3.12-slim AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --user -r requirements.txt

# Stage 2: Minimal runtime image
FROM python:3.12-slim AS runner

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Create secure non-root service account
RUN groupadd -r busgo && useradd -r -g busgo -d /home/busgo -m busgo

# Copy compiled Python packages from builder
COPY --from=builder /root/.local /home/busgo/.local
ENV PATH=/home/busgo/.local/bin:$PATH
ENV PYTHONPATH=/app
ENV PYTHONUNBUFFERED=1

# Copy backend code into container
COPY . /app/backend/
RUN chown -R busgo:busgo /app /home/busgo

USER busgo

# Expose ports:
# 8000: FastAPI HTTP & WebSocket API
# 5027: Teltonika GPS Telemetry Ingestion TCP Server
# 5023: Concox GT06 GPS Telemetry Ingestion TCP Server
EXPOSE 8000 5027 5023

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:8000/api/health || exit 1

CMD ["python", "-m", "uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]

