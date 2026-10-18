# Multi-stage Dockerfile for @email-scheduler/worker (ARM64 & x86_64 compatible)
FROM node:22-alpine AS builder

WORKDIR /app

# Copy root workspace manifests
COPY package.json package-lock.json tsconfig.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/db/package.json ./packages/db/
COPY packages/redis/package.json ./packages/redis/
COPY apps/worker/package.json ./apps/worker/

# Install dependencies
RUN npm ci

# Copy source code
COPY packages/shared ./packages/shared
COPY packages/db ./packages/db
COPY packages/redis ./packages/redis
COPY apps/worker ./apps/worker

# Build shared packages and worker application
RUN npm run build:packages
RUN npm run build --workspace=@email-scheduler/worker

# Production Runner Stage
FROM node:22-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

# Copy built artifacts and runtime modules
COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/shared ./packages/shared
COPY --from=builder /app/packages/db ./packages/db
COPY --from=builder /app/packages/redis ./packages/redis
COPY --from=builder /app/apps/worker/package.json ./apps/worker/
COPY --from=builder /app/apps/worker/dist ./apps/worker/dist

CMD ["node", "apps/worker/dist/index.js"]
