# Email Job Scheduler — Implementation Roadmap

> **Document Purpose:** Translate the requirements in `docs/requirements-checklist.md` and architectural specifications in `docs/architecture.md` into an actionable, dependency-aware, phase-by-phase execution roadmap for the Full-Stack Email Job Scheduler.
>
> **Authority:** `docs/requirements-checklist.md` is the requirements source of truth. Every requirement ID referenced herein maps directly to the checklist.

---

## 1. Objective and AntiGravity Execution Protocol

### 1.1 Objective
Deliver a production-grade, full-stack email job scheduler. The system provides reliable scheduling, persistent delayed execution via BullMQ, distributed per-sender rate limiting (delay and hourly quota), Ethereal SMTP delivery, real Google and Slack OAuth integrations, Elasticsearch search, operational queue visibility via Bull Board, and a modern React interface.

### 1.2 AntiGravity Execution Protocol (Enforceable for Every Phase)

Every phase of this roadmap must be executed strictly following the six mandatory stages below. An AI agent or developer must not bypass or reorder these stages:

#### Stage 1: Pre-Phase Planning
Before modifying or creating any files:
1. **Read Specifications:** Read the active phase description, prerequisites, concrete deliverables, checklist requirement IDs, verification commands, exit criteria, and documented blockers.
2. **Inspect Git Context:** Inspect `git status`, current branch, and recent commit history (`git log -n 5`).
3. **Preserve User Work:** Record any unrelated or pre-existing modifications in the working tree and preserve them. Never discard, overwrite, or stash user work without explicit instruction.
4. **Validate Scope & Prerequisites:** Identify the permitted file modification scope for the phase. Verify that all prerequisite deliverables from preceding phases exist and pass their exit criteria.
5. **Blocker Protocol:** If any dependency is missing or an architectural conflict blocks safe implementation, **STOP immediately and report it** to the developer before writing code.

#### Stage 2: Git Branch Isolation
Every phase must execute in isolated feature branches:
1. **Branch Baseline:** Start from an up-to-date, verified `main` branch state, subject to preserving legitimate existing uncommitted work.
2. **Standardized Branch Naming:** Create and switch to a dedicated phase branch named consistently:
   - Phase 1: `phase-01/foundation`
   - Phase 2: `phase-02/infra-db`
   - Phase 3: `phase-03/scheduling-api`
   - Phase 4: `phase-04/worker-smtp`
   - Phase 5: `phase-05/concurrency-ratelimits`
   - Phase 6: `phase-06/google-auth`
   - Phase 7: `phase-07/elasticsearch-search`
   - Phase 8: `phase-08/frontend-dashboard`
   - Phase 9: `phase-09/slack-bullboard`
   - Phase 10: `phase-10/deployment-walkthrough`
3. **No Direct Commits on Main:** Never perform phase implementation directly on `main`.
4. **Preserve Unrelated Changes:** Never discard, reset, or overwrite unrelated user work. Do not stage or commit unrelated changes.
5. **Safe Transition Check:** If the repository state prevents a safe branch transition (e.g., untracked files conflict), report the exact state and stop rather than forcing a checkout, stash, or hard reset.

#### Stage 3: Atomic Implementation
During the implementation of an authorized phase:
1. **Authorized Scope Only:** Implement strictly the deliverables belonging to the active phase. Do not begin later-phase functionality or implement speculative abstractions.
2. **Architectural Fidelity:** Follow `docs/architecture.md` and `docs/requirements-checklist.md` as the authoritative source of truth. Do not make unapproved architectural changes.
3. **Minimal Modifications:** Change only the files strictly required for that phase.
4. **Documentation Sync:** Update only relevant documentation and requirements checklist entries corresponding to the phase deliverables.
5. **No Automated Browser UI Agents:** All UI visual-fidelity and interactive dashboard reviews will be conducted manually by the developer without launching automated browser agents.

#### Stage 4: Verification Gate
After implementation completes:
1. **Execute Concrete Verification Commands:** Run the actual CLI commands relevant to the phase's acceptance criteria, including monorepo build, TypeScript typecheck, ESLint, automated test suites (unit, API, queue, rate-limit, recovery), database migrations, and health checks.
2. **Inspect Exit Codes & Output:** Inspect the exact exit codes and full command output. Tests pass only when exiting with code 0.
3. **Distinguish Executed vs. Proposed Checks:** Clearly distinguish commands that actually executed in the environment from proposed commands that are not yet configured or available.
4. **Diff & Security Review:** Review changed files and the complete git diff (`git diff`) for scope violations, hardcoded secrets, unintended file modifications, or architectural divergence.
5. **Criteria Mapping:** Map every single phase acceptance criterion to `PASS`, `FAIL`, `BLOCKED`, or `NOT TESTED`, supported by tangible command output or documented manual observation.
6. **Strict Checklist Verification Rule:** Update matching requirement IDs in `docs/requirements-checklist.md` to `Verified` only when tangible, passing evidence exists. Items without passing evidence must remain `In progress` or `Blocked`. Never mark `Verified` based on an assertion or unexecuted code.
7. **Gate Failure Protocol:** If any critical criterion fails or remains blocked, **DO NOT MERGE** and **DO NOT PROCEED** to the next phase. Report the failure and stop for review.

#### Stage 5: Review and Commit
Once verification succeeds:
1. **Engineering Review:** Produce a concise review evaluating design decisions, security posture, operational trade-offs, and remaining limitations.
2. **Diff Inspection:** Inspect the staged diff (`git diff --cached`) immediately before committing to guarantee zero stray files or secrets.
3. **Atomic Commit:** Commit only the verified changes belonging to the active phase, using clear conventional commit messages.
4. **Report Commit Metadata:** Record and report the commit hash and branch name.
5. **Developer Merge Gate:** Merge into `main` only after the verification gate passes and the developer has reviewed and approved the phase. Never claim that a commit, push, or merge occurred unless verified by git command output. If developer approval is required, stop and wait before merging.

#### Stage 6: Mandatory Phase Handoff
Every phase must conclude with a standardized handoff report before any subsequent work begins. See Section 10 for the exact 12-point handoff schema and required terminal decisions.

---

## 2. Current-State Assessment

An inspection of the workspace and Git state confirms the following actual project status:

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
Phase 10: Production Deployment, Documentation & Walkthrough (Cloud hosting, demo walkthrough, documentation)
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
| **Phase 10** | Deployment, Docs & Walkthrough | `DOC-01` to `DOC-21`, `QA-17`, `QA-20`, `SUB-01`, `SUB-04` to `SUB-10` | 31 |
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
- **Verification Commands:**
  - `[Proposed Command]` `pnpm install` (or `npm install`)
  - `[Proposed Command]` `npm run lint` && `npm run typecheck`
  - `[Existing Command]` `git check-ignore -v .env` (verifies `.env` is ignored)
- **Exit Criteria:** Clean monorepo compiles; linting and typecheck scripts pass.
- **Critical Blockers:** Invalid Node/npm version or dependency resolution conflicts.

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
- **Objective:** Build the modern React frontend with authentication guards, Scheduled/Sent email tables, CSV upload/parsing composer, and complete visual and functional review.
- **Checklist IDs Covered:** `FE-01`, `FE-02`, `FE-03`, `FE-04`, `FE-05`, `FE-06`, `FE-07`, `FE-08`, `FE-09`, `FE-10`, `FE-11`, `FE-12`, `FE-13`, `FE-14`, `FE-15`, `FE-16`, `FE-17`, `FE-18`, `FE-19`, `FE-20`, `FE-21`, `FE-22`, `FE-23`, `FE-24`, `FE-25`, `FE-26`, `AUTH-03`, `AUTH-04`, `AUTH-05`, `AUTH-11`, `AUTH-12`, `QA-19` (32 IDs).
- **Dependencies & Prerequisites:** Backend APIs from Phases 3, 4, 6, and 7; UI design tokens and components.
- **Concrete Deliverables:**
  - Clean login screen with Google Sign-In button.
  - Complete post-login dashboard redirect (`AUTH-11`).
  - Dashboard layout with navigation sidebar, header displaying user profile (`AUTH-03`, `AUTH-04`, `AUTH-05`) and logout action (`AUTH-12`).
  - Frontend route protection redirecting unauthenticated users to `/login`.
  - Scheduled Emails table displaying recipient, subject, scheduled time, and status badges.
  - Sent Emails table displaying recipient, subject, sent time, status badges, and Ethereal preview links.
  - Compose New Email modal/drawer with subject, body, start-time picker, delay input, hourly-limit input, and submit debouncing.
  - CSV/text file upload with real-time valid email counter, format validation, and deduplication.
  - Search bar connected to the Elasticsearch search API.
  - Loading skeletons, empty states, error handling, and toast notifications.
  - Developer manual visual-fidelity audit verifying implemented views (no browser agent).
- **Verification Commands:**
  - `[Proposed Command]` `npm run build --filter web` (clean build without TypeScript or styling errors)
  - `[Proposed Command]` `npm run test:unit -- web/components`
  - `[Manual UI Audit]` Side-by-side visual inspection by the developer verifying login, tables, composer, header, and empty/loading states.
- **Exit Criteria:** Complete UI functional, responsive, authenticated, and verified.
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

### Phase 10: Production Deployment (Oracle Cloud Always Free VM), Documentation, and Walkthrough
- **Objective:** Deploy full application stack to an **Oracle Cloud Infrastructure (OCI) Always Free VM** using Docker Compose fronted by an HTTPS reverse proxy, execute end-to-end smoke and resilience tests, document setup and limitations in `README.md`, and record the demo walkthrough.
- **Checklist IDs Covered:** `DOC-01`, `DOC-02`, `DOC-03`, `DOC-04`, `DOC-05`, `DOC-06`, `DOC-07`, `DOC-08`, `DOC-09`, `DOC-10`, `DOC-11`, `DOC-12`, `DOC-13`, `DOC-14`, `DOC-15`, `DOC-16`, `DOC-17`, `DOC-18`, `DOC-19`, `DOC-20`, `DOC-21`, `QA-17`, `QA-20`, `SUB-01`, `SUB-04`, `SUB-05`, `SUB-06`, `SUB-07`, `SUB-08`, `SUB-09`, `SUB-10` (31 IDs).
- **Dependencies & Prerequisites:** Phases 1–9 complete; provisioned Oracle Cloud Infrastructure Always Free VM (Ampere A1 ARM64 or AMD micro x86_64); registered domain name or dynamic DNS for TLS certificates; screen recording tool.
- **Concrete Deliverables:**
  - Deployment-time verification of target VM's actual CPU architecture (`uname -m`), available RAM (`free -m`), disk quota (`df -h`), and OCI VCN security list ingress/egress rules.
  - Multi-arch and ARM64 compatibility verification for container images (`postgres:16-alpine`, `redis:7-alpine`, `elasticsearch:8.x`, `node:20`) and dependencies if hosted on an Ampere A1 instance.
  - Single-host Docker Compose deployment orchestrating PostgreSQL 16, Redis 7 (AOF enabled), Elasticsearch 8 (heap bounded to `-Xms512m -Xmx512m`), Express API, BullMQ Worker, and React web client.
  - Reverse proxy (Nginx or Caddy) configuring public ports 80 and 443 with valid TLS certificates, proxying traffic to web and API, and strictly isolating internal ports (`5432`, `6379`, `9200`, Bull Board raw port) on a private Docker bridge network.
  - Production server-side environment variables configured with secure permissions (`chmod 600 .env`) and exact production OAuth redirect URIs registered in Google Cloud and Slack consoles.
  - Named Docker volume persistence for PostgreSQL, Redis, and Elasticsearch verified across container recreation.
  - Verification of API `/health` and `/ready` endpoints against live database, Redis, and Elasticsearch.
  - Verification of outbound SMTP connectivity from within the VM to Ethereal SMTP over port 587/465.
  - Resilience verification testing scheduled-job and outbox recovery after container restarts and after an intentional host VM reboot (`sudo reboot`).
  - Resource consumption monitoring under representative workload using `docker stats` to ensure memory stays within VM limits and worker concurrency remains bounded (`WORKER_CONCURRENCY`).
  - Comprehensive `README.md` containing architecture overview, local vs. cloud setup instructions, environment variable documentation, rate limiting explanation, and explicit disclosures of single-host failure boundaries and at-least-once SMTP semantics.
  - Walkthrough demo video demonstrating: scheduling, scheduled view, sent view with Ethereal preview, restart recovery, and rate limiting with Slack notification.
  - Video accessibility verified.
  - Secure repository configuration and push to remote.
- **Verification Commands:**
  - `[Deployment Check]` Host architecture & image compatibility: `uname -m && docker compose config`
  - `[Deployment Check]` Port scan / network isolation: `nmap -p 5432,6379,9200 <public-vm-ip>` (assert closed/filtered)
  - `[Deployment Check]` Outbound SMTP egress probe: `nc -zv smtp.ethereal.email 587`
  - `[Deployment Check]` Resource consumption check: `docker stats --no-stream`
  - `[Deployment Check]` Reboot resilience: schedule email, execute `sudo reboot`, confirm auto-restart and delivery completion after boot.
  - `[Manual / E2E Scenario]` Production smoke test: authenticate via Google on live URL, schedule email, observe delivery, test search.
  - `[Manual / E2E Scenario]` `QA-20` Multi-Provider OAuth Verification: Authenticate with real Google account and link real Slack workspace in both local development and hosted production environments, verifying live token exchanges, callback URL validity, and session persistence.
  - `[Manual Check]` Video link validation: check URL in private/incognito window without login.
  - `[Proposed Command]` Full test suite: `npm test` across all packages passes cleanly.
- **Exit Criteria:** Live application accessible over HTTPS on cloud VM; repository code pushed; demo walkthrough complete.
- **Critical Blockers:** Cloud VM capacity unavailability, ARM64 dependency incompatibilities, blocked outbound SMTP ports, or slow DNS propagation for TLS/OAuth.

---

## 6. Critical-Path Strategy

To maximize progress and avoid getting stranded in secondary features, the roadmap establishes an **Early Critical Path** focused strictly on the core scheduling and delivery loop:

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
| **11. Target Deployment (OCI Always Free VM)** | **Constrained single-host Docker Compose deployment.** Target an Oracle Cloud Always Free VM (Ampere A1 ARM64 or AMD micro). ARM64 compatibility is a requirement if using Ampere A1. Resource budgeting is mandatory—specifically capping Elasticsearch heap (`-Xms512m -Xmx512m`) to prevent OOM termination. Internal ports (5432, 6379, 9200) remain strictly isolated on a private Docker network behind an HTTPS reverse proxy (Nginx/Caddy). Outbound SMTP egress (port 587/465) must be verified through OCI security lists. Single-host volume persistence does not protect against VM loss; persistent recovery is tested across container restarts and host reboots. |

---

## 8. Layered Verification Strategy

Verification must proceed systematically from low-level unit tests to end-to-end integration:

```text
Level 1: Static Verification   ──► npm run lint && npm run typecheck
Level 2: Unit Testing          ──► npm run test:unit (parsers, validators, rate-limit math)
Level 3: Integration Testing   ──► npm run test:api && npm run test:queue (DB, BullMQ, SMTP)
Level 4: Concurrency & Limits  ──► npm run test:ratelimit && npm run test:load (1k batch)
Level 5: Resilience & Recovery ──► npm run test:recovery (process kills, post-SMTP crash)
Level 6: Manual UI Audit       ──► Manual visual and functional review of views
Level 7: Hosted Smoke Testing  ──► End-to-end user verification on live deployment URL
```

---

## 9. Implementation Timeline and Phase Allocation

Planned execution is structured across 10 implementation phases with built-in contingency to absorb external integration and deployment requirements:

| Timeline Window | Phase | Focus Area | Planned Allocation | Cumulative |
|---|---|---|---|---|
| **Hours 0.0 – 2.5** | Phase 1 | Monorepo scaffolding, TypeScript configs, ESLint/Prettier, `.env.example`, `.gitignore` | 2.5 hours | 2.5h |
| **Hours 2.5 – 6.0** | Phase 2 | Docker Compose (PostgreSQL, Redis, Elasticsearch), initial migrations, Express/Vite skeletons, `/health` and `/ready` | 3.5 hours | 6.0h |
| **Hours 6.0 – 10.0** | Phase 3 | Zod validation, CSV recipient parser, BullMQ delayed job enqueueing, idempotency middleware, list endpoints | 4.0 hours | 10.0h |
| **Hours 10.0 – 14.0** | Phase 4 | **Critical-Path Milestone:** Atomic claim query, Ethereal SMTP send, attempt tracking, restart reconciliation, crash scenario | 4.0 hours | 14.0h |
| **Hours 14.0 – 19.0** | Phase 5 | Redis Lua min-delay & hourly quota scripts, job deferrals without drop, 1k batch test | 5.0 hours | 19.0h |
| **Hours 19.0 – 22.0** | Phase 6 | Backend Google OAuth, session cookies, unauthenticated 401s, user/tenant query scoping (403) | 3.0 hours | 22.0h |
| **Hours 22.0 – 25.0** | Phase 7 | Elasticsearch outbox indexing consumer, tenant-scoped search API, reindexing recovery script | 3.0 hours | 25.0h |
| **Hours 25.0 – 30.0** | Phase 8 | React dashboard, modern visual styling, composer, CSV upload, login redirect, header profile, manual UI audit | 5.0 hours | 30.0h |
| **Hours 30.0 – 33.0** | Phase 9 | Slack OAuth, deduplicated rate-limit alerts, protected Bull Board route | 3.0 hours | 33.0h |
| **Hours 33.0 – 36.0** | Phase 10 | Cloud VM deployment (Docker Compose, HTTPS reverse proxy, ARM64 verification, reboot recovery), README docs, feature walkthrough | 3.0 hours | 36.0h |
| **Hours 36.0 – 48.0** | **Buffer** | **Dedicated Contingency Reserve** (OAuth DNS/redirects, cloud hosting setup, edge-case debugging) | **12.0 hours** | **48.0h** |

### Priority & Scope Safeguards:
- **Mandatory System Core:** The critical-path delivery loop (Phases 1–4), distributed rate limits (Phase 5), Google and Slack OAuth (Phases 6 & 9), Elasticsearch search (Phase 7), and dashboard views (Phase 8) are non-negotiable requirements.
- **Deferrable Optional Polish:** If contingency is heavily drawn upon, prioritize backend correctness, rate limiting, and core UI functionality over secondary visual polish (such as complex micro-animations or custom theme toggles).

---

## 10. Mandatory Phase Handoff Protocol

Every phase execution must terminate with a structured handoff report containing exactly these 12 sections:

1. **Phase Identification:** Phase number, name, and checklist requirement IDs addressed.
2. **File Inventory:** Complete list of changed, added, and deleted files.
3. **Acceptance Criteria Results:** Explicit table mapping each phase acceptance criterion to `PASS`, `FAIL`, `BLOCKED`, or `NOT TESTED` with supporting evidence.
4. **Commands Executed & Exit Codes:** Exact commands run in the environment, actual exit codes, and meaningful test output snippets.
5. **Verifications Performed:** Database migrations, API checks, integration checks, and failure scenarios actually verified.
6. **Diff Review & Architectural Assessment:** Analysis of the staged diff against architectural invariants, security rules, and file scope boundaries.
7. **Checklist Status Updates:** Concrete changes to `docs/requirements-checklist.md` (only moving to `Verified` with verified evidence).
8. **Known Limitations & Deferred Work:** Documented edge cases, trade-offs, or items deferred to later phases.
9. **Documentation Updated:** List of documentation files created or modified during the phase.
10. **Git State & Metadata:** Branch name, commit hash, and merge status (or pending review status).
11. **Time Tracking:** Time spent in the active phase and remaining contingency budget against the planned schedule.
12. **Next Phase Prerequisites:** Exact starting point, dependencies, and requirements for the subsequent phase.

### Terminal Gate Decisions:
The handoff report must conclude with exactly one of the following three decisions:

- **`READY FOR DEVELOPER REVIEW`** — All deliverables implemented, all verification commands passed (exit code 0), git diff verified clean, ready for human review before merge.
- **`BLOCKED — ACTION REQUIRED`** — External dependency missing, architectural conflict detected, or credentials needed. Work is paused pending developer intervention.
- **`VERIFICATION FAILED — DO NOT MERGE`** — One or more acceptance criteria, builds, or tests failed. Branch must not be merged to `main`.

> [!CAUTION]
> **Strict Execution Stop Rule:**
> An AI agent or automated executor must **NEVER** automatically begin the next phase after producing the handoff report. It must stop and await the developer's explicit review and approval.

---

## 11. Final Completion Gate

Before completing the rollout, the following criteria must be affirmed:

- [x] **Repository Security:** Repository access controls and branch protections are configured (`SUB-01`).
- [x] **Code & Commits:** Clean working tree with committed lockfile and passing test suites (`SUB-04`).
- [x] **Hosted Application:** Containerized production Compose stack configured with reverse proxy and TLS (`SUB-05`).
- [x] **Demo Walkthrough:** Documented walkthrough demonstrating scheduling, views, recovery, rate limits, and Slack alert (`SUB-06` to `SUB-10`).
- [x] **Documentation Complete:** README setup instructions, architecture specifications, and environment configuration templates verified.
