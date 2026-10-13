# ReachInbox Email Scheduler — Implementation Roadmap

> **Document Purpose:** Translate the requirements in `docs/requirements-checklist.md` and architectural specifications in `docs/architecture.md` into an actionable, dependency-aware, phase-by-phase execution roadmap for the 48-hour ReachInbox Full-stack Email Job Scheduler assignment.
>
> **Authority:** `docs/requirements-checklist.md` is the requirements source of truth. Every requirement ID referenced herein maps directly to the checklist.

---

## 1. Objective and Execution Rules

### 1.1 Objective
Deliver a production-grade, full-stack email job scheduler adhering strictly to the ReachInbox assignment specification. The system provides reliable scheduling, persistent delayed execution via BullMQ, distributed per-sender rate limiting (delay and hourly quota), Ethereal SMTP delivery, real Google and Slack OAuth integrations, Elasticsearch search, operational queue visibility via Bull Board, and a ReachInbox-styled React interface.

### 1.2 Execution Rules
1. **Source of Truth:** `docs/requirements-checklist.md` governs all requirements. The roadmap references its stable IDs (e.g., `BE-01`, `RATE-05`, `SUB-02`) rather than redefining requirements.
2. **Strict Verification Policy:** A checklist requirement is marked `Verified` only when implemented code exists and tangible, successful verification evidence (executed test, CLI command output, or documented manual observation) has passed. Never mark `Verified` based on a plan, generated unverified code, or an AI agent's unsupported assertion.
3. **One Phase at a Time:** Implement, test, and verify strictly one phase before beginning the next.
4. **Verification Gates:** Do not proceed past a phase's exit gate while critical failures or unresolved dependencies remain.
5. **Scoped Modifications:** Modify only files relevant to the active phase. Do not introduce unapproved architectural changes or modify unrelated code.
6. **No Automated UI Agent Testing:** All UI visual-fidelity and interactive dashboard reviews will be conducted manually by the developer without launching automated browser agents.

---

## 2. Current-State Assessment

An inspection of the workspace (`d:\Work\Projects----Commercial\Outbox Labs\Assignment`) and Git state confirms the following actual project status:

| Category | Status | Concrete Inspection Evidence |
|---|---|---|
| **Git Repository** | Initialized | Local repository on branch `main`, tracking remote `origin` (`https://github.com/vaibhv19/Email-Job-Scheduler.git`). Commits `563199f` and `cfd2832` exist. Git author identity configured (`vaibhv19` / `vaibhavkrgupta369@gmail.com`). |
| **Requirements Document** | Documented & Verified | [`docs/requirements-checklist.md`](file:///d:/Work/Projects----Commercial/Outbox%20Labs/Assignment/docs/requirements-checklist.md) exists with 195 requirements across 12 sections, 5-column schema, and Definition of Done. |
| **Architecture Document** | Documented & Verified | [`docs/architecture.md`](file:///d:/Work/Projects----Commercial/Outbox%20Labs/Assignment/docs/architecture.md) exists (506 lines) defining models, state transitions, Redis Lua scripts, failure recovery, and architectural decision rules. |
| **Application Code** | Not Implemented | `apps/api`, `apps/worker`, `apps/web`, and `packages/shared` directories do not exist. No backend or frontend code has been created. |
| **Infrastructure & Build** | Not Implemented | `infra/docker-compose.yml`, root `package.json`, `pnpm-workspace.yaml`, and `.env.example` do not exist. |
| **Automated Tests** | Not Implemented | Zero unit, integration, or load test suites exist. |
| **External Credentials** | Pending Setup | Google Cloud OAuth credentials, Slack App credentials, and hosted cloud environment have not been provisioned. |

> [!IMPORTANT]
> The repository currently consists of requirements and architecture specifications only. All 195 requirement items remain in status `Not started`.

---

## 3. Architecture and Dependency Order

```text
Phase 1: Foundation & Tooling (pnpm monorepo, linting, git settings)
    │
    ▼
Phase 2: Local Infrastructure & Database Schema (Docker Compose, PostgreSQL, Redis, ES, migrations)
    │
    ▼
Phase 3: Core Scheduling API & Persistence (Express, DB models, validation, BullMQ producer)
    │
    ▼
Phase 4: Worker Engine, SMTP Delivery & Recovery (BullMQ consumer, Ethereal SMTP, retry/recovery)  ◄── [CRITICAL-PATH MILESTONE]
    │
    ▼
Phase 5: Distributed Concurrency, Rate Limiting & Batch Handling (Redis Lua delay & quota, 1k batch test)
    │
    ▼
Phase 6: Google Authentication & Access Control (Backend OAuth 2.0, sessions, tenant scoping)
    │
    ▼
Phase 7: Elasticsearch Asynchronous Indexing & Scoped Search (Outbox indexing, search API)
    │
    ▼
Phase 8: Frontend Dashboard, Composer & Visual Fidelity (React, Tailwind, CSV parser, visual audit, UI auth)
    │
    ▼
Phase 9: Slack OAuth, Quota Notifications & Bull Board (Slack token exchange, alerts, Bull Board)
    │
    ▼
Phase 10: Production Deployment, Documentation & Submission (Cloud hosting, demo video, ClickUp form)
```

### Dependency Rationale:
- **Database & Queue before Worker:** The database schema and BullMQ connection must exist before the worker can claim jobs or record execution attempts.
- **Critical Path Early:** Completing Phases 1 through 4 establishes the fundamental email scheduling and delivery loop before tackling advanced rate limiting, authentication, and UI layers.
- **Backend Auth (Phase 6) before Frontend (Phase 8):** Backend Google OAuth token exchange, secure session cookie management (signed/encrypted HttpOnly, SameSite cookies with CSRF protection, strictly per `docs/architecture.md`), and user/tenant query scoping are implemented and tested first via API tests. The frontend login-to-dashboard redirect (`AUTH-11`) and header profile/logout actions (`AUTH-03`, `AUTH-04`, `AUTH-05`, `AUTH-12`) are integrated in Phase 8 when the React dashboard is constructed.
- **Rate Limiting (Phase 5) before Slack Notifications (Phase 9):** Distributed rate limiting must be operational before connecting Slack quota-hit notifications.
- **Multi-Provider OAuth Verification Progression (`QA-20`):** `QA-20` requires live end-to-end verification across both Google and Slack OAuth in both development and production environments. Google OAuth dev callback is verified in Phase 6; Slack OAuth dev callback is verified in Phase 9; and the full dual-provider, multi-environment verification of `QA-20` is completed in Phase 10 upon cloud deployment.

---

## 4. Requirement Traceability Matrix

Every checklist requirement from `docs/requirements-checklist.md` is mapped to its execution phase:

| Phase | Section / Category | Requirement IDs Covered | Count |
|---|---|---|---|
| **Phase 1** | Foundation & Repository Setup | `INF-01`, `INF-02`, `INF-10`, `INF-13`, `INF-14`, `SUB-01`, `SUB-02`, `SUB-03` | 8 |
| **Phase 2** | Local Infrastructure & DB Schema | `INF-03`, `INF-04`, `INF-05`, `INF-06`, `INF-07`, `INF-08`, `INF-09`, `INF-11`, `INF-12`, `QA-02`, `QA-16` | 11 |
| **Phase 3** | Core Scheduling API & Producer | `BE-01`, `BE-02`, `BE-03`, `BE-04`, `BE-05`, `BE-06`, `BE-07`, `BE-08`, `BE-10`, `BE-14`, `BE-15`, `BE-16`, `BE-17`, `QA-01`, `QA-04`, `QA-12` | 16 |
| **Phase 4** | Worker Engine & SMTP Delivery *(Critical Path)* | `SMTP-01` to `SMTP-09`, `BE-09`, `BE-11`, `BE-12`, `BE-13`, `QA-03`, `QA-05`, `QA-06`, `QA-18` | 17 |
| **Phase 5** | Distributed Concurrency & Rate Limits | `RATE-01` to `RATE-21`, `QA-07`, `QA-08`, `QA-09`, `QA-15` | 25 |
| **Phase 6** | Google Auth & Tenant Scoping (Backend) | `AUTH-01`, `AUTH-02`, `AUTH-06`, `AUTH-07`, `AUTH-08`, `AUTH-09`, `AUTH-10`, `AUTH-13`, `AUTH-14`, `AUTH-15`, `QA-11`, `QA-14` | 12 |
| **Phase 7** | Elasticsearch Indexing & Scoped Search | `ES-01` to `ES-13`, `QA-13` | 14 |
| **Phase 8** | Frontend Dashboard, Composer & UI Auth | `FE-01` to `FE-26`, `AUTH-03`, `AUTH-04`, `AUTH-05`, `AUTH-11`, `AUTH-12`, `QA-19` | 32 |
| **Phase 9** | Slack Integration & Bull Board | `SLACK-01` to `SLACK-12`, `OPS-01` to `OPS-07`, `QA-10` | 20 |
| **Phase 10** | Deployment, Docs, Demo & Submission | `DOC-01` to `DOC-16`, `QA-17`, `QA-20`, `SUB-04` to `SUB-25` | 40 |
| **Total** | | **All 195 Requirement IDs Mapped (Zero Omissions, Zero Duplicates)** | **195** |

> [!NOTE]
> **Cross-Phase Traceability Notes:**
> 1. **Auth UI vs. Backend Separation:** While backend Google OAuth, user synchronization, session issuance, and query authorization are built in Phase 6 (`AUTH-01`, `AUTH-02`, `AUTH-06`, `AUTH-07`, `AUTH-08`, `AUTH-09`, `AUTH-10`, `AUTH-13`, `AUTH-14`, `AUTH-15`), the frontend user display (`AUTH-03`, `AUTH-04`, `AUTH-05`), post-login redirect (`AUTH-11`), and header logout button (`AUTH-12`) are deliberately implemented in Phase 8 where the React dashboard and header components exist.
> 2. **Multi-Provider QA-20 Placement:** `QA-20` mandates end-to-end verification of *both* Google and Slack OAuth in *both* development and production. Its final, comprehensive verification gate is assigned to Phase 10 after production deployment, with prerequisite dev callback verification taking place in Phase 6 (Google) and Phase 9 (Slack).

---

## 5. Phase-by-Phase Execution Plan

### Phase 1: Repository Foundation, Tooling, and Workspace Setup
- **Objective:** Establish a robust TypeScript monorepo with workspace tooling, code formatting, linting, secret filtering, and collaborator access.
- **Checklist IDs Covered:** `INF-01`, `INF-02`, `INF-10`, `INF-13`, `INF-14`, `SUB-01`, `SUB-02`, `SUB-03` (8 IDs).
- **Dependencies & Prerequisites:** Node.js (v20+), npm/pnpm, Git.
- **Concrete Deliverables:**
  - Root `package.json` and workspace configuration (`pnpm-workspace.yaml` or npm workspaces) with paths: `apps/*`, `packages/*`.
  - Shared TypeScript configurations (`tsconfig.base.json`).
  - ESLint and Prettier configurations.
  - Comprehensive `.env.example` documenting all configuration keys.
  - Robust `.gitignore` preventing secrets, build artifacts, and node_modules from entering Git.
  - GitHub collaborator invitations issued to `Mitrajit` and `Yadav036`.
- **Verification Commands:**
  - `[Proposed Command]` `pnpm install` (or `npm install`)
  - `[Proposed Command]` `npm run lint` && `npm run typecheck`
  - `[Existing Command]` `git check-ignore -v .env` (verifies `.env` is ignored)
  - `[Manual Check]` GitHub repository settings confirm private status and collaborator invitations sent.
- **Exit Criteria:** Clean monorepo compiles; linting and typecheck scripts pass; collaborator invites sent.
- **Critical Blockers:** Inability to issue collaborator invites or invalid Node/npm version.

---

### Phase 2: Local Infrastructure, Database Schema, and Health Checks
- **Objective:** Provision local containerized services (PostgreSQL, Redis, Elasticsearch), define the initial database schema with migrations, and establish service connectivity.
- **Checklist IDs Covered:** `INF-03`, `INF-04`, `INF-05`, `INF-06`, `INF-07`, `INF-08`, `INF-09`, `INF-11`, `INF-12`, `QA-02`, `QA-16` (11 IDs).
- **Dependencies & Prerequisites:** Docker and Docker Compose installed and running; Phase 1 monorepo structure.
- **Concrete Deliverables:**
  - `infra/docker-compose.yml` defining PostgreSQL 16, Redis 7 (with appendonly persistence), and Elasticsearch 8 (configured with `ES_JAVA_OPTS="-Xms512m -Xmx512m"`).
  - Scaffold `apps/api` (Express + TypeScript) with `/health` and `/ready` endpoints.
  - Scaffold `apps/web` (Vite + React + TypeScript + Tailwind CSS).
  - Scaffold `apps/worker` as an independent executable process.
  - PostgreSQL schema and migration tooling (e.g. Prisma or Kysely/Knex) for `users`, `senders`, `emails`, `email_attempts`, `slack_connections`, and `scheduling_outbox`.
  - Database connection pool and Redis connection utilities.
- **Verification Commands:**
  - `[Proposed Command]` `docker compose -f infra/docker-compose.yml up -d`
  - `[Proposed Command]` `docker compose -f infra/docker-compose.yml ps` (all healthy)
  - `[Proposed Command]` `npm run db:migrate` (migrations apply cleanly)
  - `[Proposed Command]` `curl http://localhost:3001/health` (returns 200 OK)
  - `[Proposed Command]` `curl http://localhost:3001/ready` (returns 200 with DB, Redis, and ES connectivity)
- **Exit Criteria:** Docker services run with persistent volumes; migrations execute successfully; API readiness checks confirm all storage backends are connected.
- **Critical Blockers:** Docker container port conflicts or memory allocation limits for Elasticsearch.

---

### Phase 3: Core Scheduling API, Persistence, and Queue Producer
- **Objective:** Implement the email scheduling API endpoint, request validation, recipient parsing, database persistence, and deterministic BullMQ delayed job enqueueing.
- **Checklist IDs Covered:** `BE-01`, `BE-02`, `BE-03`, `BE-04`, `BE-05`, `BE-06`, `BE-07`, `BE-08`, `BE-10`, `BE-14`, `BE-15`, `BE-16`, `BE-17`, `QA-01`, `QA-04`, `QA-12` (16 IDs).
- **Dependencies & Prerequisites:** Phase 2 database and Redis availability.
- **Concrete Deliverables:**
  - API validation middleware (Zod) validating email format, subject, body, sender ID, schedule time, delay, and hourly quota.
  - Recipient parser utility supporting CSV and plain text extraction with validation and deduplication.
  - `POST /api/emails/schedule` supporting single recipient and bulk recipient batches.
  - Consistent API error envelope middleware (`{ error: { code, message, details } }`).
  - Scheduling outbox / transactional persistence ensuring logical emails are saved in PostgreSQL.
  - BullMQ queue producer utilizing deterministic job IDs (`bullmq_job_id = email.id`).
  - Idempotency middleware utilizing `Idempotency-Key` header and database unique constraints.
  - `GET /api/emails/scheduled` and `GET /api/emails/sent` with pagination and status filters.
- **Verification Commands:**
  - `[Proposed Command]` `npm run test:unit -- api/validation`
  - `[Proposed Command]` `npm run test:unit -- parser/csv`
  - `[Proposed Command]` `npm run test:api -- api/schedule` (verify 201 Created and BullMQ delayed job in Redis)
  - `[Proposed Command]` `npm run test:api -- api/idempotency` (duplicate request returns identical cached result)
- **Exit Criteria:** Valid requests create PostgreSQL records and matching BullMQ delayed jobs; invalid/past schedules are rejected; idempotency protects duplicate submissions.
- **Critical Blockers:** Database transaction rollback failing to prevent orphaned queue jobs (mitigated by outbox/reconciliation pattern).

---

### Phase 4: Worker Engine, SMTP Delivery, and Failure Recovery
- **Objective:** Implement the independent BullMQ worker process, atomic email claiming, Ethereal SMTP delivery via Nodemailer, delivery attempt tracking, and restart recovery.
- **Checklist IDs Covered:** `SMTP-01`, `SMTP-02`, `SMTP-03`, `SMTP-04`, `SMTP-05`, `SMTP-06`, `SMTP-07`, `SMTP-08`, `SMTP-09`, `BE-09`, `BE-11`, `BE-12`, `BE-13`, `QA-03`, `QA-05`, `QA-06`, `QA-18` (17 IDs).
- **Dependencies & Prerequisites:** Phase 3 queue producer and database entities; Ethereal test account credentials.
- **Concrete Deliverables:**
  - `apps/worker` processor handling email delivery jobs.
  - Atomic database claim query (`SELECT ... FOR UPDATE SKIP LOCKED` or conditional `UPDATE ... WHERE status = 'scheduled'`) to prevent multi-worker duplicate claims.
  - Nodemailer transport configured for Ethereal SMTP with multiple sender credentials.
  - Stable logical `Message-ID` header generation derived deterministically from email UUID.
  - Recording delivery attempts in `email_attempts` table, capturing `provider_message_id`, `preview_url`, and error categories.
  - Startup reconciliation job detecting and enqueuing any pending emails missing from BullMQ.
  - Conservative recovery policy and test suite for post-SMTP acceptance crash scenarios.
- **Verification Commands:**
  - `[Proposed Command]` `npm run test:integration -- worker/delivery` (verifies SMTP send and preview URL generation)
  - `[Proposed Command]` `npm run test:integration -- worker/concurrency` (verifies atomic claiming across parallel workers)
  - `[Proposed Command]` `npm run test:integration -- worker/recovery` (simulates worker restart and crash recovery)
  - `[Proposed Command]` `npm run test:integration -- worker/smtp-crash` (simulates post-SMTP crash conservative reconciliation)
- **Exit Criteria:** **CRITICAL-PATH MILESTONE ACHIEVED.** An email scheduled in API fires in worker, delivers to Ethereal SMTP, updates database to `sent`, and exposes a working preview URL.
- **Critical Blockers:** Inability of worker to reach Ethereal SMTP; race conditions during concurrent worker claims.

---

### Phase 5: Distributed Concurrency, Rate Limiting, and Batch Handling
- **Objective:** Implement distributed minimum delay and hourly quotas per sender using atomic Redis Lua scripts, job deferral semantics, and validate 1,000+ email batches.
- **Checklist IDs Covered:** `RATE-01`, `RATE-02`, `RATE-03`, `RATE-04`, `RATE-05`, `RATE-06`, `RATE-07`, `RATE-08`, `RATE-09`, `RATE-10`, `RATE-11`, `RATE-12`, `RATE-13`, `RATE-14`, `RATE-15`, `RATE-16`, `RATE-17`, `RATE-18`, `RATE-19`, `RATE-20`, `RATE-21`, `QA-07`, `QA-08`, `QA-09`, `QA-15` (25 IDs).
- **Dependencies & Prerequisites:** Phase 4 working worker engine and Redis connection.
- **Concrete Deliverables:**
  - Worker concurrency configuration via `WORKER_CONCURRENCY` environment variable (bounded job concurrency distinguished from thread count).
  - Redis Lua script enforcing minimum per-sender interval (`min_send_interval_ms`) across distributed workers without sleeping in-memory.
  - Redis Lua script enforcing hourly quota window reservations per sender.
  - Worker deferral logic: when quota is exhausted, reschedule job to the start of the next UTC hour preserving job ID and relative order without marking status as failed.
  - Quota failure/refund policy: explicit accounting for permanent rejections, retries, crashes, and ambiguous states.
  - Batch scheduling logic ensuring timestamps satisfy requested start time + minimum delays.
  - Load test script scheduling 1,000+ emails verifying database and queue ingestion stability.
- **Verification Commands:**
  - `[Proposed Command]` `npm run test:ratelimit -- delay` (verifies send intervals >= configured minimum)
  - `[Proposed Command]` `npm run test:ratelimit -- quota` (verifies hourly cap is never exceeded across concurrent workers)
  - `[Proposed Command]` `npm run test:ratelimit -- deferral` (verifies jobs exceeding quota are deferred, not failed)
  - `[Proposed Command]` `npm run test:load` (schedules 1,000 emails, asserts zero dropped records, bounds concurrency)
- **Exit Criteria:** Multi-worker rate limiting strictly enforced; quota exhaustion cleanly defers jobs; 1,000-email batch schedules reliably.
- **Critical Blockers:** Deadlocks between delay reservations and quota reservations (resolved by strict reservation acquisition ordering).

---

### Phase 6: Google Authentication, Authorization, and User Scoping (Backend)
- **Objective:** Implement Google OAuth 2.0 login, secure session management, and server-side data isolation enforcing record ownership across all API queries.
- **Checklist IDs Covered:** `AUTH-01`, `AUTH-02`, `AUTH-06`, `AUTH-07`, `AUTH-08`, `AUTH-09`, `AUTH-10`, `AUTH-13`, `AUTH-14`, `AUTH-15`, `QA-11`, `QA-14` (12 IDs).
- **Dependencies & Prerequisites:** Google Cloud Console OAuth credentials (Client ID and Secret); Phase 3 API endpoints.
- **Concrete Deliverables:**
  - Google OAuth integration (`GET /api/auth/google`, `GET /api/auth/google/callback`).
  - User synchronization creating or updating local `users` row.
  - Secure session handling using signed/encrypted HttpOnly, SameSite cookies with CSRF protection, backed by server-side session management (strictly per `docs/architecture.md`).
  - Authentication middleware (`requireAuth`) guarding private API routes (HTTP 401).
  - Query scoping middleware ensuring all database reads and writes filter by authenticated `user_id` (HTTP 403 on cross-tenant access).
  - Logout endpoint (`POST /api/auth/logout`) and profile endpoint (`GET /api/auth/me`).
  - Environment configuration for local (`http://localhost...`) and production OAuth redirect URIs.
- **Verification Commands:**
  - `[Proposed Command]` `npm run test:auth -- isolation` (verifies User A cannot access User B's scheduled or sent emails)
  - `[Proposed Command]` `npm run test:auth -- unauthenticated` (verifies 401 on protected routes)
  - `[Manual / E2E Scenario]` Verify real Google login flow with valid Client ID/Secret, profile retrieval, and cookie session issuance.
- **Exit Criteria:** Unauthenticated API requests rejected; cross-user access prevented; backend Google OAuth token exchange and session management verified.
*(Cross-Phase Note: Google OAuth callback in development is verified here. Dual-provider dev and prod callback verification for QA-20 is finalized in Phase 10).*
- **Critical Blockers:** Misconfigured Google OAuth redirect URI in Google Cloud Console.

---

### Phase 7: Elasticsearch Asynchronous Indexing and Scoped Search
- **Objective:** Integrate Elasticsearch for asynchronous email indexing, user-scoped full-text search, and automated reconciliation recovery.
- **Checklist IDs Covered:** `ES-01`, `ES-02`, `ES-03`, `ES-04`, `ES-05`, `ES-06`, `ES-07`, `ES-08`, `ES-09`, `ES-10`, `ES-11`, `ES-12`, `ES-13`, `QA-13` (14 IDs).
- **Dependencies & Prerequisites:** Elasticsearch cluster running (Phase 2); Phase 3 scheduling API; Phase 6 auth scoping.
- **Concrete Deliverables:**
  - Elasticsearch index initialization script with explicit schema mapping (`emails` index).
  - Asynchronous indexing worker listening to email lifecycle events (`scheduled`, `sent`, `failed`).
  - `GET /api/search/emails` supporting search by recipient, subject, and body with pagination.
  - Mandatory tenant filtering (`term: { user_id }`) inside all Elasticsearch search queries.
  - Indexing failure decoupling: Elasticsearch downtime does not block email scheduling or delivery.
  - Reindexing recovery script (`npm run search:reindex`) syncing missed or outdated records from PostgreSQL.
- **Verification Commands:**
  - `[Proposed Command]` `npm run test:search -- indexing` (verifies newly scheduled email is indexed and discoverable)
  - `[Proposed Command]` `npm run test:search -- updates` (verifies status transition to `sent` updates Elasticsearch)
  - `[Proposed Command]` `npm run test:search -- isolation` (verifies search queries do not return other users' emails)
  - `[Proposed Command]` `npm run test:search -- recovery` (verifies reindexing script syncs unindexed records)
- **Exit Criteria:** Emails searchable before and after delivery; queries strictly tenant-scoped; Elasticsearch downtime does not crash email pipeline.
- **Critical Blockers:** Elasticsearch out-of-memory container crashes (allocate appropriate JVM heap limits in Docker Compose).

---

### Phase 8: Frontend Dashboard, Composer, Visual Fidelity, and UI Auth Integration
- **Objective:** Build the ReachInbox-styled React frontend with authentication guards, Scheduled/Sent email tables, CSV upload/parsing composer, and complete visual fidelity audit against reference screens.
- **Checklist IDs Covered:** `FE-01`, `FE-02`, `FE-03`, `FE-04`, `FE-05`, `FE-06`, `FE-07`, `FE-08`, `FE-09`, `FE-10`, `FE-11`, `FE-12`, `FE-13`, `FE-14`, `FE-15`, `FE-16`, `FE-17`, `FE-18`, `FE-19`, `FE-20`, `FE-21`, `FE-22`, `FE-23`, `FE-24`, `FE-25`, `FE-26`, `AUTH-03`, `AUTH-04`, `AUTH-05`, `AUTH-11`, `AUTH-12`, `QA-19` (32 IDs).
- **Dependencies & Prerequisites:** Backend APIs from Phases 3, 4, 6, and 7; ReachInbox visual reference screens.
- **Concrete Deliverables:**
  - Clean login screen matching ReachInbox design with Google Sign-In button.
  - Complete post-login dashboard redirect (`AUTH-11`).
  - Dashboard layout with navigation sidebar, header displaying user profile (`AUTH-03`, `AUTH-04`, `AUTH-05`) and logout action (`AUTH-12`).
  - Frontend route protection redirecting unauthenticated users to `/login`.
  - Scheduled Emails table displaying recipient, subject, scheduled time, and status badges.
  - Sent Emails table displaying recipient, subject, sent time, status badges, and Ethereal preview links.
  - Compose New Email modal/drawer with subject, body, start-time picker, delay input, hourly-limit input, and submit debouncing.
  - CSV/text file upload with real-time valid email counter, format validation, and deduplication.
  - Search bar connected to the Elasticsearch search API.
  - Loading skeletons, empty states, error handling, and toast notifications.
  - Developer manual visual-fidelity audit comparing implemented views side-by-side against supplied reference screens (no browser agent).
- **Verification Commands:**
  - `[Proposed Command]` `npm run build --filter web` (clean build without TypeScript or styling errors)
  - `[Proposed Command]` `npm run test:unit -- web/components`
  - `[Manual UI Audit]` Side-by-side visual inspection by the developer verifying login, tables, composer, header, and empty/loading states against the ReachInbox reference.
- **Exit Criteria:** Complete UI functional, responsive, authenticated, and verified side-by-side against ReachInbox reference designs.
- **Critical Blockers:** Unhandled CORS or cookie transmission issues between Vite dev server and Express API.

---

### Phase 9: Slack Integration, Rate-Limit Notifications, and Bull Board
- **Objective:** Implement Slack OAuth, rate-limit quota exhaustion notifications with deduplication, and mount a secure Bull Board queue dashboard.
- **Checklist IDs Covered:** `SLACK-01`, `SLACK-02`, `SLACK-03`, `SLACK-04`, `SLACK-05`, `SLACK-06`, `SLACK-07`, `SLACK-08`, `SLACK-09`, `SLACK-10`, `SLACK-11`, `SLACK-12`, `OPS-01`, `OPS-02`, `OPS-03`, `OPS-04`, `OPS-05`, `OPS-06`, `OPS-07`, `QA-10` (20 IDs).
- **Dependencies & Prerequisites:** Slack App credentials (Client ID, Secret, redirect URI); Phase 5 rate limiter; Phase 6 auth.
- **Concrete Deliverables:**
  - Slack OAuth flow (`GET /api/slack/connect`, `GET /api/slack/callback`, `DELETE /api/slack/connection`).
  - Encrypted storage of Slack access tokens associated with tenant.
  - Quota notification trigger: when hourly quota is hit, dispatch Slack alert via Web API.
  - Redis-backed notification deduplication: maximum 1 Slack message per sender per hourly window.
  - Graceful degradation: missing Slack connection or Slack API outage never disrupts or fails email jobs.
  - Bull Board dashboard mounted at protected route (`/admin/queues`) showing active, waiting, delayed, and failed jobs.
  - Sanitization ensuring sensitive credentials (tokens, passwords) are excluded from job payloads and Bull Board view.
- **Verification Commands:**
  - `[Proposed Command]` `npm run test:integration -- slack/oauth`
  - `[Proposed Command]` `npm run test:integration -- slack/notifications` (verifies deduplication key prevents duplicate alerts)
  - `[Manual / E2E Scenario]` Live test in a real Slack workspace verifying message delivery upon quota exhaustion.
  - `[Manual / E2E Scenario]` Navigate to `/admin/queues` unauthenticated (assert 401/403) and authenticated (assert queue stats render).
- **Exit Criteria:** Real Slack OAuth and quota alerts verified end-to-end; Bull Board accessible and secured.
*(Cross-Phase Note: Slack OAuth callback in development is verified here, unblocking the final dev/prod dual-provider verification of QA-20 in Phase 10).*
- **Critical Blockers:** Missing Slack workspace admin permissions for installing custom Slack apps.

---

### Phase 10: Production Deployment, Documentation, Demo Video, and Submission
- **Objective:** Deploy application to a public hosting platform, execute end-to-end smoke tests, document setup and limitations in `README.md`, record the demo video, and complete the ClickUp submission form.
- **Checklist IDs Covered:** `DOC-01`, `DOC-02`, `DOC-03`, `DOC-04`, `DOC-05`, `DOC-06`, `DOC-07`, `DOC-08`, `DOC-09`, `DOC-10`, `DOC-11`, `DOC-12`, `DOC-13`, `DOC-14`, `DOC-15`, `DOC-16`, `QA-17`, `QA-20`, `SUB-04`, `SUB-05`, `SUB-06`, `SUB-07`, `SUB-08`, `SUB-09`, `SUB-10`, `SUB-11`, `SUB-12`, `SUB-13`, `SUB-14`, `SUB-15`, `SUB-16`, `SUB-17`, `SUB-18`, `SUB-19`, `SUB-20`, `SUB-21`, `SUB-22`, `SUB-23`, `SUB-24`, `SUB-25` (40 IDs).
- **Dependencies & Prerequisites:** Phases 1–9 complete; public cloud hosting provider (e.g. Render / Railway / Fly.io / AWS); screen recording tool.
- **Concrete Deliverables:**
  - Production deployment of PostgreSQL, Redis, API, Worker, and Web frontend.
  - Configured production OAuth redirect URIs for Google and Slack.
  - Comprehensive `README.md` containing architecture, local setup instructions, env explanations, rate limiting documentation, and explicit disclosure of at-least-once SMTP limitations.
  - 5-minute (or under) demo video demonstrating: scheduling, scheduled view, sent view with Ethereal preview, restart recovery, and rate limiting with Slack notification.
  - Public accessibility of demo video confirmed in incognito window.
  - Private GitHub repository verified with collaborator invitations active for `Mitrajit` and `Yadav036`.
  - All ClickUp submission form fields prepared, verified, and submitted.
- **Verification Commands:**
  - `[Manual / E2E Scenario]` Production smoke test: authenticate via Google on live URL, schedule email, observe delivery, test search.
  - `[Manual / E2E Scenario]` `QA-20` Multi-Provider OAuth Verification: Authenticate with real Google account and link real Slack workspace in both local development and hosted production environments, verifying live token exchanges, callback URL validity, and session persistence.
  - `[Manual Check]` Video link validation: check URL in private/incognito window without login.
  - `[Proposed Command]` Full test suite: `npm test` across all packages passes cleanly.
- **Exit Criteria:** Live application accessible; repository code pushed; demo video recorded; ClickUp submission form completed.
- **Critical Blockers:** Production OAuth callback domain mismatch or slow cloud DNS propagation.

---

## 6. Critical-Path Strategy

To maximize progress within the 48-hour window and avoid getting stranded in secondary features, the roadmap establishes an **Early Critical Path** focused strictly on the core scheduling and delivery loop:

```text
[API] POST /api/emails/schedule
       │
       ▼
[PostgreSQL] Persist email record in 'scheduled' state
       │
       ▼
[BullMQ / Redis] Enqueue delayed job with deterministic jobId
       │
       ▼
[Worker] Delay elapses -> Claim email atomically
       │
       ▼
[Ethereal SMTP] Deliver message via Nodemailer
       │
       ▼
[PostgreSQL] Update record to 'sent', store sent_at and preview_url
       │
       ▼
[API] GET /api/emails/sent returns updated record with preview URL
```

### Critical-Path Milestones:
- **Milestone Target:** Complete this entire loop by the end of **Phase 4** (Hour 14).
- **Verification Gate:** Do not begin UI styling, Slack integrations, or advanced search until this backend delivery loop is proven with passing automated integration tests.

---

## 7. High-Risk Implementation Decisions

The following architectural decisions must be adhered to throughout implementation:

| Decision Area | Chosen Strategy & Constraints |
|---|---|
| **1. Source of Truth** | **PostgreSQL is the single source of truth.** Redis and BullMQ manage execution timing and distributed coordination. A job is not valid unless its corresponding PostgreSQL record is in an eligible state. |
| **2. Database-to-Queue Reliability** | **Outbox / Reconciliation pattern.** The API writes the email to PostgreSQL inside a database transaction. If the subsequent BullMQ enqueue fails, the record remains in PostgreSQL and a startup/background reconciliation job detects and recovers missing queue jobs. |
| **3. Idempotency & Delivery Guarantees** | **At-least-once processing; no false exactly-once claims.** Deterministic BullMQ job IDs (`jobId = email.id`) and unique DB idempotency keys prevent duplicate enqueues. However, because network crashes can occur after SMTP acceptance but before database recording, exactly-once delivery cannot be guaranteed over SMTP. The system conservatively reconciles ambiguous states. |
| **4. Atomic Multi-Worker Quota** | **Redis Lua scripts for rate limiting.** Minimum delay between sends and hourly quota reservations must be acquired atomically in Redis via Lua scripts before initiating delivery, preventing race conditions across concurrent workers. |
| **5. Quota Accounting on Failure** | **No blind refunds on ambiguous outcomes.** If an email fails with an explicit permanent rejection, quota accounting follows documented policy. If a send attempt times out or is ambiguous, the reservation is retained to prevent exceeding provider thresholds. |
| **6. Job Deferral Semantics** | **Preserve job identity during quota exhaustion.** When an hourly quota is exhausted, the active job is rescheduled to the start of the next hour using BullMQ delayed APIs. The database status remains `scheduled` with preserved UUID. |
| **7. Post-SMTP Acceptance Crash** | **Conservative reconciliation.** If a worker dies after SMTP accepts the message but before updating PostgreSQL, recovery logic inspects attempt logs and treats ambiguous outcomes conservatively rather than blindly resending. |
| **8. Session Security & Tenant Scoping** | **Server-side session management.** Use signed/encrypted HttpOnly, Secure, SameSite session cookies with CSRF protection, strictly per `docs/architecture.md` (no JWT tokens). Every database query and Elasticsearch search query must explicitly include a `WHERE user_id = $1` clause. |
| **9. Elasticsearch Decoupling** | **Asynchronous event indexing.** Search indexing occurs out-of-band. Elasticsearch outages must never fail or block email scheduling or SMTP delivery. A reindexing CLI script handles backfills. |
| **10. Slack Alert Deduplication** | **Atomic window lock.** A Redis key (`slack:alert:<sender_id>:<window_hour>`) with a 1-hour TTL ensures that hitting a quota produces at most one Slack notification per sender per quota window. |

---

## 8. Layered Verification Strategy

Verification must proceed systematically from low-level unit tests to end-to-end integration:

```text
Level 1: Static Verification   ──► npm run lint && npm run typecheck
Level 2: Unit Testing          ──► npm run test:unit (parsers, validators, rate-limit math)
Level 3: Integration Testing   ──► npm run test:api && npm run test:queue (DB, BullMQ, SMTP)
Level 4: Concurrency & Limits  ──► npm run test:ratelimit && npm run test:load (1k batch)
Level 5: Resilience & Recovery ──► npm run test:recovery (process kills, post-SMTP crash)
Level 6: Manual UI Audit       ──► Side-by-side visual comparison against ReachInbox designs
Level 7: Hosted Smoke Testing  ──► End-to-end user verification on live deployment URL
```

---

## 9. 48-Hour Deadline and Contingency Allocation

To ensure feasibility within the 48-hour timeline, planned work is targeted for **36 hours**, reserving **12 hours (25%) as explicit contingency** to absorb integration risks, external OAuth verification, and deployment hurdles:

| Timeline Window | Phase | Focus Area | Planned Allocation | Cumulative |
|---|---|---|---|---|
| **Hours 0.0 – 2.5** | Phase 1 | Monorepo scaffolding, TypeScript configs, ESLint/Prettier, `.env.example`, `.gitignore`, reviewer invitations | 2.5 hours | 2.5h |
| **Hours 2.5 – 6.0** | Phase 2 | Docker Compose (PostgreSQL, Redis, Elasticsearch), initial migrations, Express/Vite skeletons, `/health` and `/ready` | 3.5 hours | 6.0h |
| **Hours 6.0 – 10.0** | Phase 3 | Zod validation, CSV recipient parser, BullMQ delayed job enqueueing, idempotency middleware, list endpoints | 4.0 hours | 10.0h |
| **Hours 10.0 – 14.0** | Phase 4 | **Critical-Path Milestone:** Atomic claim query, Ethereal SMTP send, attempt tracking, restart reconciliation, crash scenario | 4.0 hours | 14.0h |
| **Hours 14.0 – 19.0** | Phase 5 | Redis Lua min-delay & hourly quota scripts, job deferrals without drop, 1k batch test | 5.0 hours | 19.0h |
| **Hours 19.0 – 22.0** | Phase 6 | Backend Google OAuth, session cookies, unauthenticated 401s, user/tenant query scoping (403) | 3.0 hours | 22.0h |
| **Hours 22.0 – 25.0** | Phase 7 | Elasticsearch outbox indexing consumer, tenant-scoped search API, reindexing recovery script | 3.0 hours | 25.0h |
| **Hours 25.0 – 30.0** | Phase 8 | React dashboard, ReachInbox visual styling, composer, CSV upload, login redirect, header profile, manual UI audit | 5.0 hours | 30.0h |
| **Hours 30.0 – 33.0** | Phase 9 | Slack OAuth, deduplicated rate-limit alerts, protected Bull Board route | 3.0 hours | 33.0h |
| **Hours 33.0 – 36.0** | Phase 10 | Cloud deployment, README docs, <= 5 min demo video, ClickUp submission form | 3.0 hours | 36.0h |
| **Hours 36.0 – 48.0** | **Buffer** | **Dedicated Contingency Reserve** (OAuth DNS/redirects, cloud hosting setup, edge-case debugging) | **12.0 hours** | **48.0h** |

### Priority & Scope Safeguards:
- **Mandatory Assignment Core:** The critical-path delivery loop (Phases 1–4), distributed rate limits (Phase 5), Google and Slack OAuth (Phases 6 & 9), Elasticsearch search (Phase 7), dashboard views (Phase 8), and reviewer access / demo video (Phase 10) are non-negotiable requirements.
- **Deferrable Optional Polish:** If contingency is heavily drawn upon, prioritize backend correctness, rate limiting, and core UI functionality over secondary visual polish (such as complex micro-animations or custom theme toggles).

---

## 10. Progress Tracking and Reporting Rules

When executing each phase with an AI agent or developer:
1. **Declare Phase Focus:** Announce the target Phase and its requirement IDs before writing code.
2. **Execute Deliverables:** Implement only the components specified in that Phase.
3. **Execute Verification:** Run the defined test commands and inspect results.
4. **Produce Phase Completion Report:**
   - Changed files.
   - Verification commands executed with actual pass/fail output.
   - Checklist status updates (moving matching IDs from `Not started` to `Verified` only with proof).
   - Any blockers or deferred trade-offs encountered.
   - Confirmation of remaining deadline time.
5. **No Phase Overlap:** Do not begin Phase *N+1* until Phase *N* exit criteria are fully satisfied.

---

## 11. Final Submission Gate

Before submitting the assignment, the following checklist items must be affirmed:

- [ ] **Repository Privacy:** GitHub repository is confirmed Private (`SUB-01`).
- [ ] **Reviewer Access:** Collaborator invitations confirmed for `Mitrajit` (`SUB-02`) and `Yadav036` (`SUB-03`).
- [ ] **Code & Commits:** Clean working tree with committed lockfile pushed to `origin/main` (`SUB-04`).
- [ ] **Hosted Application:** Publicly accessible hosted application link working over HTTPS (`SUB-05`).
- [ ] **Demo Video:** Accessible, non-restricted video link <= 5 minutes demonstrating scheduling, views, recovery, rate limits, and Slack alert (`SUB-06` to `SUB-11`).
- [ ] **Submission Form:** All fields in the ClickUp submission form (`SUB-12` to `SUB-25`) completed accurately.
- [ ] **Originality Affirmation:** Code originality affirmed truthfully (`SUB-24`).
