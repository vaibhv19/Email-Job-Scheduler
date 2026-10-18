# Full-Stack Email Job Scheduler

A production-grade, distributed email job scheduling system. The platform provides persistent delayed email dispatch via BullMQ, atomic per-sender rate limiting (inter-send delay spacing and sliding hourly quota), Ethereal SMTP delivery with test message previews, dual-provider OAuth integrations (Google Sign-In and Slack rate-limit alerts), full-text search via Elasticsearch, operational queue monitoring via Bull Board, and a modern React dashboard.

---

## 1. Project Documentation Index

- **[Requirements & Feature Checklist](file:///docs/requirements-checklist.md):** Authoritative requirements source of truth tracing all technical capabilities and verification evidence.
- **[Architecture Specification](file:///docs/architecture.md):** Architectural decisions, state machines, Redis Lua scripts, failure recovery, and target OCI deployment topology.
- **[Implementation Roadmap](file:///docs/implementation-roadmap.md):** 10-phase execution plan, branch workflow, and handoff protocols.
- **[Testing Strategy](file:///docs/testing-strategy.md):** Multi-tiered test pyramid, test isolation safeguards, and deployment checks.
- **[Feature Demo Walkthrough](file:///docs/demo-script.md):** Step-by-step feature walkthrough and demonstration guide.

---

## 2. Technology Stack & Service Architecture

```mermaid
flowchart TD
    User([Browser Client]) -->|HTTPS:443| Caddy[Caddy Reverse Proxy]
    Caddy -->|/| Web[React / Vite SPA]
    Caddy -->|/api/*| API[Express API Server]
    Caddy -->|/admin/queues| BullBoard[Bull Board UI]

    API -->|Persist state| Postgres[(PostgreSQL 16)]
    API -->|Enqueue delayed jobs| Redis[(Redis 7)]
    API -->|Full-text search| ES[(Elasticsearch 8.11)]

    Worker[BullMQ Worker Pool] -->|Atomic claim & deferral| Postgres
    Worker -->|Lock & rate-limit check| Redis
    Worker -->|Sync delivery status| ES
    Worker -->|SMTP delivery| Ethereal[Ethereal SMTP]
    Worker -->|Quota alert| Slack[Slack Webhook / API]
```

| Component | Technology | Role & Key Responsibilities |
|---|---|---|
| **Frontend** | React 19, TypeScript, Vite, Tailwind CSS | Modern dark slate UI, Scheduled Outbox & Sent tables, Compose modal with CSV upload, Elasticsearch search bar, live Slack connection pill |
| **Backend API** | Node.js 22, Express, TypeScript | Zod validation, Google OAuth 2.0 (PKCE + HMAC state), session management, outbox reconciliation, Slack OAuth, search API, Bull Board mount |
| **Worker Service** | Node.js 22, BullMQ, TypeScript | Multi-worker concurrency, atomic DB claims (`SELECT ... FOR UPDATE`), Redis Lua rate-limit reservations, SMTP delivery, crash recovery |
| **Relational Database** | PostgreSQL 16 (Alpine) | Primary authoritative state: `users`, `user_sessions`, `senders`, `emails`, `email_attempts`, `slack_connections`, `scheduling_outbox` |
| **Queue & Cache** | Redis 7 (AOF enabled) | BullMQ delayed email queue, atomic rate limit token buckets, Slack notification deduplication keys |
| **Search Engine** | Elasticsearch 8.11.3 | Versioned index mapping (`emails`), multi-field full-text search, user/tenant isolation query filters, outbox recovery sync |
| **SMTP Delivery** | Nodemailer + Ethereal Email | Disposable test SMTP delivery, stable Message-ID generation, test message preview capture |
| **Operational Visibility** | Bull Board (`@bull-board/express`) | Queue dashboard mounted at `/admin/queues` protected with HTTP Basic Auth |
| **Reverse Proxy** | Caddy 2 (Alpine) | Automated Let's Encrypt TLS termination, internal network isolation, static asset caching |
| **Target Deployment** | Oracle Cloud Always Free VM | Single-host containerized deployment via Docker Compose with private internal networking |

---

## 3. Prerequisites & Local Environment Setup

### 3.1 Prerequisites
- **Node.js:** v20.x or v22.x
- **npm:** v10.x or higher
- **Docker & Docker Compose:** Docker Engine 24+ with Compose v2+

### 3.2 Environment Configuration
Copy the template configuration file in the repository root:

```bash
cp .env.example .env
```

Inspect `.env`. For local development, default values connect to local Docker containers:
- `PORT=3001`
- `DATABASE_URL=postgresql://postgres:postgres@localhost:5433/email_scheduler` (or port 5432)
- `REDIS_URL=redis://localhost:6380` (or port 6379)
- `ELASTICSEARCH_NODE=http://localhost:9200`
- `WORKER_CONCURRENCY=5`
- `SESSION_SECRET=your-random-session-secret-at-least-32chars`
- `TOKEN_ENCRYPTION_KEY=your-random-encryption-key-32chars!!`

> [!WARNING]
> **No Secrets in Frontend:** Never place backend database passwords, session secrets, or client secrets in `apps/web/.env` or prefix them with `VITE_`. Variables prefixed with `VITE_` are bundled directly into public client-side JavaScript.

### 3.3 Starting Local Infrastructure
Start PostgreSQL, Redis, and Elasticsearch containers:

```bash
npm run infra:up
# Or: docker compose -f infra/docker-compose.yml up -d
```

Verify that all three services pass healthchecks:
```bash
docker compose -f infra/docker-compose.yml ps
```

### 3.4 Database Migrations
Run schema migrations against PostgreSQL:

```bash
npm run db:migrate
```

### 3.5 Running Application Services
Start the monorepo applications in separate terminal windows:

```bash
# Terminal 1: Express API Server (http://localhost:3001)
npm run dev --filter api

# Terminal 2: BullMQ Background Worker
npm run dev --filter worker

# Terminal 3: React Web Frontend (http://localhost:5173)
npm run dev --filter web
```

---

## 4. External Integrations Setup Guide

### 4.1 Real Google OAuth 2.0 Setup (AUTH-01..AUTH-14)
The application implements genuine Google OAuth 2.0 authorization-code flow with PKCE (`S256`) and HMAC-signed state cookies.

1. Go to the [Google Cloud Console Credentials Page](https://console.cloud.google.com/apis/credentials).
2. Create an **OAuth 2.0 Client ID** (Web application).
3. Under **Authorized JavaScript origins**, add:
   - `http://localhost:5173` (Frontend)
   - `http://localhost:3001` (Backend)
4. Under **Authorized redirect URIs**, add the exact callback URL:
   - `http://localhost:3001/api/auth/google/callback` (Local Development)
   - `https://your-domain.com/api/auth/google/callback` (Production)
5. Under **OAuth consent screen**, configure:
   - Scopes: `openid`, `profile`, `email`
   - Publishing status: **Testing**
   - Add your Google account under **Test users**.
6. Set credentials in `.env`:
   ```env
   GOOGLE_CLIENT_ID=your_google_client_id.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=your_google_client_secret
   GOOGLE_CALLBACK_URL=http://localhost:3001/api/auth/google/callback
   ```

### 4.2 Real Slack OAuth & Rate-Limit Alerts Setup (SLACK-01..SLACK-11)
The application links user workspaces via real Slack OAuth 2.0, stores encrypted tokens at rest, and sends real Slack blocks when hourly sender quotas are hit.

1. Go to the [Slack App Management Console](https://api.slack.com/apps) and create a **New App** (From scratch).
2. Under **Features > OAuth & Permissions**:
   - Add Redirect URL: `http://localhost:3001/api/slack/callback` (or production HTTPS domain).
   - Under **Bot Token Scopes**, add:
     - `chat:write` (Post messages in channels)
     - `chat:write.public` (Post in public channels without joining)
     - `incoming-webhook` (Incoming Webhooks for direct channel delivery)
3. Under **Settings > Basic Information**, find:
   - **Client ID**
   - **Client Secret**
4. Set credentials in `.env`:
   ```env
   SLACK_CLIENT_ID=your_slack_client_id
   SLACK_CLIENT_SECRET=your_slack_client_secret
   SLACK_CALLBACK_URL=http://localhost:3001/api/slack/callback
   ```
5. In the dashboard header, click **"Connect Slack"** to link your workspace.
6. When an email sender exhausts its hourly quota, a structured rate-limit alert block is automatically delivered to the connected Slack workspace. Repeated retries within the same hour window are deduplicated in Redis (`slack_alert:{senderId}:{utcHour}`) to prevent spam.

### 4.3 Ethereal SMTP Test Email Previews (SMTP-01..SMTP-04)
Ethereal Email is a safe fake-SMTP service that captures dispatched emails and provides instant web preview links.
1. Create a free test account at [ethereal.email/create](https://ethereal.email/create).
2. Add your credentials to `.env`:
   ```env
   SMTP_HOST=smtp.ethereal.email
   SMTP_PORT=587
   SMTP_USER=your_username@ethereal.email
   SMTP_PASS=your_password
   ```
3. When emails complete delivery, visit the **"Sent & Delivered"** tab in the dashboard and click **"Open Preview"** to view the live HTML email and headers in your browser.

---

## 5. Core Architectural Mechanisms & Guarantees

### 5.1 Distributed Rate Limiting & Sender Spacing (RATE-01..RATE-21)
The scheduler enforces two tiers of rate limiting:
1. **Per-Sender Delay Spacing:** Consecutive emails from the same sender enforce a minimum interval (`min_send_interval_ms`, default 2,000ms). Enforced atomically across concurrent workers using Redis timestamps.
2. **Per-Sender Hourly Quota:** Senders cannot exceed `max_emails_per_hour` (default 50/hr). Enforced atomically using an atomic Redis Lua script evaluating the current UTC hour window (`rate_limit:hourly:{senderId}:{utcHour}`).
3. **Graceful Deferral:** When quota is exhausted, the email status in PostgreSQL remains `scheduled` (not `failed`), and the job is deferred to the start of the next UTC hour using BullMQ `moveToDelayed`.

### 5.2 Atomic Claims & Concurrency Safeguards (BE-12, QA-05)
To eliminate duplicate sends across concurrent workers:
- Workers claim emails atomically using PostgreSQL:
  ```sql
  UPDATE emails
  SET status = 'processing', updated_at = NOW()
  WHERE id = $1 AND status = 'scheduled'
  RETURNING *;
  ```
- If competing workers attempt to claim the same email simultaneously, exactly one worker succeeds; others receive zero rows and safely skip.

### 5.3 SMTP Crash Recovery & At-Least-Once Delivery Semantics (SMTP-08, QA-18)
- External SMTP network delivery cannot guarantee exactly-once delivery across post-acceptance network crashes.
- To prevent duplicate sends, every email records an attempt record before SMTP transport. If a crash occurs after SMTP acceptance (code 250) but before updating `emails`, the worker's recovery check discovers the accepted attempt record on startup and reconciles the email to `sent` without resending.

### 5.4 Elasticsearch Outbox Recovery (ES-07, ES-08)
- Email scheduling and delivery never fail if Elasticsearch is temporarily unavailable.
- Indexing operations are decoupled: events are written to PostgreSQL `scheduling_outbox` (`elasticsearch_index`), and the reconciliation background loop drains pending index events once Elasticsearch resumes.

### 5.5 Bull Board Monitoring & Security (OPS-01..OPS-03)
- Live BullMQ queue states (Waiting, Active, Delayed, Completed, Failed) can be inspected at:
  ```
  http://localhost:3001/admin/queues
  ```
- **Access Control:** The route is protected by HTTP Basic Auth (`BULL_BOARD_USERNAME` / `BULL_BOARD_PASSWORD`). Unauthenticated access is rejected with HTTP 401.

---

## 6. Automated Testing Suite

The repository contains comprehensive unit, API, worker, rate-limiting, and search test suites executed via Vitest.

```bash
# Run all tests
npm test

# Run targeted test suites
npx vitest run test/api/auth.test.ts          # Phase 6 Google OAuth & isolation (16 tests)
npx vitest run test/api/elasticsearch.test.ts # Phase 7 Elasticsearch search & outbox (5 tests)
npx vitest run test/api/slack-bullboard.test.ts # Phase 9 Slack OAuth & Bull Board (14 tests)
npx vitest run test/rate-limit/              # Phase 5 rate limiting & deferral tests
npx vitest run test/worker/                  # SMTP delivery & crash recovery tests
```

### Infrastructure Requirements for Tests
- **Zero-Dependency Tests (Unit):** `npm run test:unit` (CSV parsing, validators, crypto).
- **Service-Backed Integration Tests:** Require running PostgreSQL (`5433`), Redis (`6380`), and Elasticsearch (`9200`) containers.

---

## 7. Production Deployment (Oracle Cloud Always Free VM)

The application includes turnkey Docker configurations for single-host production deployment on an **Oracle Cloud Infrastructure (OCI) Always Free VM** (Ampere A1 ARM64 or AMD micro x86_64).

### 7.1 Architecture & Network Isolation
- **Reverse Proxy (Caddy):** Only ports `80` (HTTP) and `443` (HTTPS) are published to the public internet. Caddy automatically provisions Let's Encrypt TLS certificates.
- **Internal Network Isolation:** PostgreSQL (`5432`), Redis (`6379`), Elasticsearch (`9200`), the API (`3001`), and Web SPA (`80`) communicate strictly over an internal Docker bridge network (`scheduler_network`) and **do not expose open ports to the public host IP**.
- **ARM64 Compatibility:** All base images (`node:22-alpine`, `postgres:16-alpine`, `redis:7-alpine`, `elasticsearch:8.11.3`, `caddy:2-alpine`, `nginx:alpine`) are multi-arch images natively compatible with Oracle Ampere A1 (ARM64) architecture.

### 7.2 Deployment Steps
1. SSH into your Oracle Cloud VM:
   ```bash
   ssh -i ~/.ssh/id_rsa opc@your-oracle-vm-ip
   ```
2. Clone repository and configure `.env`:
   ```bash
   git clone <repo-url> email-job-scheduler
   cd email-job-scheduler
   cp .env.example .env
   ```
3. Configure production values in `.env`:
   - Set `NODE_ENV=production`
   - Set `COOKIE_SECURE=true`
   - Set `API_BASE_URL=https://your-domain.com`
   - Set `FRONTEND_URL=https://your-domain.com`
   - Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_CALLBACK_URL`
   - Set `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, and `SLACK_CALLBACK_URL`
   - Set `SESSION_SECRET` and `TOKEN_ENCRYPTION_KEY`
4. Update `infra/Caddyfile` with your registered domain name or IP.
5. Launch the production stack:
   ```bash
   docker compose -f docker-compose.prod.yml up -d --build
   ```
6. Run database migrations inside the production network:
   ```bash
   docker compose -f docker-compose.prod.yml exec api npm run db:migrate
   ```

### 7.3 Oracle Cloud Egress & Ingress Rules
- **OCI Security Lists (Ingress):** Allow TCP port `80` and `443`.
- **OCI Security Lists (Egress):** Allow outbound TCP port `587` (STARTTLS) and `465` (SSL) for SMTP delivery, and port `443` for Google and Slack API requests.
- **Elasticsearch Resource Constraints:** Capped via `ES_JAVA_OPTS=-Xms512m -Xmx512m` to operate safely within Oracle Cloud free-tier memory allocations without OOM termination.

---

## 8. Feature Walkthrough & Verification Guide

A concise feature walkthrough guide is available at **[docs/demo-script.md](file:///docs/demo-script.md)**:
- **0:00 – 0:45:** Google OAuth 2.0 Sign-in, user avatar pill, and session verification.
- **0:45 – 2:00:** Bulk email scheduling via CSV upload, recipient validation, delay and quota settings.
- **2:00 – 2:50:** Worker job execution, status state machine transitions, and Ethereal preview inspection.
- **2:50 – 3:45:** Elasticsearch full-text search, live search pill, and multi-tenant isolation.
- **3:45 – 4:30:** Sender quota exhaustion, BullMQ delayed job rescheduling, Slack rate-limit notification, and protected Bull Board monitoring.
- **4:30 – 5:00:** Architecture recap and Docker deployment readiness.

---

## 9. Feature & Architecture Verification Status

| Area | Status | Verification Summary |
|---|---|---|
| **1. Foundation & Infrastructure** | **Verified** | Monorepo, Docker Compose, PostgreSQL, Redis, Elasticsearch, health probes (`/health`, `/ready`) |
| **2. Email Scheduling & Outbox** | **Verified** | BullMQ delayed queue, PostgreSQL outbox reconciliation, bulk recipient validation, idempotency |
| **3. SMTP Delivery & Resilience** | **Verified** | Nodemailer with Ethereal SMTP, preview URLs, stable Message-IDs, post-acceptance crash reconciliation |
| **4. Rate Limiting & Concurrency** | **Verified** | Per-sender spacing (`min_send_interval_ms`), atomic Redis hourly quotas, BullMQ deferral |
| **5. Slack OAuth & Alerts** | **Verified** | Real Slack OAuth authorization-code flow, encrypted tokens at rest, atomic Redis alert deduplication |
| **6. Google Authentication** | **Verified** | Real Google OAuth 2.0 with PKCE and HMAC state cookies, user profile header, tenant isolation |
| **7. Frontend Dashboard** | **Verified** | Modern React SPA, Scheduled Outbox & Sent tables, Compose modal, CSV parser |
| **8. Elasticsearch Search** | **Verified** | Full-text indexing on creation, post-delivery status updates, user-scoped filter queries |
| **9. Bull Board Monitoring** | **Verified** | Bull Board mounted at `/admin/queues` protected with HTTP Basic Auth |
| **10. Testing & QA** | **Verified** | Comprehensive test suite passing with 0 errors across 20 test files |
| **11. Deployment Preparation** | **Ready** | Multi-stage Dockerfiles, `docker-compose.prod.yml`, Caddy reverse proxy, OCI documentation |
| **12. Production Configuration** | **Environment-Driven** | Configurable via standard environment variables for Google OAuth, Slack, and SMTP services |
