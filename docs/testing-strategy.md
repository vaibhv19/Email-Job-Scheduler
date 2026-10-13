# ReachInbox Email Scheduler — Testing Strategy

> **Document Purpose:** Define the testing principles, layered test architecture, requirement traceability, critical failure scenarios, execution environments, test-isolation safeguards, and evidence standards for the ReachInbox Full-stack Email Job Scheduler assignment.
>
> **Authority:** Subordinate to [`docs/requirements-checklist.md`](file:///d:/Work/Projects----Commercial/Outbox%20Labs/Assignment/docs/requirements-checklist.md) (authoritative requirements source of truth) and [`docs/architecture.md`](file:///d:/Work/Projects----Commercial/Outbox%20Labs/Assignment/docs/architecture.md) (authoritative architectural decisions).

---

## 1. Testing Principles

1. **Verify Actual Behavior:** Tests must assert real system outcomes (database state transitions, Redis job states, SMTP delivery receipts, rate-limit spacing) rather than mocking away core application logic.
2. **Evidence-Based Verification:** A requirement in [`docs/requirements-checklist.md`](file:///d:/Work/Projects----Commercial/Outbox%20Labs/Assignment/docs/requirements-checklist.md) may be marked `Verified` only after a concrete test passes or a structured manual check produces documented evidence. Never mark `Verified` based on a plan, generated code, or an AI agent's unsupported assertion.
3. **Automated vs. Manual Separation:** Automated unit, integration, and load tests must run headless via CLI commands. Manual verification is strictly reserved for live external OAuth handshakes, visual UI fidelity checks, and submission forms.
4. **No Automated Browser Agents for UI:** In accordance with project instructions, all frontend visual-fidelity reviews against the supplied ReachInbox reference screens will be performed manually by the developer without launching automated browser agents.
5. **Zero Dependency on Production Secrets:** Automated CI/local test suites must never require live third-party production credentials. External integrations (Ethereal SMTP, Google OAuth, Slack API) must use test fixtures, sandbox credentials, or isolated test harnesses during automated testing. Mock OAuth callbacks in unit/API tests; verify real OAuth flows during development and production gates.
6. **Strict Test Isolation:** Tests must never alter, flush, or truncate development or production data. Automated tests connect to dedicated test databases and reserved, disposable Redis targets. Teardown must rely on targeted key deletion rather than destructive database-wide cleanup like `FLUSHALL` or `FLUSHDB`.
7. **Honest Reporting:** Tests must be reported as passing only when executed with exit code 0. Failures, race conditions, or unverified scenarios must be documented as `Blocked` or `In progress` rather than hidden.
8. **Performance Targets as Goals:** Runtime performance targets (e.g., unit tests finishing in under 2 seconds) are ergonomic developer targets, not hard correctness requirements, unless specifically mandated by assignment SLAs.
9. **Delivery Guarantees Integrity:** BullMQ processing provides at-least-once delivery; tests must never claim or assume impossible exactly-once SMTP delivery. Stable Message-IDs aid traceability but do not guarantee provider deduplication. PostgreSQL remains the authoritative source of truth.

---

## 2. Layered Testing Architecture

The test suite is organized into five complementary tiers:

```text
┌────────────────────────────────────────────────────────┐
│ Tier 5: Manual & Visual Verification                   │
│ (Figma/Reference fidelity, real OAuth, ClickUp form)   │
├────────────────────────────────────────────────────────┤
│ Tier 4: Concurrency & Stress Tests                     │
│ (1,000+ batch, multi-worker race conditions, crash sim)│
├────────────────────────────────────────────────────────┤
│ Tier 3: Worker & Integration Tests                     │
│ (PostgreSQL, BullMQ/Redis, Ethereal SMTP, ES outbox)   │
├────────────────────────────────────────────────────────┤
│ Tier 2: API & Route Integration Tests                  │
│ (Express routes, middleware, validation, auth scoping) │
├────────────────────────────────────────────────────────┤
│ Tier 1: Unit Tests (Fast, Isolated, In-Memory)         │
│ (Zod schemas, CSV parser, rate-limit math, formatters) │
```

### 2.1 Tier 1: Unit Tests
- **Scope:** Pure functions and isolated domain logic running in memory without external services or network calls.
- **Components:**
  - Recipient parsing and validation (`parseRecipients`, email regex, deduplication).
  - Validation schemas (Zod request schemas for schedule payloads, query params, and configs).
  - Rate-limiting math and schedule offset calculations.
  - Consistent error envelope sanitization and formatting.

### 2.2 Tier 2: API & Route Integration Tests
- **Scope:** HTTP request/response testing against Express route handlers using Supertest against an isolated test database.
- **Components:**
  - Input validation and HTTP 400 error responses (`QA-01`).
  - Idempotency middleware caching and header handling (`QA-04`).
  - Session authentication middleware and HTTP 401 unauthenticated rejections (`AUTH-07`, `AUTH-13`).
  - Tenant query scoping ensuring cross-user access returns HTTP 403 or 404 (`QA-14`).
  - API pagination, sorting, and status filtering (`BE-14`).

### 2.3 Tier 3: Service & Worker Integration Tests
- **Scope:** Real interactions with PostgreSQL (`reachinbox_test`), Redis/BullMQ (isolated database `REDIS_DB=15`), and Ethereal SMTP transport.
- **Components:**
  - Database persistence and constraint validation across simulated restarts (`QA-02`).
  - BullMQ delayed job enqueueing and deterministic job ID verification (`BE-05`, `BE-07`).
  - Atomic email claiming (`SELECT ... FOR UPDATE SKIP LOCKED` / conditional update) preventing duplicate worker pickup (`QA-05`).
  - Nodemailer delivery to Ethereal SMTP, capturing SMTP 250 response, message ID, and preview URL (`SMTP-01` to `SMTP-04`).
  - Elasticsearch asynchronous indexing from outbox events and search API querying (`QA-13`).

### 2.4 Tier 4: Concurrency, Rate-Limit, and Recovery Tests
- **Scope:** Multi-worker execution, stress conditions, distributed rate limiting, and crash recovery.
- **Components:**
  - Minimum send delay enforcement across concurrent workers (`QA-07`).
  - Hourly quota window enforcement across concurrent workers via Redis Lua scripts (`QA-08`).
  - Job deferral when quota is exhausted without dropping or failing records (`QA-09`).
  - Load test scheduling 1,000+ emails in a single batch without dropping jobs or exceeding concurrency (`QA-15`).
  - Worker restart and stalled job reconciliation (`QA-06`).
  - Post-SMTP acceptance crash simulation and conservative recovery (`QA-18`).

### 2.5 Tier 5: Manual & End-to-End Verification
- **Scope:** Live integrations requiring human inspection or developer credentials.
- **Components:**
  - Side-by-side visual fidelity audit against ReachInbox reference screens (`FE-26`, `QA-19`).
  - Live Google OAuth flow with real Google account and session cookie verification (`QA-11`).
  - Live Slack OAuth and real rate-limit notification receipt in a connected workspace (`QA-10`).
  - Dual-provider callback URL verification in development and production environments (`QA-20`).
  - ClickUp form completion and repository collaborator review checks (`SUB-01` to `SUB-25`).

---

## 3. Comprehensive Requirement Traceability Matrix

Every single requirement ID (195 total) from [`docs/requirements-checklist.md`](file:///d:/Work/Projects----Commercial/Outbox%20Labs/Assignment/docs/requirements-checklist.md) is accounted for in the testing strategy below:

### 3.1 Project Foundation and Infrastructure (`INF-01` to `INF-14`)

| ID | Requirement | Primary Testing Tier | Verification Method & Pass Evidence |
|---|---|---|---|
| `INF-01` | Create a private GitHub repository | Tier 5 (Manual) | Repository visibility confirmed as Private in GitHub repository settings |
| `INF-02` | Set up a TypeScript monorepo | Tier 1 (Static) | Run monorepo build command (`npm run build`); API, worker, and web compile cleanly |
| `INF-03` | Configure Express.js backend | Tier 2 (API) | Run `npm run dev --filter api`; API starts and `curl http://localhost:3001/health` returns 200 OK |
| `INF-04` | Configure React frontend with TypeScript and Tailwind CSS | Tier 3 (Integration) | Run `npm run build --filter web`; frontend compiles without errors and UI renders in browser |
| `INF-05` | Configure PostgreSQL with migrations | Tier 3 (Integration) | Run migration script (`npm run db:migrate`); tables are created and confirmed via database query |
| `INF-06` | Configure Redis | Tier 3 (Integration) | Run `redis-cli ping`; responds with `PONG`; BullMQ establishes connection without error |
| `INF-07` | Configure Elasticsearch | Tier 3 (Integration) | Run `curl http://localhost:9200/_cluster/health`; cluster responds green/yellow and index is created |
| `INF-08` | Configure Docker Compose for local development | Tier 3 (Integration) | Run `docker compose -f infra/docker-compose.yml up -d`; PostgreSQL, Redis, and Elasticsearch containers start and pass healthchecks |
| `INF-09` | Persist PostgreSQL and Redis data across restarts | Tier 3 (Integration) | Restart containers (`docker compose down && docker compose up -d`); verify stored tables and Redis keys persist |
| `INF-10` | Provide environment variable templates | Tier 1 (Static) | Inspect `.env.example`; verify all required configuration keys are documented with safe placeholder values |
| `INF-11` | Separate API and worker into independent processes | Tier 3 (Integration) | Launch API and worker in separate processes; verify each process starts, operates, and terminates independently |
| `INF-12` | Configure health and readiness checks | Tier 2 (API) | Query `GET /health` (liveness) and `GET /ready` (readiness with DB/Redis/ES checks); verify accurate 200/503 responses |
| `INF-13` | Configure TypeScript, linting, formatting, and test runners | Tier 1 (Static) | Run `npm run lint`, `npm run typecheck`, and `npm test`; all commands complete with zero errors |
| `INF-14` | Prevent secrets from entering source control | Tier 1 (Static) | Run `git status --ignored` and check commit history; verify `.env`, secret files, and credentials are excluded |

### 3.2 Email Scheduling API and Persistence (`BE-01` to `BE-17`)

| ID | Requirement | Primary Testing Tier | Verification Method & Pass Evidence |
|---|---|---|---|
| `BE-01` | Accept email scheduling requests | Tier 2 (API) | Execute `POST /api/emails/schedule` with valid payload; receive 201 Created with email and job IDs |
| `BE-02` | Persist email records in a relational database | Tier 3 (Integration) | Query `emails` table in PostgreSQL after scheduling; records exist with correct timestamps, recipients, and status |
| `BE-03` | Support single and bulk recipients in a scheduling request | Tier 2 (API) | Send payload containing multiple recipient email addresses; verify individual logical email records are created per recipient |
| `BE-04` | Validate recipient email addresses, subject, body, and schedule time | Tier 1 / Tier 2 (Unit / API) | Send requests with invalid emails, missing subject/body, and past dates; verify HTTP 400 Bad Request with field-level errors |
| `BE-05` | Use BullMQ delayed jobs backed by Redis for scheduling | Tier 3 (Integration) | Inspect Redis delayed job zset via BullMQ API or Bull Board; verify job delay matches `scheduled_at - now` |
| `BE-06` | Avoid cron jobs and process-local scheduling timers | Tier 1 (Static) | Codebase audit confirms zero dependencies on `node-cron`, `cron`, OS crontab, or in-memory `setTimeout` timers for job triggers |
| `BE-07` | Support deterministic queue job IDs | Tier 3 (Integration) | Schedule job with known email UUID; verify BullMQ `jobId` equals email UUID and re-adding duplicate job ID is idempotent |
| `BE-08` | Make scheduling requests idempotent | Tier 2 (API) | Submit identical request with identical `Idempotency-Key` header twice; verify second request returns cached response without duplicate rows |
| `BE-09` | Recover scheduled jobs after application restarts | Tier 3 (Integration) | Terminate API and worker while jobs are pending, restart services, and observe pending jobs fire at scheduled time |
| `BE-10` | Recover from database-to-queue partial failures | Tier 3 (Integration) | Simulate queue enqueue failure after DB write; run reconciliation command; verify missing BullMQ job is identified and created |
| `BE-11` | Support email status tracking state machine | Tier 3 (Integration) | Observe status transitions: `scheduled` -> `processing` -> `sent` (or `failed`) recorded in PostgreSQL with timestamps |
| `BE-12` | Prevent concurrent workers from claiming the same email | Tier 4 (Concurrency) | Run two parallel workers claiming the same batch; verify no record is claimed by more than one worker |
| `BE-13` | Handle worker crashes and stalled jobs | Tier 4 (Recovery) | Force kill worker process mid-execution; verify stalled job is reclaimed and reconciled without duplicate send |
| `BE-14` | Support API pagination and filtering for email lists | Tier 2 (API) | Request list endpoints with `limit`, `page`, and status filters; verify bounded result sets and accurate pagination metadata |
| `BE-15` | Support multiple sender configurations | Tier 3 (Integration) | Schedule emails with distinct `sender_id` values; verify each email associates with the intended sender config |
| `BE-16` | Handle past or invalid scheduling times | Tier 1 / Tier 2 (Unit / API) | Submit scheduling request with a timestamp in the past; verify rejected with clear validation error per policy |
| `BE-17` | Provide consistent API error envelope | Tier 2 (API) | Trigger various 4xx/5xx errors; verify uniform JSON response format `{ error: { code, message, details } }` |

### 3.3 SMTP Delivery and Idempotency (`SMTP-01` to `SMTP-09`)

| ID | Requirement | Primary Testing Tier | Verification Method & Pass Evidence |
|---|---|---|---|
| `SMTP-01` | Send emails through Ethereal SMTP | Tier 3 (Integration) | Execute worker job; verify Nodemailer sends email to Ethereal and receives SMTP 250 acceptance response |
| `SMTP-02` | Support multiple sender SMTP configurations | Tier 3 (Integration) | Configure multiple Ethereal accounts/credentials; verify worker uses correct credentials matching `sender_id` |
| `SMTP-03` | Store delivery outcomes and timestamps | Tier 3 (Integration) | Verify `sent_at`, `status = 'sent'`, and provider response metadata are persisted in PostgreSQL |
| `SMTP-04` | Store Ethereal preview URLs where available | Tier 3 (Integration) | Inspect database record for sent email; verify `preview_url` contains accessible Ethereal URL (`nodemailer.getTestMessageUrl`) |
| `SMTP-05` | Generate a stable Message-ID per logical email | Tier 3 (Integration) | Inspect sent email headers; verify `Message-ID` is stable across attempts and uniquely derived from email ID |
| `SMTP-06` | Classify retryable and permanent failures | Tier 3 (Integration) | Mock transient 4xx SMTP error (verify retry) and permanent 5xx error (verify immediate transition to `failed`) |
| `SMTP-07` | Avoid duplicate logical email creation | Tier 3 (Integration) | Audit DB schema for unique constraints; verify batch inputs deduplicate duplicate recipients per logical message |
| `SMTP-08` | Handle ambiguous SMTP outcomes conservatively | Tier 4 (Recovery) | Inspect attempt log when connection drops during send; verify record marked for conservative reconciliation without blind re-send |
| `SMTP-09` | Document the exactly-once delivery limitation | Tier 1 (Static) | Inspect documentation; verify clear disclosure that network/SMTP crashes cannot guarantee exactly-once delivery at SMTP layer |

### 3.4 Worker Concurrency, Delay, and Hourly Rate Limits (`RATE-01` to `RATE-21`)

| ID | Requirement | Primary Testing Tier | Verification Method & Pass Evidence |
|---|---|---|---|
| `RATE-01` | Configure worker concurrency through environment variables | Tier 4 (Concurrency) | Verify the worker reads `WORKER_CONCURRENCY` from the environment; verify that the number of simultaneously processed jobs respects that value and remains bounded under load; change the configured value (e.g., from 1 to 5) and restart or reconfigure the worker as appropriate, verifying that active job-processing concurrency scales to the new bound (distinguishing job-processing concurrency from thread count) |
| `RATE-02` | Enforce a minimum delay between individual sends | Tier 4 (Concurrency) | Measure timestamps of consecutive emails for same sender; verify interval is >= configured `min_send_interval_ms` |
| `RATE-03` | Enforce delay across concurrent workers | Tier 4 (Concurrency) | Run 3 concurrent workers processing queue for same sender; verify delay between sends is strictly maintained across workers |
| `RATE-04` | Implement configurable hourly email quotas | Tier 4 (Concurrency) | Set hourly limit of 5; verify 6th email is prevented from sending within that hour |
| `RATE-05` | Enforce quotas across multiple workers or instances | Tier 4 (Concurrency) | Run multiple worker processes attempting parallel sends; verify aggregate count in window never exceeds limit |
| `RATE-06` | Scope limits per sender or tenant | Tier 4 (Concurrency) | Send emails from Sender A and Sender B; verify Sender A hitting limit does not throttle or delay Sender B |
| `RATE-07` | Configure limit values without hardcoding | Tier 4 (Concurrency) | Update environment or request configuration; verify system immediately applies updated limits |
| `RATE-08` | Define how UI limits relate to server limits | Tier 1 / Tier 2 (Unit / API) | Submit UI values exceeding server caps; verify server-side validation enforces server caps and rejects or bounds input |
| `RATE-09` | Reschedule jobs when the hourly quota is exhausted | Tier 4 (Concurrency) | When quota is exhausted, move job delay to start of next UTC hour; verify job transitions to delayed state in BullMQ |
| `RATE-10` | Preserve job order as far as practical during deferral | Tier 4 (Concurrency) | Inspect scheduled times of deferred batch; verify relative ordering of emails is preserved in future window |
| `RATE-11` | Avoid treating quota exhaustion as delivery failure | Tier 4 (Concurrency) | Inspect database status of deferred emails; verify status remains `scheduled` rather than transitioning to `failed` |
| `RATE-12` | Handle quota reservations and failure/recovery policy across workers | Tier 4 (Concurrency) | Document and test the chosen hourly quota reservation and accounting policy across scenarios: (1) permanent SMTP rejection, (2) transient failure awaiting retry, (3) worker crash before initiating SMTP delivery, and (4) crash after SMTP acceptance but before recording success in database. Verify quota accounting remains safe across multiple workers; retries or refunds never cause the hourly limit to be exceeded; reservations are never blindly refunded when delivery outcome is ambiguous; reservation expiration, recovery, or reconciliation behavior is explicitly defined; distinctions between quota exhaustion, delivery failure, and ambiguous outcomes are preserved; and at-least-once delivery limitations are documented without claiming exactly-once SMTP delivery |
| `RATE-13` | Handle 1,000 or more emails scheduled at similar times | Tier 4 (Stress) | Execute load test script scheduling 1,000 emails; verify all 1,000 records persist and 1,000 BullMQ jobs are enqueued |
| `RATE-14` | Avoid unbounded simultaneous delivery | Tier 4 (Concurrency) | Under 1,000-email load, monitor active network connections; verify concurrency never exceeds configured bounds |
| `RATE-15` | Document throttling and quota trade-offs | Tier 1 (Static) | Inspect documentation for explanation of window boundaries, Redis atomic script semantics, and ordering trade-offs |
| `RATE-16` | Execution times for a batch must respect requested start time and configured minimum delay between sends | Tier 4 (Concurrency) | Schedule a batch of emails with start time T and delay D; verify recorded send times are >= T and spaced by >= D |
| `RATE-17` | Defer remaining emails when hourly quota is exhausted rather than dropping or permanently failing them | Tier 4 (Concurrency) | Set hourly quota N; schedule batch of N+M emails; verify N emails send in current hour and M emails are deferred to next window without dropping |
| `RATE-18` | Deferral must preserve job identity and avoid duplicate email creation or scheduling | Tier 4 (Concurrency) | Inspect deferred jobs; verify original `email_id` and BullMQ `jobId` are preserved without inserting duplicate database rows |
| `RATE-19` | Test the interaction between requested start time, per-sender delay, hourly quota, and multiple workers | Tier 4 (Concurrency) | Run automated multi-worker test with start time, delay, and hourly quota; verify all constraints hold concurrently across worker instances |
| `RATE-20` | Define and test behavior when calculated send time crosses into another hourly quota window or overlaps with another batch | Tier 4 (Concurrency) | Schedule overlapping batches crossing hourly boundary; verify quota rolls over correctly and send order is preserved deterministically |
| `RATE-21` | Enforce that an email is never sent before all applicable scheduling, delay, and rate-limit constraints permit it | Tier 4 (Concurrency) | Assert that for every sent email: `actual_send_time >= scheduled_at`, interval from previous sender send >= `min_send_interval`, and hourly quota not exceeded |

### 3.5 Slack OAuth and Notifications (`SLACK-01` to `SLACK-12`)

| ID | Requirement | Primary Testing Tier | Verification Method & Pass Evidence |
|---|---|---|---|
| `SLACK-01` | Implement real Slack OAuth | Tier 2 / Tier 5 (API / Manual) | Initiate OAuth exchange; verify authorization code is exchanged for access token via Slack API |
| `SLACK-02` | Provide a Connect Slack action in frontend | Tier 5 (Manual UI) | Click 'Connect Slack' in UI; verify redirect to Slack authorization page with correct client_id and scopes |
| `SLACK-03` | Validate OAuth state parameter | Tier 2 / Tier 5 (API / Manual) | Send callback request with missing or mismatched `state` param; verify HTTP 400 Bad Request and abort |
| `SLACK-04` | Store Slack credentials per user or tenant | Tier 3 (Integration) | Query `slack_connections` table; verify access token and metadata are associated with authenticated `user_id` |
| `SLACK-05` | Secure stored credentials | Tier 3 (Integration) | Verify token is stored encrypted in database; inspect API `/api/slack/connection` response to ensure token is excluded |
| `SLACK-06` | Support disconnect and reconnect | Tier 2 / Tier 5 (API / Manual) | Click 'Disconnect' in UI; verify record is removed/revoked; reconnecting successfully establishes a new connection |
| `SLACK-07` | Send an actual message when a sender hits its hourly limit | Tier 5 (Manual E2E) | Trigger rate-limit quota exhaustion; verify real message appears in configured Slack channel |
| `SLACK-08` | Avoid duplicate alerts per sender and quota window | Tier 4 (Concurrency) | Trigger multiple blocked jobs in same hour; verify only one notification is sent to Slack for that sender window |
| `SLACK-09` | Handle missing Slack connections gracefully | Tier 3 (Integration) | Exhaust quota when Slack is not connected; verify job deferral succeeds without throwing unhandled exceptions |
| `SLACK-10` | Support connecting Slack after deployment without restart | Tier 3 (Integration) | Connect Slack on a running instance; verify subsequent rate limit alerts are sent immediately without restart |
| `SLACK-11` | Handle Slack API failures without failing email jobs | Tier 3 (Integration) | Mock Slack API 500 error; verify rate-limit notification failure is logged but email job remains safely deferred |
| `SLACK-12` | Verify real Slack OAuth end-to-end with configured credentials and callback URL | Tier 5 (Manual E2E) | Execute full OAuth flow against a live Slack workspace with real app credentials; verify valid callback URL handling, token exchange, and message delivery |

### 3.6 Google Authentication and Authorization (`AUTH-01` to `AUTH-15`)

| ID | Requirement | Primary Testing Tier | Verification Method & Pass Evidence |
|---|---|---|---|
| `AUTH-01` | Implement real Google OAuth login | Tier 2 / Tier 5 (API / Manual) | Real Google OAuth login initiates and succeeds with Google Identity |
| `AUTH-02` | Create or retrieve the local user record | Tier 3 (Integration) | Authenticated Google profile creates or retrieves local user row in PostgreSQL |
| `AUTH-03` | Display user name | Tier 5 (Manual UI) | Authenticated user display name is visible in dashboard header |
| `AUTH-04` | Display user email | Tier 5 (Manual UI) | Authenticated user email is visible in dashboard header |
| `AUTH-05` | Display user avatar | Tier 5 (Manual UI) | Authenticated user avatar image renders when profile image URL is present |
| `AUTH-06` | Implement logout | Tier 2 (API) | Click logout; verify session cookie/token is invalidated and user is redirected to login |
| `AUTH-07` | Protect user-specific APIs | Tier 2 (API) | Send request to private API without session; verify HTTP 401 Unauthorized |
| `AUTH-08` | Enforce record ownership | Tier 2 (API) | Authenticate as User A and attempt to query/modify User B's email; verify HTTP 403 Forbidden or 404 Not Found |
| `AUTH-09` | Configure local and production OAuth redirects | Tier 2 / Tier 5 (API / Manual) | OAuth callback functions properly on `localhost` during dev and on production domain when hosted |
| `AUTH-10` | Handle authentication errors and expired sessions | Tier 2 (API) | Expired session returns 401; frontend prompts user to re-authenticate cleanly |
| `AUTH-11` | Redirect to dashboard upon successful Google login | Tier 5 (Manual UI) | Complete Google login; verify browser automatically redirects to `/dashboard` route with active session |
| `AUTH-12` | Display authenticated user info (name, email, avatar) and logout in dashboard header | Tier 5 (Manual UI) | Inspect dashboard header; verify user's display name, email, avatar image, and functional logout button are rendered |
| `AUTH-13` | Prevent unauthenticated access to protected dashboard data and API endpoints | Tier 5 (Manual UI) | Send unauthenticated requests to `/api/emails/*`; verify HTTP 401; verify frontend routes redirect unauthenticated users to `/login` |
| `AUTH-14` | Backend verifies authenticated user ownership when reading or modifying data | Tier 2 (API) | Attempt cross-user query/mutation; verify database queries filter by authenticated `user_id` and reject cross-tenant access |
| `AUTH-15` | Verify real Google OAuth end-to-end with configured credentials and callback URL | Tier 5 (Manual E2E) | Execute real Google OAuth flow with live Client ID/Secret and configured callback URL; verify user consent, profile extraction, and session creation |

### 3.7 Frontend Dashboard and Composer (`FE-01` to `FE-26`)

| ID | Requirement | Primary Testing Tier | Verification Method & Pass Evidence |
|---|---|---|---|
| `FE-01` | Reproduce ReachInbox-style visual theme and layout | Tier 5 (Manual UI) | Inspect layout structure, dark/light theme styling, typography, and iconography matching ReachInbox design |
| `FE-02` | Implement clean login page | Tier 5 (Manual UI) | Navigate to `/login`; verify clean login screen with branded Google Sign-In button |
| `FE-03` | Implement main dashboard navigation and shell | Tier 5 (Manual UI) | Log in; verify persistent sidebar/navigation, active route highlighting, and main content area |
| `FE-04` | Implement Scheduled Emails view | Tier 5 (Manual UI) | Navigate to Scheduled tab; verify table/list of pending scheduled emails with appropriate column headers |
| `FE-05` | Implement Sent Emails view | Tier 5 (Manual UI) | Navigate to Sent tab; verify table/list of delivered and failed emails with outcome indicators |
| `FE-06` | Display recipient email in tables | Tier 5 (Manual UI) | Inspect table row; verify recipient email matches backend `recipient_email` |
| `FE-07` | Display subject in tables | Tier 5 (Manual UI) | Inspect table row; verify email subject matches backend `subject` |
| `FE-08` | Display scheduled and sent timestamps in clear timezone | Tier 5 (Manual UI) | Inspect timestamp displays; verify localized formatting with clear timezone indication (e.g. UTC or local) |
| `FE-09` | Display status badge in tables | Tier 5 (Manual UI) | Inspect table row; verify distinct visual badges for `scheduled`, `processing`, `sent`, and `failed` |
| `FE-10` | Implement Compose New Email action | Tier 5 (Manual UI) | Click 'Compose'; verify compose modal or slide-over drawer opens smoothly |
| `FE-11` | Provide subject input with validation | Tier 5 (Manual UI) | Enter subject; verify required field validation triggers if empty upon submission |
| `FE-12` | Provide body input with rich/plain text support | Tier 5 (Manual UI) | Enter email body; verify text is preserved and submitted in payload |
| `FE-13` | Support CSV and text recipient uploads | Tier 1 / Tier 2 (Unit / API) | Upload sample CSV and `.txt` files; verify parser extracts recipient list correctly |
| `FE-14` | Show count of detected valid email addresses | Tier 5 (Manual UI) | Upload CSV with 15 emails; verify UI displays '15 valid recipients detected' |
| `FE-15` | Validate and deduplicate uploaded recipients | Tier 1 / Tier 2 (Unit / API) | Upload CSV with duplicate and malformed emails; verify invalid addresses are flagged and duplicates are deduplicated |
| `FE-16` | Provide start-time picker for scheduling | Tier 5 (Manual UI) | Select future date and time; verify selected ISO timestamp is submitted in `scheduled_at` |
| `FE-17` | Provide per-sender delay input | Tier 5 (Manual UI) | Input minimum delay in seconds/milliseconds; verify value is submitted to API |
| `FE-18` | Provide hourly-limit input | Tier 5 (Manual UI) | Input max emails per hour; verify value is submitted to API |
| `FE-19` | Display loading skeletons and button spinners | Tier 5 (Manual UI) | Trigger async requests; verify loading skeletons in tables and spinner on submit button |
| `FE-20` | Display clear empty states | Tier 5 (Manual UI) | View Scheduled or Sent tables when no records exist; verify helpful graphic and empty message |
| `FE-21` | Display toast notifications for success and error events | Tier 5 (Manual UI) | Complete scheduling or trigger API error; verify toast appears with appropriate styling and auto-dismisses |
| `FE-22` | Use reusable, typed components across frontend | Tier 1 (Static) | Inspect code; verify shared components (`Button`, `Table`, `Modal`, `Input`) use TypeScript interfaces |
| `FE-23` | Prevent accidental duplicate form submission | Tier 5 (Manual UI) | Double-click submit button; verify button disables immediately and only one network request is dispatched |
| `FE-24` | Refresh email lists after scheduling or status transitions | Tier 5 (Manual UI) | Submit new email; verify Scheduled list updates automatically without requiring full page reload |
| `FE-25` | Provide responsive layout across desktop and tablet | Tier 5 (Manual UI) | Resize viewport to tablet/mobile widths; verify navigation collapses and tables remain readable with horizontal scroll |
| `FE-26` | Manually compare implemented UI against all supplied visual reference screens and states | Tier 5 (Manual UI) | Side-by-side manual review of implemented screens vs reference designs: login page, scheduled list, sent list, opened-email view, empty composer, and populated composer |

### 3.8 Elasticsearch and Search (`ES-01` to `ES-13`)

| ID | Requirement | Primary Testing Tier | Verification Method & Pass Evidence |
|---|---|---|---|
| `ES-01` | Create Elasticsearch index with explicit mapping | Tier 3 (Integration) | Run index init script; verify `emails` index created with mappings for keyword, text, and date fields |
| `ES-02` | Index emails upon creation in PostgreSQL | Tier 3 (Integration) | Schedule email; query Elasticsearch directly via `GET /emails/_doc/<id>`; verify document exists |
| `ES-03` | Update index when email status changes | Tier 3 (Integration) | Transition email to `sent` or `failed`; verify updated document fields in Elasticsearch |
| `ES-04` | Provide search endpoint with multi-field queries | Tier 2 (API) | Query `/api/search/emails?q=test`; verify matches against recipient, subject, and body fields |
| `ES-05` | Support pagination in search results | Tier 2 (API) | Query search endpoint with `page=1&limit=10`; verify bounded result list and total hits count |
| `ES-06` | Enforce user and tenant isolation in search queries | Tier 2 (API) | Verify all Elasticsearch search queries include a `term: { user_id }` filter clause |
| `ES-07` | Decouple email delivery from Elasticsearch availability | Tier 3 (Integration) | Simulate Elasticsearch downtime; verify scheduling and SMTP delivery proceed uninterrupted |
| `ES-08` | Recover missed index updates via reconciliation | Tier 3 (Integration) | Run `npm run search:reindex`; verify all missing or outdated PostgreSQL records are synced to Elasticsearch |
| `ES-09` | Make indexing idempotent | Tier 3 (Integration) | Index same email event multiple times; verify Elasticsearch document version increments without duplicate documents |
| `ES-10` | Search newly scheduled emails before delivery | Tier 2 (API) | Schedule email; immediately execute search query for recipient/subject; verify record returned with status `scheduled` before send time |
| `ES-11` | Reflect updated status and sent time in search index after delivery | Tier 3 (Integration) | Deliver email; query search endpoint; verify document reflects status `sent` and accurate `sent_at` timestamp |
| `ES-12` | Scope search results to authenticated user or tenant | Tier 2 (API) | Query search API as User A for a term matching User B's emails; verify zero results from other users are returned |
| `ES-13` | Document and test indexing failure resilience and recovery | Tier 3 (Integration) | Stop Elasticsearch during scheduling, verify email sends successfully, restart ES, run recovery script, verify index is updated |

### 3.9 Bull Board and Operational Visibility (`OPS-01` to `OPS-07`)

| ID | Requirement | Primary Testing Tier | Verification Method & Pass Evidence |
|---|---|---|---|
| `OPS-01` | Integrate live Bull Board queue dashboard | Tier 2 / Tier 5 (API / Manual) | Navigate to `/admin/queues`; verify Bull Board UI renders connected to active BullMQ queue |
| `OPS-02` | Display waiting, delayed, active, completed, and failed job counts | Tier 5 (Manual UI) | Enqueue jobs across states; verify Bull Board accurately reflects job counts in respective tabs |
| `OPS-03` | Protect Bull Board route with authentication | Tier 2 (API) | Access `/admin/queues` without authentication; verify HTTP 401/403 or redirect to login |
| `OPS-04` | Prevent sensitive secrets in BullMQ job payloads | Tier 3 (Integration) | Inspect job data in Bull Board; verify SMTP passwords, access tokens, and sensitive headers are omitted |
| `OPS-05` | Configure structured application and worker logging | Tier 3 (Integration) | Inspect console/logs during scheduling and execution; verify structured JSON logs with correlation IDs |
| `OPS-06` | Support graceful shutdown for API and worker | Tier 3 (Integration) | Send `SIGINT` to running worker; verify active job completes, queue pauses, and process exits cleanly |
| `OPS-07` | Expose detailed dependency health and readiness checks | Tier 2 (API) | Query `/ready`; verify JSON response reports status of PostgreSQL, Redis, and Elasticsearch |

### 3.10 Quality Assurance and Reliability Scenarios (`QA-01` to `QA-20`)

| ID | Requirement | Primary Testing Tier | Verification Method & Pass Evidence |
|---|---|---|---|
| `QA-01` | Test request validation | Tier 2 (API) | Run `npm test -- api/validation`; verify invalid payloads return 400 with expected error details |
| `QA-02` | Test database persistence across restarts | Tier 3 (Integration) | Run `npm test -- db/persistence`; verify records inserted in test container persist across simulated reconnect |
| `QA-03` | Test delayed scheduling accuracy | Tier 3 (Integration) | Run `npm test -- queue/delayed`; verify email is processed at intended future timestamp within acceptable drift |
| `QA-04` | Test scheduling idempotency | Tier 2 (API) | Run `npm test -- api/idempotency`; verify duplicate requests with same idempotency key return identical response |
| `QA-05` | Test concurrent worker claims | Tier 4 (Concurrency) | Run `npm test -- worker/concurrency`; verify competing workers never claim or process the same email record |
| `QA-06` | Test restart recovery of pending jobs | Tier 4 (Recovery) | Run `npm test -- worker/recovery`; verify uncompleted jobs resume and finish after simulated worker kill |
| `QA-07` | Test per-sender minimum delay under load | Tier 4 (Concurrency) | Run `npm test -- rate-limit/delay`; verify timestamps between consecutive sends for same sender meet or exceed minimum interval |
| `QA-08` | Test hourly quota enforcement under concurrent load | Tier 4 (Concurrency) | Run `npm test -- rate-limit/quota`; verify total sends within simulated hour never exceed configured hourly cap |
| `QA-09` | Test quota-based job rescheduling | Tier 4 (Concurrency) | Run `npm test -- worker/reschedule`; verify jobs exceeding quota are delayed to next window without failure |
| `QA-10` | Test real Slack rate-limit notification | Tier 5 (Manual E2E) | Run test triggering quota exhaustion; verify Slack incoming webhook / Web API posts notification |
| `QA-11` | Test real Google OAuth login and logout | Tier 5 (Manual E2E) | Execute login with valid Google account; verify user record created, session cookie set, and logout invalidates session |
| `QA-12` | Test CSV parsing, validation, and deduplication | Tier 1 (Unit) | Run `npm test -- parser/csv`; verify accurate extraction of emails, filtering of malformed inputs, and deduplication |
| `QA-13` | Test Elasticsearch indexing and recovery | Tier 3 (Integration) | Run `npm test -- search/indexing`; verify indexing on create, update on send, and sync recovery after outage |
| `QA-14` | Test cross-user authorization and data isolation | Tier 2 (API) | Run `npm test -- auth/isolation`; verify User A cannot view, schedule, or modify User B's emails |
| `QA-15` | Test 1,000+ email batch scheduling | Tier 4 (Stress) | Run `npm run test:load`; verify 1,000 emails are accepted, persisted in PostgreSQL, and enqueued in BullMQ without dropped records |
| `QA-16` | Verify monorepo build, lint, and test commands | Tier 1 (Static) | Run `npm run build && npm run lint && npm test`; verify all workspace packages pass without errors |
| `QA-17` | Audit documentation against actual code capabilities | Tier 1 (Static) | Verify `README.md` and docs make no unsubstantiated claims and accurately record verified behavior and trade-offs |
| `QA-18` | Verify SMTP post-acceptance crash scenario and recovery policy | Tier 4 (Recovery) | Simulate process crash after SMTP accepts message but before DB commit; verify recovery policy handles ambiguous outcome, mitigates duplicate risk, and documents at-least-once limitation |
| `QA-19` | Manual UI visual-fidelity verification against supplied ReachInbox reference | Tier 5 (Manual E2E) | Developer manually inspects and verifies visual match against ReachInbox designs across login, scheduled list, sent list, opened-email view, and composer states (no agent browser automation) |
| `QA-20` | End-to-end OAuth callback URL and environment verification | Tier 5 (Manual E2E) | Authenticate with real Google account and link real Slack workspace; verify live token exchanges, callback URL validity, and session persistence in dev and prod |

### 3.11 Deployment and Documentation (`DOC-01` to `DOC-16`)

| ID | Requirement | Primary Testing Tier | Verification Method & Pass Evidence |
|---|---|---|---|
| `DOC-01` | Document architecture and component responsibilities | Tier 1 (Static) | Inspect `README.md`; verify component diagram, responsibilities, and data flow are clearly articulated |
| `DOC-02` | Document backend API and worker setup instructions | Tier 1 (Static) | Follow backend setup instructions on clean environment; verify API and worker start without undocumented steps |
| `DOC-03` | Document frontend setup instructions | Tier 1 (Static) | Follow frontend setup instructions; verify web application starts and connects to backend |
| `DOC-04` | Document database and Redis setup and migrations | Tier 1 (Static) | Execute documented Docker and migration commands; verify database and Redis initialize correctly |
| `DOC-05` | Document Ethereal SMTP configuration | Tier 1 (Static) | Follow instructions to configure Ethereal credentials; verify test emails deliver and produce preview URLs |
| `DOC-06` | Document Google OAuth setup and redirect URIs | Tier 1 (Static) | Verify step-by-step instructions for Google Cloud Console, OAuth consent screen, and redirect URIs |
| `DOC-07` | Document Slack OAuth setup and notification testing | Tier 1 (Static) | Verify instructions for Slack app creation, OAuth scopes, bot tokens, and triggering rate limit alerts |
| `DOC-08` | Document Elasticsearch setup and index initialization | Tier 1 (Static) | Follow instructions to start Elasticsearch and initialize indices; verify search operates as documented |
| `DOC-09` | Explain restart recovery and reconciliation mechanisms | Tier 1 (Static) | Review documentation for clear description of startup reconciliation, outbox pattern, and BullMQ recovery |
| `DOC-10` | Explain concurrency, delay, quota, and rescheduling behavior | Tier 1 (Static) | Review documentation for detailed explanation of Redis atomic scripts, locking order, and window semantics |
| `DOC-11` | Explain idempotency guarantees and SMTP delivery limitations | Tier 1 (Static) | Verify documentation acknowledges the SMTP crash window and explains at-least-once delivery trade-offs |
| `DOC-12` | Document all implemented features mapped to checklist | Tier 1 (Static) | Inspect feature list; verify direct mapping from features to assignment checklist IDs |
| `DOC-13` | Document assumptions, trade-offs, and design decisions | Tier 1 (Static) | Review architecture notes for explicit justifications of technical choices and acknowledged trade-offs |
| `DOC-14` | Provide clean `.env.example` with all configuration keys | Tier 1 (Static) | Inspect `.env.example`; verify all required environment variables are listed with dummy values and documentation |
| `DOC-15` | Deploy application to accessible cloud hosting environment | Tier 5 (Manual E2E) | Access deployed frontend and backend URLs; verify hosted application is reachable and functional |
| `DOC-16` | Verify production environment configuration and integrations | Tier 5 (Manual E2E) | Execute test workflow on hosted instance; verify OAuth, DB, Redis, worker, and SMTP function in production |

### 3.12 Submission Requirements (`SUB-01` to `SUB-25`)

| ID | Requirement | Primary Testing Tier | Verification Method & Pass Evidence |
|---|---|---|---|
| `SUB-01` | Keep the GitHub repository private | Tier 5 (Manual) | Verify repository visibility is set to Private |
| `SUB-02` | Invite reviewer `Mitrajit` as collaborator | Tier 5 (Manual) | Send repository invitation to GitHub user `Mitrajit` with collaborator permissions; verify invitation is active |
| `SUB-03` | Invite reviewer `Yadav036` as collaborator | Tier 5 (Manual) | Send repository invitation to GitHub user `Yadav036` with collaborator permissions; verify invitation is active |
| `SUB-04` | Push the latest source code and README to main branch | Tier 5 (Manual) | Verify remote `origin/main` has all committed source code, documentation, and lockfile |
| `SUB-05` | Provide an active hosted assignment URL | Tier 5 (Manual) | Verify hosted application URL is live, accessible over HTTPS, and functional |
| `SUB-06` | Record demo video no longer than 5 minutes | Tier 5 (Manual) | Check demo video file/link; verify recording duration is <= 5:00 minutes |
| `SUB-07` | Demonstrate email scheduling workflow in demo video | Tier 5 (Manual) | Video demonstrates creating and scheduling single and batch emails |
| `SUB-08` | Demonstrate Scheduled and Sent/Failed views in demo video | Tier 5 (Manual) | Video displays scheduled emails queue and sent emails history with status details |
| `SUB-09` | Demonstrate restart recovery resilience in demo video | Tier 5 (Manual) | Video demonstrates scheduling a future email, restarting worker/API, and showing successful execution |
| `SUB-10` | Demonstrate rate limiting and Slack alert in demo video | Tier 5 (Manual) | Video shows minimum delay spacing, quota deferral, and resulting Slack rate-limit alert |
| `SUB-11` | Verify demo video public/reviewer permissions | Tier 5 (Manual) | Open demo link in incognito browser window; verify video plays without login/access request |
| `SUB-12` | Prepare and enter full legal name | Tier 5 (Manual) | Verify applicant's full legal name is prepared and entered in submission form |
| `SUB-13` | Prepare and enter contact details (phone number and email) | Tier 5 (Manual) | Verify applicant's phone number and primary email are prepared and entered in submission form |
| `SUB-14` | Prepare and enter academic details (college, batch, CGPA, and attendance) | Tier 5 (Manual) | Verify college name, graduation batch year, CGPA, and attendance percentage are prepared and entered |
| `SUB-15` | Prepare and enter professional links (LinkedIn profile and relevant links) | Tier 5 (Manual) | Verify LinkedIn profile URL and any portfolio/GitHub profile links are verified and entered |
| `SUB-16` | Prepare and enter existing hosted project link | Tier 5 (Manual) | Verify prior hosted project link is live, tested, and entered in submission form |
| `SUB-17` | Prepare and enter internship duration and joining availability | Tier 5 (Manual) | Verify preferred internship duration and immediate/exact joining availability date are entered |
| `SUB-18` | Prepare and attach/link resume and cover letter | Tier 5 (Manual) | Verify updated resume and customized cover letter files/links are prepared and attached |
| `SUB-19` | Enter accessible demo video URL | Tier 5 (Manual) | Verify demo video URL (<= 5 min) is verified and pasted into submission form |
| `SUB-20` | Enter assignment GitHub repository URL | Tier 5 (Manual) | Verify private GitHub repository URL is entered into submission form |
| `SUB-21` | Enter live hosted assignment URL | Tier 5 (Manual) | Verify accessible deployed assignment URL is entered into submission form |
| `SUB-22` | Confirm reviewers (`Mitrajit` and `Yadav036`) have repository access | Tier 5 (Manual) | Verify form confirmation confirming collaborator invitations to `Mitrajit` and `Yadav036` |
| `SUB-23` | Confirm source code and README are pushed | Tier 5 (Manual) | Verify form confirmation that code and comprehensive README are committed and pushed |
| `SUB-24` | Truthfully affirm originality confirmation | Tier 5 (Manual) | Affirm originality declaration confirming the implementation was developed independently |
| `SUB-25` | Complete and submit assignment ClickUp form | Tier 5 (Manual) | Submit completed form; verify confirmation screen/receipt that response has been recorded |

---

## 4. Critical Failure and Edge-Case Scenarios

The test suite must explicitly cover the following high-risk scenarios:

### Scenario 1: Partial Database-to-Queue Failure (`BE-10`)
- **Condition:** API persists records in PostgreSQL inside a transaction, but the subsequent BullMQ enqueue operation fails (e.g., Redis temporary timeout or connection drop).
- **Test:** Scheduling outbox records the pending intent within the same database transaction. Run startup reconciliation script.
- **Expected Outcome:** Missing BullMQ jobs are detected and created using deterministic `jobId = email.id` without creating duplicate PostgreSQL records (`BE-10`).
- **Pass Evidence:** PostgreSQL row count equals Redis queue job count; zero duplicate email rows created.

### Scenario 2: Concurrent Worker Claim Race (`BE-12`, `QA-05`)
- **Condition:** Multiple worker instances poll for eligible `scheduled` jobs simultaneously.
- **Test:** Launch 3 concurrent workers attempting to claim the same batch of 20 emails.
- **Expected Outcome:** Database row locking (`SELECT ... FOR UPDATE SKIP LOCKED` or atomic conditional update `UPDATE emails SET status = 'processing', locked_at = NOW() WHERE id = $1 AND status = 'scheduled'`) ensures exactly one worker claims each record; zero jobs are double-processed (`BE-12`, `QA-05`).
- **Pass Evidence:** Exactly 20 distinct claims across workers; zero duplicate deliveries.

### Scenario 3: Ambiguous SMTP Crash Window (`SMTP-08`, `QA-18`)
- **Condition:** Ethereal SMTP accepts the email (SMTP 250 response), but the worker crashes (SIGKILL) immediately before writing `status = 'sent'` to PostgreSQL.
- **Test:** Simulate worker SIGKILL immediately following Nodemailer transport completion. Trigger worker startup recovery.
- **Expected Outcome:** An execution attempt record exists with the generated Message-ID. Recovery logic reconciles the record conservatively rather than blindly resending; system documentation explicitly acknowledges the at-least-once SMTP limitation without claiming impossible exactly-once delivery (`SMTP-08`, `QA-18`). Quota reservations are not unsafely refunded.
- **Pass Evidence:** Recovery audit log records conservative reconciliation; no duplicate message sent to SMTP recipient.

### Scenario 4: Hourly Quota Exhaustion and Multi-Worker Deferral (`RATE-04`, `RATE-05`, `RATE-09`, `RATE-11`, `RATE-12`, `QA-08`, `QA-09`)
- **Condition:** Sender quota is set to 5 emails/hour. A batch of 15 emails is scheduled.
- **Test:** Execute queue processing across 3 concurrent workers.
- **Expected Outcome:**
  - Exactly 5 emails are delivered in the current hour window.
  - The remaining 10 emails are deferred to the start of the next UTC hour window.
  - Database status of deferred emails remains `scheduled` (never `failed`).
  - Original `email.id` and BullMQ `jobId` are preserved.
  - Retries or transient failures do not cause the sender to exceed 5 sends in that hour (`RATE-04`, `RATE-05`, `RATE-09`, `RATE-11`, `RATE-12`, `QA-08`, `QA-09`).
- **Pass Evidence:** Delivery logs confirm exactly 5 sends in Hour 1; 10 deferred to Hour 2; zero failed status rows.

### Scenario 5: Minimum Send Interval Enforcement (`RATE-02`, `RATE-03`, `RATE-16`, `QA-07`)
- **Condition:** Sender `min_send_interval_ms` is configured to 2,000ms. 5 emails are scheduled for immediate execution.
- **Test:** Execute with 2 concurrent workers. Record timestamps of accepted SMTP messages.
- **Expected Outcome:** The difference between consecutive send timestamps for the same sender is `>= 2,000ms`. Workers do not block with in-memory `sleep()`; instead, jobs are rescheduled via Redis delay (`RATE-02`, `RATE-03`, `RATE-16`, `QA-07`).
- **Pass Evidence:** Deltas between consecutive SMTP send timestamps for the same sender are all `>= 2,000ms`.

### Scenario 6: Slack Rate-Limit Alert Deduplication (`SLACK-07`, `SLACK-08`, `QA-10`)
- **Condition:** Multiple jobs hit the hourly quota for the same sender within minutes.
- **Test:** Trigger quota exhaustion for 5 deferred jobs under the same sender.
- **Expected Outcome:** Exactly 1 Slack notification is dispatched for that sender during that hour window via the Redis atomic deduplication lock (`slack:alert:<sender_id>:<window_hour>`) (`SLACK-07`, `SLACK-08`).
- **Pass Evidence:** Mock or live Slack webhook receives exactly 1 alert; subsequent quota hits in the same hour log alert suppression.

### Scenario 7: Elasticsearch Downtime Decoupling (`ES-07`, `ES-08`, `QA-13`)
- **Condition:** Elasticsearch container is stopped or unavailable.
- **Test:** Submit email scheduling request and process delivery through worker.
- **Expected Outcome:** Email schedules in PostgreSQL, enqueues in BullMQ, and delivers via Ethereal SMTP without throwing unhandled exceptions. Missed index updates are logged in the outbox. Restart Elasticsearch and run `npm run search:reindex`; verify search index syncs (`ES-07`, `ES-08`, `QA-13`).
- **Pass Evidence:** API and worker operations succeed despite ES offline; reconciliation script updates index upon restoration.

### Scenario 8: Cross-Tenant Authorization Isolation (`AUTH-08`, `AUTH-14`, `ES-12`, `QA-14`)
- **Condition:** User A attempts to view, schedule, or search emails belonging to User B.
- **Test:** Submit requests to `GET /api/emails/:id`, `GET /api/emails/scheduled`, and `GET /api/search/emails` using User A's session cookie with User B's identifiers.
- **Expected Outcome:** Endpoint returns HTTP 403 Forbidden or HTTP 404 Not Found; search queries include mandatory `term: { user_id }` filter clause returning zero matching documents belonging to User B (`AUTH-08`, `AUTH-14`, `ES-12`, `QA-14`).
- **Pass Evidence:** Supertest asserts HTTP 403/404; search response hits count is 0 for foreign tenant records.

### Scenario 9: Bull Board Access Protection (`OPS-03`)
- **Condition:** Unauthenticated or unauthorized user requests access to `/admin/queues`.
- **Test:** Send GET request to `/admin/queues` without session cookie, and with regular non-admin session cookie.
- **Expected Outcome:** Request rejected with HTTP 401 Unauthorized or HTTP 403 Forbidden; Bull Board UI dashboard is never exposed to unauthenticated callers (`OPS-03`).
- **Pass Evidence:** Supertest asserts HTTP 401/403 status code; HTML dashboard content is blocked.

### Scenario 10: 1,000+ Email Batch Scheduling and Worker Concurrency Stress (`RATE-13`, `RATE-14`, `QA-15`)
- **Condition:** High-volume scheduling request containing 1,000+ recipients submitted in a single operation.
- **Test:** Submit 1,000 emails via CSV upload or bulk API payload. Process with configured worker concurrency (`WORKER_CONCURRENCY=5`).
- **Expected Outcome:** API batches and persists all 1,000 records in PostgreSQL and enqueues BullMQ delayed jobs without connection pool exhaustion, memory leak, or dropped records. Worker processes batch adhering to concurrency limits (active network connections bounded by `WORKER_CONCURRENCY`), respecting interval delays and quota boundaries (`RATE-13`, `RATE-14`, `QA-15`).
- **Pass Evidence:** PostgreSQL row count = 1,000; BullMQ processed/delayed count = 1,000; zero dropped jobs; memory remains stable.

---

## 5. Test Infrastructure, Tools, and Isolation Safeguards

### 5.1 Proposed Test Framework
- **Test Runner:** **Vitest** (recommended for native TypeScript, ESM support, workspace filtering, and fast execution) or Jest.
- **API Assertions:** **Supertest** for Express HTTP endpoint testing.
- **Database / Infrastructure Harness:**
  - Local tests run against Docker Compose services (`infra/docker-compose.yml`) using dedicated test databases and isolated namespaces.
  - Fast unit tests run with zero external services using mocked repositories.
  - Nodemailer uses Ethereal test account fixtures for isolated SMTP simulation.

### 5.2 Test Environment Isolation Safeguards

> [!CAUTION]
> **Destructive Cleanup Safety Preconditions:**
> Automated test suites must NEVER execute `FLUSHALL`, `FLUSHDB`, or destructive database truncation against shared instances that might contain development or production data.

1. **Redis Isolation and Cleanup Safeguards:**
   - **Targeted Teardown Preferred:** Normal test teardown must use **targeted key deletion** of test-owned keys and namespaced data (e.g., deleting keys matching `{test}:*` or `reachinbox_test:*`) rather than database-wide cleanup. Never use `FLUSHALL`.
   - **No Routine FLUSHDB:** Do not use `FLUSHDB` as the normal test-cleanup mechanism.
   - **Queue Prefix Limitation:** A queue prefix alone (e.g., `{test}:emails`) namespaces keys within a database but does **not** protect against database-wide commands; running `FLUSHDB` wipes the entire database index regardless of prefix.
   - **Configuration Precedence & Effective Target Verification:** Because `REDIS_URL` takes precedence over individual parameters (`REDIS_HOST`, `REDIS_PORT`, `REDIS_DB`), the test harness must **never infer the effective Redis database solely from `REDIS_DB`**. If destructive database-wide cleanup is genuinely necessary for an isolated suite reset, the test harness must first resolve the **effective connected Redis target** (parsing `REDIS_URL` or evaluating client connection options to verify the actual resolved host, port, and database index, e.g., verifying database index 15 on an isolated test instance) and confirm that the instance and database are dedicated and disposable for testing:
     ```typescript
     // Planned precondition assertion: verify effective connected Redis target
     // Resolve effective database index accounting for REDIS_URL precedence
     const effectiveDb = resolveEffectiveRedisDb({
       redisUrl: process.env.REDIS_URL,
       redisDb: process.env.REDIS_DB,
     });
     const effectiveHost = resolveEffectiveRedisHost(process.env.REDIS_URL, process.env.REDIS_HOST);

     if (
       process.env.NODE_ENV !== 'test' ||
       effectiveDb !== 15 ||
       !isTestHost(effectiveHost)
     ) {
       throw new Error(
         `Refusing destructive Redis cleanup: Effective target (${effectiveHost}, db=${effectiveDb}) is not verified as a dedicated disposable test database.`
       );
     }
     ```
   - *Current Repository Status (Planned vs. Implemented):* These runtime verification functions and dedicated Redis test infrastructure (`REDIS_DB=15` or a disposable test container) are **planned for implementation in Phase 2**. They are not yet implemented or active in the repository; no runtime validation has been executed yet.

2. **PostgreSQL Isolation and Cleanup Safeguards:**
   - **Effective Target Verification:** Automated tests must verify their **effective database target** before any destructive setup or teardown (such as schema migrations, test table truncation, or reset). Tests must connect to a dedicated test database (e.g., `reachinbox_test`), never the development database (`reachinbox_scheduler`) or a production database.
   - **No Truncation of Dev/Prod Data:** Automated tests must never truncate, reset, or drop development or production data.
   - **Mandatory Target Assertion:** Test harnesses must parse the effective database connection string (accounting for `DATABASE_URL` taking precedence over `DB_NAME`) and assert that `process.env.NODE_ENV === 'test'` and the effective target database name explicitly ends with `_test`:
     ```typescript
     // Planned precondition assertion: verify effective connected PostgreSQL target
     const effectiveDbName = resolveEffectivePostgresDb({
       databaseUrl: process.env.DATABASE_URL,
       dbName: process.env.DB_NAME,
     });

     if (process.env.NODE_ENV !== 'test' || !effectiveDbName.endsWith('_test')) {
       throw new Error(
         `Refusing destructive database reset: Effective target database (${effectiveDbName}) is not an isolated test database (*_test).`
       );
     }
     ```
   - **Transactional Rollbacks:** Individual integration tests should wrap operations in transactions and execute rollbacks (`BEGIN ... ROLLBACK`) wherever practical to avoid table truncation overhead and eliminate inter-test state leakage.
   - *Current Repository Status (Planned vs. Implemented):* Dedicated test database provisioning (`reachinbox_test`), test migration harnesses, and runtime target verification checks are **planned for Phase 2**. They are not yet implemented or active.

3. **Elasticsearch Isolation Safeguards:**
   - Indexing integration tests must target a dedicated test index (e.g., `emails_test`), asserting `process.env.NODE_ENV === 'test'` before creating or deleting test indices.
   - Automated tests must never delete or reindex the development index (`emails`).

### 5.3 Test Execution Commands (Proposed)

> [!NOTE]
> The commands below represent target npm scripts to be defined in `package.json` during Phase 1. They are labeled as **[Proposed]** until configured. Currently, the repository contains no application code or test scripts.

```bash
# Static checks (Linting & Types)
npm run lint                     # [Proposed] Run ESLint across all workspaces
npm run typecheck                # [Proposed] Run tsc across all workspaces

# Unit tests (In-memory, fast)
npm run test:unit                # [Proposed] Run all unit tests (Zod, CSV parser, utilities)

# API integration tests
npm run test:api                 # [Proposed] Run API endpoint and middleware integration tests

# Worker & queue integration tests
npm run test:queue               # [Proposed] Run BullMQ worker, claiming, and delivery tests

# Rate-limit and concurrency tests
npm run test:ratelimit           # [Proposed] Run distributed delay and hourly quota tests

# Crash and recovery tests
npm run test:recovery            # [Proposed] Run restart and post-SMTP crash simulation tests

# 1,000-email batch load test
npm run test:load                # [Proposed] Run batch scheduling load test script

# Full automated test suite
npm test                         # [Proposed] Run all automated unit, integration, and recovery tests
```

---

## 6. Definition of Verification Evidence

To mark any requirement in [`docs/requirements-checklist.md`](file:///d:/Work/Projects----Commercial/Outbox%20Labs/Assignment/docs/requirements-checklist.md) as `Verified`, the developer or agent must provide specific, verifiable evidence matching the requirement's tier:

| Requirement Type | Required Verification Evidence for `Verified` Status |
|---|---|
| **Static / Config** | Clean CLI command output with exit code 0 (e.g., `npm run lint`, `git check-ignore`, file inspection). |
| **API / Endpoint** | Supertest or curl response showing expected HTTP status, structured JSON payload, and database verification. |
| **Worker / Queue** | Test output asserting BullMQ job lifecycle state transitions and database status updates. |
| **Rate Limiter** | Timestamp delta log proving interval spacing `>= min_send_interval_ms`, and quota counter asserting cap is never exceeded. |
| **Failure Recovery** | Test log demonstrating process crash simulation, subsequent restart, and conservative state reconciliation without duplicate send. |
| **Manual UI Fidelity** | Documented manual check by the developer comparing implemented views side-by-side with ReachInbox reference screens (no automated browser agent). |
| **Real OAuth Integration** | Documented manual verification of real browser consent flow, successful session cookie issuance, and authenticated profile retrieval in development and production environments. |
| **Submission Items** | Verification of collaborator permissions on GitHub, accessible hosted link, valid <= 5 min video URL, and ClickUp confirmation receipt. |

### Failure Reporting Rule:
If a test fails or a scenario cannot be tested due to missing credentials or unmerged code, the requirement status must remain **`In progress`** or be marked **`Blocked`** with a clear explanation of the blocker. It must **never** be marked `Verified`.
