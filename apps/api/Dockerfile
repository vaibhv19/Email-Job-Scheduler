# Multi-stage Dockerfile for @email-scheduler/api (ARM64 & x86_64 compatible)
FROM node:22-alpine AS builder

WORKDIR /app

# Copy root workspace manifests
COPY package.json package-lock.json tsconfig.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/db/package.json ./packages/db/
COPY packages/redis/package.json ./packages/redis/
COPY apps/api/package.json ./apps/api/

# Install all dependencies (including devDependencies needed for build)
RUN npm ci

# Copy source code
COPY packages/shared ./packages/shared
COPY packages/db ./packages/db
COPY packages/redis ./packages/redis
COPY apps/api ./apps/api

# Build shared packages and API application
RUN npm run build:packages
RUN npm run build --workspace=@email-scheduler/api

# Production Runner Stage
FROM node:22-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

# Install curl for container healthchecks
RUN apk add --no-cache curl

# Copy root workspace configuration and built artifacts
COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/shared ./packages/shared
COPY --from=builder /app/packages/db ./packages/db
COPY --from=builder /app/packages/redis ./packages/redis
COPY --from=builder /app/apps/api/package.json ./apps/api/
COPY --from=builder /app/apps/api/dist ./apps/api/dist

EXPOSE 3001

HEALTHCHECK --interval=10s --timeout=5s --retries=3 --start-period=5s \
  CMD curl -f http://localhost:3001/health || exit 1

CMD ["node", "apps/api/dist/index.js"]
