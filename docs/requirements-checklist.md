# ReachInbox Email Scheduler — Requirements Checklist

> **Purpose:** Trace every requirement in the ReachInbox Software Development Intern assignment to its implementation area, verification evidence, and completion status.
>
> **Rule:** A requirement is marked `Verified` only when implemented code exists and tangible, successful verification evidence has passed. Never mark a requirement `Verified` based on a plan, generated code, an unexecuted test, or an unsupported assertion.
>
> **Project:** ReachInbox Full-stack Email Job Scheduler  
> **Deadline:** 48 hours from assignment start  
> **Initial Status:** Not started

## Status Legend

- **`Not started`**: Implementation and verification have not begun.
- **`In progress`**: Work is actively underway.
- **`Blocked`**: A concrete dependency or issue prevents progress; the blocker and its impact must be recorded rather than marking the item complete.
- **`Verified`**: Implemented code exists and tangible, successful verification evidence (executed test, command output, or documented observation) has passed.

Do not mark a requirement `Verified` based on a plan, generated code, an unexecuted test, or an agent's unsupported assertion. Keep existing statuses unchanged unless the repository provides actual evidence that justifies a change.

---

## 1. Project Foundation and Infrastructure

| ID | Requirement | Implementation Area | Verification Evidence | Status |
|---|---|---|---|---|
| INF-01 | Create a private GitHub repository | Repository settings | Repository visibility confirmed as Private in GitHub repository settings | Verified|
| INF-02 | Set up a TypeScript monorepo | Root workspace (`package.json`, workspace config) | Run monorepo build command (`npm run build`); API, worker, and web compile cleanly | Verified |
| INF-03 | Configure Express.js backend | `apps/api` | Run `npm run dev --filter api`; API starts and `curl http://localhost:3001/health` returns 200 OK | Verified |
| INF-04 | Configure React frontend with TypeScript and Tailwind CSS | `apps/web` | Run `npm run build --filter web`; frontend compiles without errors and UI renders in browser | Verified |
| INF-05 | Configure PostgreSQL with migrations | Database schema and migration tooling | Run migration script (`npm run db:migrate`); tables are created and confirmed via database query | Verified |
| INF-06 | Configure Redis | Infrastructure configuration | Run `redis-cli ping`; responds with `PONG`; BullMQ establishes connection without error | Verified |
| INF-07 | Configure Elasticsearch | Search infrastructure | Run `curl http://localhost:9200/_cluster/health`; cluster responds green/yellow and index is created | Verified |
| INF-08 | Configure Docker Compose for local development | `infra/docker-compose.yml` | Run `docker compose -f infra/docker-compose.yml up -d`; PostgreSQL, Redis, and Elasticsearch containers start and pass healthchecks | Verified |
| INF-09 | Persist PostgreSQL and Redis data across restarts | Docker volume definitions and Redis persistence config | Restart containers (`docker compose down && docker compose up -d`); verify stored tables and Redis keys persist | Verified |
| INF-10 | Provide environment variable templates | `.env.example` in root and applications | Inspect `.env.example`; verify all required configuration keys are documented with safe placeholder values | Verified |
| INF-11 | Separate API and worker into independent processes | `apps/api` and `apps/worker` | Launch API and worker in separate processes; verify each process starts, operates, and terminates independently | Verified |
| INF-12 | Configure health and readiness checks | API endpoints (`/health`, `/ready`) | Query `GET /health` (liveness) and `GET /ready` (readiness with DB/Redis/ES checks); verify accurate 200/503 responses | Verified |
| INF-13 | Configure TypeScript, linting, formatting, and test runners | Workspace configuration (`tsconfig.json`, ESLint, Prettier, test runner) | Run `npm run lint`, `npm run typecheck`, and `npm test`; all commands complete with zero errors | Verified |
| INF-14 | Prevent secrets from entering source control | `.gitignore` and git history | Run `git status --ignored` and check commit history; verify `.env`, secret files, and credentials are excluded | Verified |

---

## 2. Email Scheduling API and Persistence

| ID | Requirement | Implementation Area | Verification Evidence | Status |
|---|---|---|---|---|
| BE-01 | Accept email scheduling requests | `POST /api/emails/schedule` | Executed `POST /api/emails/schedule` via `test/api/scheduling.test.ts`; verified 201 Created with scheduled record data | Verified |
| BE-02 | Persist email records in a relational database | Email repository and PostgreSQL schema | Confirmed in `test/api/scheduling.test.ts`; records persist in PostgreSQL `emails` table with correct fields and status 'scheduled' | Verified |
| BE-03 | Support single and bulk recipients in a scheduling request | Scheduling service | Verified in `test/api/scheduling.test.ts`; single recipient and 3-recipient bulk batch persist individual records per recipient | Verified |
| BE-04 | Validate recipient email addresses, subject, body, and schedule time | API validation middleware (Zod / Joi) | Executed `test/api/validation.test.ts`; confirmed 400 Bad Request returned with field errors for invalid email, missing subject, past dates | Verified |
| BE-05 | Use BullMQ delayed jobs backed by Redis for scheduling | Queue and scheduling service | Verified in `test/api/scheduling.test.ts`; BullMQ delayed jobs inspected in Redis with delay matching scheduled_at - now | Verified |
| BE-06 | Avoid cron jobs and process-local scheduling timers | Scheduling architecture | Codebase audit confirms zero dependencies on `node-cron`, `cron`, OS crontab, or in-memory `setTimeout` triggers | Verified |
| BE-07 | Support deterministic queue job IDs | Queue producer logic | Confirmed in `test/api/scheduling.test.ts`; BullMQ `job.id` matches persisted `email.id` deterministically | Verified |
| BE-08 | Make scheduling requests idempotent | API idempotency middleware and database constraint | Executed `test/api/idempotency.test.ts`; repeated requests return cached response with `Idempotency-Replayed: true` and 0 duplicate rows | Verified |
| BE-09 | Recover scheduled jobs after application restarts | Startup reconciliation service and BullMQ | Executed `test/worker/recovery.test.ts`; verified stranded outbox events and stale processing records recovered on startup | Verified |
| BE-10 | Recover from database-to-queue partial failures | Scheduling outbox and reconciliation job | Executed `test/recovery/outbox-reconciliation.test.ts`; unprocessed outbox events detected and successfully re-enqueued to BullMQ | Verified |
| BE-11 | Support email status tracking state machine | Email model and state transitions | Confirmed in `test/worker/delivery.test.ts`; status transitions `scheduled` -> `processing` -> `sent` (or `failed`) recorded with timestamps | Verified |
| BE-12 | Prevent concurrent workers from claiming the same email | Atomic DB claim query (`SELECT ... FOR UPDATE SKIP LOCKED` or atomic update) | Verified in `test/worker/concurrency.test.ts`; atomic update query ensures only 1 of 3 concurrent workers claims the email | Verified |
| BE-13 | Handle worker crashes and stalled jobs | Worker recovery and BullMQ stalled job configuration | Executed `test/worker/recovery.test.ts`; crashed worker email in 'processing' state safely recovered and re-enqueued | Verified |
| BE-14 | Support API pagination and filtering for email lists | `GET /api/emails/scheduled` and `GET /api/emails/sent` | Executed `test/api/scheduling.test.ts`; verified pagination limits, offsets, total counts, and sender filters across list endpoints | Verified |
| BE-15 | Support multiple sender configurations | Sender entity and service | Verified in `test/api/scheduling.test.ts`; emails associate with sender_id and query endpoints filter accurately by sender | Verified |
| BE-16 | Handle past or invalid scheduling times | Scheduling validation service | Executed `test/api/validation.test.ts`; requests with past timestamps rejected with 400 Bad Request and `PAST_SCHEDULE_TIME` code | Verified |
| BE-17 | Provide consistent API error envelope | Error-handling middleware | Confirmed in `test/api/validation.test.ts`; error responses conform to `{ error: { code, message, details } }` format | Verified |

---

## 3. SMTP Delivery and Idempotency

| ID | Requirement | Implementation Area | Verification Evidence | Status |
|---|---|---|---|---|
| SMTP-01 | Send emails through Ethereal SMTP | Worker mail service (Nodemailer) | Executed `test/worker/delivery.test.ts`; verified Nodemailer sends email to Ethereal and receives SMTP acceptance | Verified |
| SMTP-02 | Support multiple sender SMTP configurations | Sender management and mail service | Confirmed in `test/worker/delivery.test.ts`; emails sent using distinct configured sender accounts with respective from addresses | Verified |
| SMTP-03 | Store delivery outcomes and timestamps | Email repository | Verified in `test/worker/delivery.test.ts`; `sent_at`, `status = 'sent'`, and `provider_message_id` persisted in PostgreSQL | Verified |
| SMTP-04 | Store Ethereal preview URLs where available | Delivery service | Confirmed in `test/worker/delivery.test.ts`; `preview_url` captured from `nodemailer.getTestMessageUrl` and saved in DB | Verified |
| SMTP-05 | Generate a stable Message-ID per logical email | Mail service | Verified in `test/worker/delivery.test.ts`; `message_id` is stably derived as `<email-id@reachinbox.test>` across attempts | Verified |
| SMTP-06 | Classify retryable and permanent failures | Worker error handler | Executed `test/worker/delivery.test.ts`; 4xx transient errors trigger retry reset to 'scheduled', 5xx errors transition to 'failed' | Verified |
| SMTP-07 | Avoid duplicate logical email creation | Database constraints and API logic | Verified across API, parser, and concurrency suites; unique constraints and atomic claim prevent duplicate records | Verified |
| SMTP-08 | Handle ambiguous SMTP outcomes conservatively | Worker recovery and attempt tracking | Executed `test/worker/post-acceptance-crash.test.ts`; verified in-progress attempt during crash transitions to 'unknown' outcome and non-retryable 'failed' status (`AMBIGUOUS_CRASH_OUTCOME`, manual review required); pre-attempt crash safely reverts to 'scheduled'; accepted attempt reconciles to 'sent' | Verified |
| SMTP-09 | Document the exactly-once delivery limitation | `README.md` and architecture docs | Documented in `docs/architecture.md` and codebase; explicitly discloses BullMQ at-least-once processing and SMTP network limitations | Verified |

**Reliability note:** BullMQ provides at-least-once job processing, not guaranteed exactly-once external delivery. A stable Message-ID does not guarantee SMTP-provider deduplication. The implementation must explicitly document and mitigate this limitation.

---

## 4. Worker Concurrency, Delay, and Hourly Rate Limits

| ID | Requirement | Implementation Area | Verification Evidence | Status |
|---|---|---|---|---|
| RATE-01 | Configure worker concurrency through environment variables | Worker configuration (`WORKER_CONCURRENCY`) and BullMQ worker options | Verify the worker reads `WORKER_CONCURRENCY` from the environment; verify that the number of simultaneously processed jobs respects that value and remains bounded under load; change the configured value (e.g., from 1 to 5) and restart or reconfigure the worker as appropriate, verifying that active job-processing concurrency scales to the new bound (distinguishing job-processing concurrency from thread count) | Not started |
| RATE-02 | Enforce a minimum delay between individual sends | Per-sender rate limiter (Redis token/timestamp) | Measure timestamps of consecutive emails for same sender; verify interval is >= configured `min_send_interval_ms` | Not started |
| RATE-03 | Enforce delay across concurrent workers | Redis-backed distributed lock / reservation script | Run 3 concurrent workers processing queue for same sender; verify delay between sends is strictly maintained across workers | Not started |
| RATE-04 | Implement configurable hourly email quotas | Rate-limit service (Redis sliding window or fixed window counter) | Set hourly limit of 5; verify 6th email is prevented from sending within that hour | Not started |
| RATE-05 | Enforce quotas across multiple workers or instances | Atomic Redis Lua script for quota reservation | Run multiple worker processes attempting parallel sends; verify aggregate count in window never exceeds limit | Not started |
| RATE-06 | Scope limits per sender or tenant | Rate-limit Redis keys | Send emails from Sender A and Sender B; verify Sender A hitting limit does not throttle or delay Sender B | Not started |
| RATE-07 | Configure limit values without hardcoding | Environment config and validated request parameters | Update environment or request configuration; verify system immediately applies updated limits | Not started |
| RATE-08 | Define how UI limits relate to server limits | API validation and documentation | Submit UI values exceeding server caps; verify server-side validation enforces server caps and rejects or bounds input | Not started |
| RATE-09 | Reschedule jobs when the hourly quota is exhausted | BullMQ worker deferral logic | When quota is exhausted, move job delay to start of next UTC hour; verify job transitions to delayed state in BullMQ | Not started |
| RATE-10 | Preserve job order as far as practical during deferral | Deferral offset calculation | Inspect scheduled times of deferred batch; verify relative ordering of emails is preserved in future window | Not started |
| RATE-11 | Avoid treating quota exhaustion as delivery failure | Worker state transitions | Inspect database status of deferred emails; verify status remains `scheduled` rather than transitioning to `failed` | Not started |
| RATE-12 | Handle quota reservations and failure/recovery policy across workers | Atomic rate-limit logic (Redis Lua), worker error handling, and recovery reconciliation | Document and test the chosen hourly quota reservation and accounting policy across scenarios: (1) permanent SMTP rejection, (2) transient failure awaiting retry, (3) worker crash before initiating SMTP delivery, and (4) crash after SMTP acceptance but before recording success in database. Verify quota accounting remains safe across multiple workers; retries or refunds never cause the hourly limit to be exceeded; reservations are never blindly refunded when delivery outcome is ambiguous; reservation expiration, recovery, or reconciliation behavior is explicitly defined; distinctions between quota exhaustion, delivery failure, and ambiguous outcomes are preserved; and at-least-once delivery limitations are documented without claiming exactly-once SMTP delivery | Not started |
| RATE-13 | Handle 1,000 or more emails scheduled at similar times | Bulk insertion and queue producer | Execute load test script scheduling 1,000 emails; verify all 1,000 records persist and 1,000 BullMQ jobs are enqueued | Not started |
| RATE-14 | Avoid unbounded simultaneous delivery | Worker pool and rate limiter | Under 1,000-email load, monitor active network connections; verify concurrency never exceeds configured bounds | Not started |
| RATE-15 | Document throttling and quota trade-offs | `README.md` | Inspect documentation for explanation of window boundaries, Redis atomic script semantics, and ordering trade-offs | Not started |
| RATE-16 | Execution times for a batch must respect requested start time and configured minimum delay between sends | Rate limiting & batch scheduling service | Schedule a batch of emails with start time T and delay D; verify recorded send times are >= T and spaced by >= D | Not started |
| RATE-17 | Defer remaining emails when hourly quota is exhausted rather than dropping or permanently failing them | Worker processor & rate limiter | Set hourly quota N; schedule batch of N+M emails; verify N emails send in current hour and M emails are deferred to next window without dropping | Not started |
| RATE-18 | Deferral must preserve job identity and avoid duplicate email creation or scheduling | BullMQ job rescheduler | Inspect deferred jobs; verify original `email_id` and BullMQ `jobId` are preserved without inserting duplicate database rows | Not started |
| RATE-19 | Test the interaction between requested start time, per-sender delay, hourly quota, and multiple workers | Concurrency & rate-limit integration test suite | Run automated multi-worker test with start time, delay, and hourly quota; verify all constraints hold concurrently across worker instances | Not started |
| RATE-20 | Define and test behavior when calculated send time crosses into another hourly quota window or overlaps with another batch | Rate-limit test suite & documentation | Schedule overlapping batches crossing hourly boundary; verify quota rolls over correctly and send order is preserved deterministically | Not started |
| RATE-21 | Enforce that an email is never sent before all applicable scheduling, delay, and rate-limit constraints permit it | Worker execution guard / rate-limit check | Assert that for every sent email: `actual_send_time >= scheduled_at`, interval from previous sender send >= `min_send_interval`, and hourly quota not exceeded | Not started |

---

## 5. Slack OAuth and Notifications

| ID | Requirement | Implementation Area | Verification Evidence | Status |
|---|---|---|---|---|
| SLACK-01 | Implement real Slack OAuth | Slack integration module | Initiate OAuth exchange; verify authorization code is exchanged for access token via Slack API | Not started |
| SLACK-02 | Provide a Connect Slack action in frontend | `apps/web` Slack settings feature | Click 'Connect Slack' in UI; verify redirect to Slack authorization page with correct client_id and scopes | Not started |
| SLACK-03 | Validate OAuth state parameter | Slack OAuth callback handler | Send callback request with missing or mismatched `state` param; verify HTTP 400 Bad Request and abort | Not started |
| SLACK-04 | Store Slack credentials per user or tenant | Slack connection repository | Query `slack_connections` table; verify access token and metadata are associated with authenticated `user_id` | Not started |
| SLACK-05 | Secure stored credentials | Encryption at rest and API response filtering | Verify token is stored encrypted in database; inspect API `/api/slack/connection` response to ensure token is excluded | Not started |
| SLACK-06 | Support disconnect and reconnect | Slack connection module | Click 'Disconnect' in UI; verify record is removed/revoked; reconnecting successfully establishes a new connection | Not started |
| SLACK-07 | Send an actual message when a sender hits its hourly limit | Notification service | Trigger rate-limit quota exhaustion; verify real message appears in configured Slack channel | Not started |
| SLACK-08 | Avoid duplicate alerts per sender and quota window | Redis deduplication key / atomic notification outbox | Trigger multiple blocked jobs in same hour; verify only one notification is sent to Slack for that sender window | Not started |
| SLACK-09 | Handle missing Slack connections gracefully | Notification service | Exhaust quota when Slack is not connected; verify job deferral succeeds without throwing unhandled exceptions | Not started |
| SLACK-10 | Support connecting Slack after deployment without restart | Dynamic connection resolution | Connect Slack on a running instance; verify subsequent rate limit alerts are sent immediately without restart | Not started |
| SLACK-11 | Handle Slack API failures without failing email jobs | Notification error handling | Mock Slack API 500 error; verify rate-limit notification failure is logged but email job remains safely deferred | Not started |
| SLACK-12 | Verify real Slack OAuth end-to-end with configured credentials and callback URL | End-to-end manual verification | Execute full OAuth flow against a live Slack workspace with real app credentials; verify valid callback URL handling, token exchange, and message delivery | Not started |

---

## 6. Google Authentication and Authorization

| ID | Requirement | Implementation Area | Verification Evidence | Status |
|---|---|---|---|---|
| AUTH-01 | Implement real Google OAuth login | Authentication module | Real Google OAuth login initiates and succeeds with Google Identity | Not started |
| AUTH-02 | Create or retrieve the local user record | User service | Authenticated Google profile creates or retrieves local user row in PostgreSQL | Not started |
| AUTH-03 | Display user name | Dashboard header | Authenticated user display name is visible in dashboard header | Not started |
| AUTH-04 | Display user email | Dashboard header | Authenticated user email is visible in dashboard header | Not started |
| AUTH-05 | Display user avatar | Dashboard header | Authenticated user avatar image renders when profile image URL is present | Not started |
| AUTH-06 | Implement logout | Authentication module | Click logout; verify session cookie/token is invalidated and user is redirected to login | Not started |
| AUTH-07 | Protect user-specific APIs | Authentication middleware | Send request to private API without session; verify HTTP 401 Unauthorized | Not started |
| AUTH-08 | Enforce record ownership | API authorization and query scoping | Authenticate as User A and attempt to query/modify User B's email; verify HTTP 403 Forbidden or 404 Not Found | Not started |
| AUTH-09 | Configure local and production OAuth redirects | Deployment configuration | OAuth callback functions properly on `localhost` during dev and on production domain when hosted | Not started |
| AUTH-10 | Handle authentication errors and expired sessions | Frontend and API error handling | Expired session returns 401; frontend prompts user to re-authenticate cleanly | Not started |
| AUTH-11 | Redirect to dashboard upon successful Google login | Frontend auth handler / API redirect | Complete Google login; verify browser automatically redirects to `/dashboard` route with active session | Not started |
| AUTH-12 | Display authenticated user info (name, email, avatar) and logout in dashboard header | Dashboard header component | Inspect dashboard header; verify user's display name, email, avatar image, and functional logout button are rendered | Not started |
| AUTH-13 | Prevent unauthenticated access to protected dashboard data and API endpoints | Auth middleware & route guards | Send unauthenticated requests to `/api/emails/*`; verify HTTP 401; verify frontend routes redirect unauthenticated users to `/login` | Not started |
| AUTH-14 | Backend verifies authenticated user ownership when reading or modifying data | API authorization & query scoping | Attempt cross-user query/mutation; verify database queries filter by authenticated `user_id` and reject cross-tenant access | Not started |
| AUTH-15 | Verify real Google OAuth end-to-end with configured credentials and callback URL | End-to-end manual verification | Execute real Google OAuth flow with live Client ID/Secret and configured callback URL; verify user consent, profile extraction, and session creation | Not started |

---

## 7. Frontend Dashboard and Composer

| ID | Requirement | Implementation Area | Verification Evidence | Status |
|---|---|---|---|---|
| FE-01 | Reproduce ReachInbox-style visual theme and layout | Design system and layout | Inspect layout structure, dark/light theme styling, typography, and iconography matching ReachInbox design | Not started |
| FE-02 | Implement clean login page | Login page component | Navigate to `/login`; verify clean login screen with branded Google Sign-In button | Not started |
| FE-03 | Implement main dashboard navigation and shell | Dashboard layout component | Log in; verify persistent sidebar/navigation, active route highlighting, and main content area | Not started |
| FE-04 | Implement Scheduled Emails view | Scheduled emails list component | Navigate to Scheduled tab; verify table/list of pending scheduled emails with appropriate column headers | Not started |
| FE-05 | Implement Sent Emails view | Sent emails list component | Navigate to Sent tab; verify table/list of delivered and failed emails with outcome indicators | Not started |
| FE-06 | Display recipient email in tables | Email list row component | Inspect table row; verify recipient email matches backend `recipient_email` | Not started |
| FE-07 | Display subject in tables | Email list row component | Inspect table row; verify email subject matches backend `subject` | Not started |
| FE-08 | Display scheduled and sent timestamps in clear timezone | Date formatting utility | Inspect timestamp displays; verify localized formatting with clear timezone indication (e.g. UTC or local) | Not started |
| FE-09 | Display status badge in tables | Status badge component | Inspect table row; verify distinct visual badges for `scheduled`, `processing`, `sent`, and `failed` | Not started |
| FE-10 | Implement Compose New Email action | Compose modal / drawer trigger | Click 'Compose'; verify compose modal or slide-over drawer opens smoothly | Not started |
| FE-11 | Provide subject input with validation | Compose form component | Enter subject; verify required field validation triggers if empty upon submission | Not started |
| FE-12 | Provide body input with rich/plain text support | Compose form component | Enter email body; verify text is preserved and submitted in payload | Not started |
| FE-13 | Support CSV and text recipient uploads | File upload parser component | Upload sample CSV and `.txt` files; verify parser extracts recipient list correctly | Not started |
| FE-14 | Show count of detected valid email addresses | Recipient summary indicator | Upload CSV with 15 emails; verify UI displays '15 valid recipients detected' | Not started |
| FE-15 | Validate and deduplicate uploaded recipients | Client-side parser utility | Upload CSV with duplicate and malformed emails; verify invalid addresses are flagged and duplicates are deduplicated | Not started |
| FE-16 | Provide start-time picker for scheduling | Date-time picker component | Select future date and time; verify selected ISO timestamp is submitted in `scheduled_at` | Not started |
| FE-17 | Provide per-sender delay input | Compose form delay field | Input minimum delay in seconds/milliseconds; verify value is submitted to API | Not started |
| FE-18 | Provide hourly-limit input | Compose form quota field | Input max emails per hour; verify value is submitted to API | Not started |
| FE-19 | Display loading skeletons and button spinners | Shared UI components | Trigger async requests; verify loading skeletons in tables and spinner on submit button | Not started |
| FE-20 | Display clear empty states | Empty state component | View Scheduled or Sent tables when no records exist; verify helpful graphic and empty message | Not started |
| FE-21 | Display toast notifications for success and error events | Toast notification system | Complete scheduling or trigger API error; verify toast appears with appropriate styling and auto-dismisses | Not started |
| FE-22 | Use reusable, typed components across frontend | Frontend component architecture | Inspect code; verify shared components (`Button`, `Table`, `Modal`, `Input`) use TypeScript interfaces | Not started |
| FE-23 | Prevent accidental duplicate form submission | Submit button state management | Double-click submit button; verify button disables immediately and only one network request is dispatched | Not started |
| FE-24 | Refresh email lists after scheduling or status transitions | State management / query invalidation | Submit new email; verify Scheduled list updates automatically without requiring full page reload | Not started |
| FE-25 | Provide responsive layout across desktop and tablet | Responsive CSS layout | Resize viewport to tablet/mobile widths; verify navigation collapses and tables remain readable with horizontal scroll | Not started |
| FE-26 | Manually compare implemented UI against all supplied visual reference screens and states | Frontend UI review (manual inspection by developer) | Side-by-side manual review of implemented screens vs reference designs: login page, scheduled list, sent list, opened-email view, empty composer, and populated composer | Not started |

---

## 8. Elasticsearch and Search

| ID | Requirement | Implementation Area | Verification Evidence | Status |
|---|---|---|---|---|
| ES-01 | Create Elasticsearch index with explicit mapping | Search module index initialization | Run index init script; verify `emails` index created with mappings for keyword, text, and date fields | Not started |
| ES-02 | Index emails upon creation in PostgreSQL | Indexing service | Schedule email; query Elasticsearch directly via `GET /emails/_doc/<id>`; verify document exists | Not started |
| ES-03 | Update index when email status changes | Search update service | Transition email to `sent` or `failed`; verify updated document fields in Elasticsearch | Not started |
| ES-04 | Provide search endpoint with multi-field queries | `GET /api/search/emails` | Query `/api/search/emails?q=test`; verify matches against recipient, subject, and body fields | Not started |
| ES-05 | Support pagination in search results | Search API (`from`/`size`) | Query search endpoint with `page=1&limit=10`; verify bounded result list and total hits count | Not started |
| ES-06 | Enforce user and tenant isolation in search queries | Search service query builder | Verify all Elasticsearch search queries include a `term: { user_id }` filter clause | Not started |
| ES-07 | Decouple email delivery from Elasticsearch availability | Asynchronous indexing queue/outbox | Simulate Elasticsearch downtime; verify scheduling and SMTP delivery proceed uninterrupted | Not started |
| ES-08 | Recover missed index updates via reconciliation | Reconciliation / backfill script | Run `npm run search:reindex`; verify all missing or outdated PostgreSQL records are synced to Elasticsearch | Not started |
| ES-09 | Make indexing idempotent | Document ID assignment | Index same email event multiple times; verify Elasticsearch document version increments without duplicate documents | Not started |
| ES-10 | Search newly scheduled emails before delivery | Search API & indexing service | Schedule email; immediately execute search query for recipient/subject; verify record returned with status `scheduled` before send time | Not started |
| ES-11 | Reflect updated status and sent time in search index after delivery | Worker indexing hook / event consumer | Deliver email; query search endpoint; verify document reflects status `sent` and accurate `sent_at` timestamp | Not started |
| ES-12 | Scope search results to authenticated user or tenant | Search API query filter | Query search API as User A for a term matching User B's emails; verify zero results from other users are returned | Not started |
| ES-13 | Document and test indexing failure resilience and recovery | Reindexing script & documentation | Stop Elasticsearch during scheduling, verify email sends successfully, restart ES, run recovery script, verify index is updated | Not started |

---

## 9. Bull Board and Operational Visibility

| ID | Requirement | Implementation Area | Verification Evidence | Status |
|---|---|---|---|---|
| OPS-01 | Integrate live Bull Board queue dashboard | Bull Board adapter (`apps/api`) | Navigate to `/admin/queues`; verify Bull Board UI renders connected to active BullMQ queue | Not started |
| OPS-02 | Display waiting, delayed, active, completed, and failed job counts | Bull Board UI | Enqueue jobs across states; verify Bull Board accurately reflects job counts in respective tabs | Not started |
| OPS-03 | Protect Bull Board route with authentication | Dashboard auth middleware | Access `/admin/queues` without authentication; verify HTTP 401/403 or redirect to login | Not started |
| OPS-04 | Prevent sensitive secrets in BullMQ job payloads | Queue job serializer | Inspect job data in Bull Board; verify SMTP passwords, access tokens, and sensitive headers are omitted | Not started |
| OPS-05 | Configure structured application and worker logging | Logger module (Pino / Winston) | Inspect console/logs during scheduling and execution; verify structured JSON logs with correlation IDs | Not started |
| OPS-06 | Support graceful shutdown for API and worker | Process signal handlers (`SIGTERM`, `SIGINT`) | Send `SIGINT` to running worker; verify active job completes, queue pauses, and process exits cleanly | Not started |
| OPS-07 | Expose detailed dependency health and readiness checks | Health check route (`/ready`) | Query `/ready`; verify JSON response reports status of PostgreSQL, Redis, and Elasticsearch | Not started |

---

## 10. Testing and Quality Assurance

| ID | Requirement | Implementation Area | Verification Evidence | Status |
|---|---|---|---|---|
| QA-01 | Test request validation | API test suite | Run `npm test -- api/validation`; 5 test cases passing verifying 400 Bad Request on invalid payloads, emails, missing fields, and past dates | Verified |
| QA-02 | Test database persistence across restarts | Integration test suite | Run `npm test -- db/persistence`; verify records inserted in test container persist across simulated reconnect | Verified |
| QA-03 | Test delayed scheduling accuracy | Worker integration test | Run `npm test -- worker/recovery`; verified delayed job calculated without timing drift within bounded tolerance | Verified |
| QA-04 | Test scheduling idempotency | API integration test | Run `npm test -- api/idempotency`; 3 test cases passing verifying cached response replay, conflict on payload change, and concurrent duplicate race safety | Verified |
| QA-05 | Test concurrent worker claims | Concurrency test suite | Run `npm test -- worker/concurrency`; verified competing workers result in exactly 1 claim and 0 duplicate sends | Verified |
| QA-06 | Test restart recovery of pending jobs | Recovery test suite | Run `npm test -- worker/recovery`; verified uncompleted outbox events and stale processing jobs resume on startup | Verified |
| QA-07 | Test per-sender minimum delay under load | Rate limiter test suite | Run `npm test -- rate-limit/delay`; verify timestamps between consecutive sends for same sender meet or exceed minimum interval | Not started |
| QA-08 | Test hourly quota enforcement under concurrent load | Rate limiter test suite | Run `npm test -- rate-limit/quota`; verify total sends within simulated hour never exceed configured hourly cap | Not started |
| QA-09 | Test quota-based job rescheduling | Worker test suite | Run `npm test -- worker/reschedule`; verify jobs exceeding quota are delayed to next window without failure | Not started |
| QA-10 | Test real Slack rate-limit notification | End-to-end integration test | Run test triggering quota exhaustion; verify Slack incoming webhook / Web API posts notification | Not started |
| QA-11 | Test real Google OAuth login and logout | Manual / E2E test | Execute login with valid Google account; verify user record created, session cookie set, and logout invalidates session | Not started |
| QA-12 | Test CSV parsing, validation, and deduplication | Parser unit test suite | Run `npm test -- parser/csv`; 6 test cases passing verifying headers, plain text, RFC 5322 regex validation, deduplication, and invalid tracking | Verified |
| QA-13 | Test Elasticsearch indexing and recovery | Search integration test suite | Run `npm test -- search/indexing`; verify indexing on create, update on send, and sync recovery after outage | Not started |
| QA-14 | Test cross-user authorization and data isolation | Security test suite | Run `npm test -- auth/isolation`; verify User A cannot view, schedule, or modify User B's emails | Not started |
| QA-15 | Test 1,000+ email batch scheduling | Load test script | Run `npm run test:load`; verify 1,000 emails are accepted, persisted in PostgreSQL, and enqueued in BullMQ without dropped records | Not started |
| QA-16 | Verify monorepo build, lint, and test commands | CI / validation scripts | Run `npm run build && npm run lint && npm test`; verify all workspace packages pass without errors | Verified |
| QA-17 | Audit documentation against actual code capabilities | Manual documentation review | Verify `README.md` and docs make no unsubstantiated claims and accurately record verified behavior and trade-offs | Not started |
| QA-18 | Verify SMTP post-acceptance crash scenario and recovery policy | Recovery integration test & crash simulator | Run `test/worker/post-acceptance-crash.test.ts`; confirmed recovery reconciles post-acceptance crash without duplicate send | Verified |
| QA-19 | Manual UI visual-fidelity verification against supplied ReachInbox reference | Manual developer review across reference screens | Developer manually inspects and verifies visual match against ReachInbox designs across login, scheduled list, sent list, opened-email view, and composer states (no agent browser automation) | Not started |
| QA-20 | End-to-end OAuth callback URL and environment verification | End-to-end manual verification with live credentials | Authenticate with real Google account and link real Slack workspace; verify live token exchanges, callback URL validity, and session persistence in dev and prod | Not started |

---

## 11. Deployment and Documentation

| ID | Requirement | Implementation Area | Verification Evidence | Status |
|---|---|---|---|---|
| DOC-01 | Document architecture and component responsibilities | `README.md` and `docs/architecture.md` | Inspect `README.md`; verify component diagram, responsibilities, and data flow are clearly articulated | Not started |
| DOC-02 | Document backend API and worker setup instructions | `README.md` | Follow backend setup instructions on clean environment; verify API and worker start without undocumented steps | Not started |
| DOC-03 | Document frontend setup instructions | `README.md` | Follow frontend setup instructions; verify web application starts and connects to backend | Not started |
| DOC-04 | Document database and Redis setup and migrations | `README.md` | Execute documented Docker and migration commands; verify database and Redis initialize correctly | Not started |
| DOC-05 | Document Ethereal SMTP configuration | `README.md` | Follow instructions to configure Ethereal credentials; verify test emails deliver and produce preview URLs | Not started |
| DOC-06 | Document Google OAuth setup and redirect URIs | `README.md` | Verify step-by-step instructions for Google Cloud Console, OAuth consent screen, and redirect URIs | Not started |
| DOC-07 | Document Slack OAuth setup and notification testing | `README.md` | Verify instructions for Slack app creation, OAuth scopes, bot tokens, and triggering rate limit alerts | Not started |
| DOC-08 | Document Elasticsearch setup and index initialization | `README.md` | Follow instructions to start Elasticsearch and initialize indices; verify search operates as documented | Not started |
| DOC-09 | Explain restart recovery and reconciliation mechanisms | `README.md` | Review documentation for clear description of startup reconciliation, outbox pattern, and BullMQ recovery | Not started |
| DOC-10 | Explain concurrency, delay, quota, and rescheduling behavior | `README.md` | Review documentation for detailed explanation of Redis atomic scripts, locking order, and window semantics | Not started |
| DOC-11 | Explain idempotency guarantees and SMTP delivery limitations | `README.md` | Verify documentation acknowledges the SMTP crash window and explains at-least-once delivery trade-offs | Not started |
| DOC-12 | Document all implemented features mapped to checklist | `README.md` | Inspect feature list; verify direct mapping from features to assignment checklist IDs | Not started |
| DOC-13 | Document assumptions, trade-offs, and design decisions | `README.md` | Review architecture notes for explicit justifications of technical choices and acknowledged trade-offs | Not started |
| DOC-14 | Provide clean `.env.example` with all configuration keys | `.env.example` in repository root | Inspect `.env.example`; verify all required environment variables are listed with dummy values and documentation | Not started |
| DOC-15 | Deploy application to accessible cloud hosting environment | Oracle Cloud Always Free VM (Docker Compose + Reverse Proxy) | Access deployed frontend and backend URLs on Oracle Cloud Always Free VM over HTTPS; verify hosted application is reachable and functional | Not started |
| DOC-16 | Verify production environment configuration and integrations | Hosted Oracle Cloud VM environment | Execute test workflow on hosted instance; verify OAuth, DB, Redis, worker, and SMTP function on Oracle Cloud VM | Not started |
| DOC-17 | Verify container image CPU architecture compatibility (ARM64 / multi-arch) on target VM | Target VM Docker deployment | Run `uname -m` and inspect container images; verify API, worker, web, PostgreSQL, Redis, and Elasticsearch initialize natively without architecture faults | Not started |
| DOC-18 | Configure reverse proxy with HTTPS and internal network isolation | Reverse proxy configuration (Nginx / Caddy) | Verify Let's Encrypt TLS on ports 80/443; execute port scan against public VM IP verifying ports 5432, 6379, 9200, and Bull Board are not publicly reachable | Not started |
| DOC-19 | Configure Elasticsearch resource bounds and monitor memory consumption on target VM | Target VM environment config (`ES_JAVA_OPTS`) | Verify `ES_JAVA_OPTS` limits heap (`-Xms512m -Xmx512m`); inspect `docker stats` under workload to ensure total memory stays within VM allocation and zero OOM kills occur | Not started |
| DOC-20 | Verify state persistence, scheduled-job recovery, and outbox reconciliation across container restarts and host VM reboot | Deployment recovery verification | Schedule future email, reboot host VM (`sudo reboot`), verify full stack auto-recovers on boot and pending email delivery completes cleanly | Not started |
| DOC-21 | Verify outbound SMTP egress connectivity from Oracle Cloud VM | Network security & SMTP transport | Probe port 587/465 egress from VM (`nc -zv smtp.ethereal.email 587`); execute test send confirming OCI VCN security lists permit SMTP outbound | Not started |

---

## 12. Submission Requirements

| ID | Requirement | Implementation Area | Verification Evidence | Status |
|---|---|---|---|---|
| SUB-01 | Keep the GitHub repository private | GitHub repository settings | Verify repository visibility is set to Private | Not started |
| SUB-02 | Invite reviewer `Mitrajit` as collaborator | GitHub repository collaborators | Send repository invitation to GitHub user `Mitrajit` with collaborator permissions; verify invitation is active | Not started |
| SUB-03 | Invite reviewer `Yadav036` as collaborator | GitHub repository collaborators | Send repository invitation to GitHub user `Yadav036` with collaborator permissions; verify invitation is active | Not started |
| SUB-04 | Push the latest source code and README to main branch | Git repository (`main` branch) | Verify remote `origin/main` has all committed source code, documentation, and lockfile | Not started |
| SUB-05 | Provide an active hosted assignment URL | Cloud deployment platform | Verify hosted application URL is live, accessible over HTTPS, and functional | Not started |
| SUB-06 | Record demo video no longer than 5 minutes | Video recording (Loom / Google Drive) | Check demo video file/link; verify recording duration is <= 5:00 minutes | Not started |
| SUB-07 | Demonstrate email scheduling workflow in demo video | Demo video content | Video demonstrates creating and scheduling single and batch emails | Not started |
| SUB-08 | Demonstrate Scheduled and Sent/Failed views in demo video | Demo video content | Video displays scheduled emails queue and sent emails history with status details | Not started |
| SUB-09 | Demonstrate restart recovery resilience in demo video | Demo video content | Video demonstrates scheduling a future email, restarting worker/API, and showing successful execution | Not started |
| SUB-10 | Demonstrate rate limiting and Slack alert in demo video | Demo video content | Video shows minimum delay spacing, quota deferral, and resulting Slack rate-limit alert | Not started |
| SUB-11 | Verify demo video public/reviewer permissions | Video hosting settings | Open demo link in incognito browser window; verify video plays without login/access request | Not started |
| SUB-12 | Prepare and enter full legal name | Submission form field | Verify applicant's full legal name is prepared and entered in submission form | Not started |
| SUB-13 | Prepare and enter contact details (phone number and email) | Submission form field | Verify applicant's phone number and primary email are prepared and entered in submission form | Not started |
| SUB-14 | Prepare and enter academic details (college, batch, CGPA, and attendance) | Submission form field | Verify college name, graduation batch year, CGPA, and attendance percentage are prepared and entered | Not started |
| SUB-15 | Prepare and enter professional links (LinkedIn profile and relevant links) | Submission form field | Verify LinkedIn profile URL and any portfolio/GitHub profile links are verified and entered | Not started |
| SUB-16 | Prepare and enter existing hosted project link | Submission form field | Verify prior hosted project link is live, tested, and entered in submission form | Not started |
| SUB-17 | Prepare and enter internship duration and joining availability | Submission form field | Verify preferred internship duration and immediate/exact joining availability date are entered | Not started |
| SUB-18 | Prepare and attach/link resume and cover letter | Submission form field | Verify updated resume and customized cover letter files/links are prepared and attached | Not started |
| SUB-19 | Enter accessible demo video URL | Submission form field | Verify demo video URL (<= 5 min) is verified and pasted into submission form | Not started |
| SUB-20 | Enter assignment GitHub repository URL | Submission form field | Verify private GitHub repository URL is entered into submission form | Not started |
| SUB-21 | Enter live hosted assignment URL | Submission form field | Verify accessible deployed assignment URL is entered into submission form | Not started |
| SUB-22 | Confirm reviewers (`Mitrajit` and `Yadav036`) have repository access | Submission form confirmation | Verify form confirmation confirming collaborator invitations to `Mitrajit` and `Yadav036` | Not started |
| SUB-23 | Confirm source code and README are pushed | Submission form confirmation | Verify form confirmation that code and comprehensive README are committed and pushed | Not started |
| SUB-24 | Truthfully affirm originality confirmation | Submission form confirmation | Affirm originality declaration confirming the implementation was developed independently | Not started |
| SUB-25 | Complete and submit assignment ClickUp form | ClickUp submission form (`https://forms.clickup.com/9005062261/f/8cbwp3n-8876/6NNNJ92DV93PQTAYST`) | Submit completed form; verify confirmation screen/receipt that response has been recorded | Not started |

Submission form URL: https://forms.clickup.com/9005062261/f/8cbwp3n-8876/6NNNJ92DV93PQTAYST

---

## 13. Definition of Done

The assignment is ready for submission only when:

- [ ] All mandatory requirements are implemented or any unavoidable limitation is explicitly documented.
- [ ] The scheduler, database, Redis queue, and SMTP delivery work together end-to-end.
- [ ] Restart recovery has been demonstrated and verified.
- [ ] Idempotency, concurrency safeguards, and atomic claims have been tested.
- [ ] Per-sender minimum delay and hourly quotas work across concurrent workers without dropping jobs.
- [ ] Batch execution respects start times, per-sender delays, and hourly quotas without premature sending.
- [ ] Real Slack OAuth and real rate-limit notification delivery have been verified in a live workspace.
- [ ] Real Google OAuth login, header profile display, protected routes, and logout have been verified.
- [ ] Elasticsearch indexing on creation, post-delivery status update, tenant scoping, and recovery have been verified.
- [ ] Bull Board is connected to the real queue and protected by authentication.
- [ ] Scheduled and Sent/Failed email views with status tracking and timestamps work.
- [ ] Compose workflow supports recipient validation, CSV upload, delay, quota, and duplicate prevention.
- [ ] Implemented UI has been manually compared and verified against all supplied ReachInbox reference screens and states.
- [ ] Post-SMTP acceptance crash scenario and conservative recovery policy are documented and verified.
- [ ] Comprehensive test suite (unit, integration, concurrency, and load) passes.
- [ ] README setup instructions, architecture, and limitation documentation have been followed and verified.
- [ ] Repository is private with collaborator invitations issued to `Mitrajit` and `Yadav036`.
- [ ] Demo video (<= 5 minutes) is recorded, publicly accessible without permission walls, and demonstrates required flows.
- [ ] Application is deployed to an Oracle Cloud Always Free VM via Docker Compose, secured behind an HTTPS reverse proxy with private network isolation, and confirmed accessible.
- [ ] All submission form fields are prepared and the ClickUp submission form is submitted successfully.

---

**Maintenance rule:** Update the Implementation Area, Verification Evidence, and Status as each requirement progresses. Use statuses strictly according to policy: `Not started` until work begins; `In progress` when actively underway; `Blocked` when a concrete dependency or issue prevents progress (recording the blocker and its impact); and `Verified` only when implemented code exists and tangible, successful verification evidence has passed. Never mark `Verified` based on plans, generated code, unexecuted tests, or unsupported assertions.

This checklist is the requirements source of truth. The architecture document, implementation roadmap, and testing strategy should reference these IDs instead of duplicating or redefining the requirements.
