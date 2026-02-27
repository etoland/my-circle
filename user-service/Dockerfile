# ── Stage 1: Build ─────────────────────────────────────
# Use specific version tags in production — never use 'latest'
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files first — Docker caches this layer
# If you only change src files, npm install won't re-run (faster builds)
COPY package*.json ./
RUN npm ci --only=production

# ── Stage 2: Runtime ────────────────────────────────────
# Multi-stage build keeps the final image lean — no dev tools, no build artifacts
FROM node:20-alpine AS runtime

# Security: run as non-root user
# ECS Fargate best practice — never run containers as root
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Copy only what we need from the builder stage
COPY --from=builder /app/node_modules ./node_modules
COPY src ./src
COPY package.json ./

# Switch to non-root user
USER appuser

# Expose port (ECS will map this via target group)
EXPOSE 3001

# Health check — ECS uses this to decide if the container is healthy
# It hits our /health endpoint every 30s
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health || exit 1

CMD ["node", "src/index.js"]
