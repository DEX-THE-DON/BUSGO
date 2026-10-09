# =====================================================================
# BUSGO Production Frontend Dockerfile (Next.js 16 + React 19)
# =====================================================================

# Stage 1: Install dependencies across npm workspaces
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Copy monorepo manifests
COPY package.json package-lock.json ./
COPY packages/ ./packages/
COPY frontend/package.json ./frontend/

RUN npm ci --workspace=@busgo/types --workspace=frontend

# Stage 2: Build Next.js production bundle
FROM node:20-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/frontend/node_modules ./frontend/node_modules
COPY package.json package-lock.json ./
COPY packages/ ./packages/
COPY frontend/ ./frontend/

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

WORKDIR /app/frontend
RUN npm run build

# Stage 3: Minimal production runner
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy built application & dependencies
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/frontend/package.json ./frontend/
COPY --from=builder /app/frontend/public ./frontend/public
COPY --from=builder /app/frontend/.next ./frontend/.next
COPY --from=builder /app/frontend/node_modules ./frontend/node_modules

USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/ || exit 1

WORKDIR /app/frontend
CMD ["npx", "next", "start", "-p", "3000", "-H", "0.0.0.0"]
