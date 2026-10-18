# Multi-stage Dockerfile for @email-scheduler/web (ARM64 & x86_64 compatible)
FROM node:22-alpine AS builder

WORKDIR /app

# Copy root workspace manifests
COPY package.json package-lock.json tsconfig.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/web/package.json ./apps/web/

# Install dependencies
RUN npm ci

# Copy source files
COPY packages/shared ./packages/shared
COPY apps/web ./apps/web

# Build shared package and frontend application
RUN npm run build:packages
RUN npm run build --workspace=@email-scheduler/web

# Production Web Server Stage (Nginx Alpine)
FROM nginx:alpine AS runner

# Remove default nginx html
RUN rm -rf /usr/share/nginx/html/*

# Copy built SPA assets
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html

# Copy custom Nginx configuration with SPA fallback
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
