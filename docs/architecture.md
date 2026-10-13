# ReachInbox Email Scheduler — Architecture

## 1. Purpose

Define the architecture, component responsibilities, data flow, persistence guarantees, rate-limiting strategy, and failure-handling behavior for the ReachInbox Full-stack Email Job Scheduler assignment.

This document is subordinate to `docs/requirements-checklist.md`. Every implementation decision must satisfy the requirements checklist.

## 2. Technology Stack

| Layer | Technology | Responsibility |
|---|---|---|
| Frontend | React + TypeScript + Tailwind CSS | Authentication, dashboard, compose workflow |
| API | Node.js + TypeScript + Express | Validation, authentication, email management |
| Queue | BullMQ | Delayed jobs, retries, execution state |
| Queue storage | Redis | Persistent queue data and distributed coordination |
| Relational database | PostgreSQL | Source of truth for application data |
| SMTP | Nodemailer + Ethereal | Test email delivery |
| Search | Elasticsearch | Searchable email records |
| Queue dashboard | Bull Board | Operational queue visibility |
| Authentication | Google OAuth | User authentication |
| Notifications | Slack OAuth and Slack API | Rate-limit notifications |
| Infrastructure | Docker Compose | Local service orchestration |

Use compatible, stable package versions and commit the lockfile.

## 3. High-Level Architecture

```text
                    ┌────────────────────────┐
                    │ React Frontend         │
                    │ Google OAuth / UI      │
                    └───────────┬────────────┘
                                │ HTTPS / API
                    ┌───────────▼────────────┐
                    │ Express API            │
                    │ Validation / Auth      │
                    │ Email / Sender Modules │
                    └──────┬─────────┬───────┘
                           │         │
                  ┌────────▼───┐ ┌───▼────────────┐
                  │ PostgreSQL │ │ Redis / BullMQ │
                  │ Source of  │ │ Delayed Queue  │
                  │ Truth      │ │ Rate Limits    │
                  └────────────┘ └───┬────────────┘
                                     │
                              ┌──────▼─────────┐
                              │ Worker         │
                              │ Claim / Throttle│
                              │ SMTP Delivery  │
                              └───┬────────┬───┘
                                  │        │
                          ┌───────▼──┐  ┌──▼────────┐
                          │ Ethereal │  │ PostgreSQL│
                          │ SMTP     │  │ Status    │
                          └──────────┘  └───────────┘

             PostgreSQL changes ──► Durable indexing mechanism
                                            │
                                    ┌───────▼────────┐
                                    │ Elasticsearch  │
                                    └────────────────┘

             Worker rate-limit event ──► Slack API
             BullMQ queue ─────────────► Bull Board
```

## 4. Application Structure

```text
apps/
  api/
    src/
      config/
      middleware/
      modules/
        auth/
        users/
        emails/
        senders/
        scheduling/
        slack/
        search/
      routes/
      app.ts
      server.ts

  worker/
    src/
      config/
      processors/
      mail/
      rate-limiter/
      notifications/
      recovery/
      worker.ts

  web/
    src/
      components/
      features/
        auth/
        dashboard/
        compose/
        scheduled-emails/
        sent-emails/
        slack/
        search/
      services/
      types/
      pages/

packages/
  shared/
    src/

infra/
  docker-compose.yml

docs/
  requirements-checklist.md
  architecture.md
  implementation-roadmap.md
  testing-strategy.md
```

Keep business logic out of route handlers. API controllers should validate and delegate to services; repositories should handle database access.

## 5. Core Data Model

All application-owned entities use PostgreSQL. Store timestamps in UTC using `timestamptz`.

### 5.1 Users

Fields:

- `id`: UUID primary key.
- `google_subject`: unique Google identity identifier.
- `email`: authenticated email address.
- `name`: display name.
- `avatar_url`: nullable profile image.
- `created_at`, `updated_at`.

### 5.2 Senders

Fields:

- `id`: UUID primary key.
- `user_id`: owning user or tenant.
- `email`: sender email address.
- `display_name`: optional display name.
- `smtp_config_ref`: reference to server-side SMTP credentials.
- `min_send_interval_ms`: configured minimum interval.
- `max_emails_per_hour`: configured hourly quota.
- `created_at`, `updated_at`.

Never return SMTP credentials through the API. Keep credentials in environment configuration or an appropriately protected secret store.

### 5.3 Emails

Create one logical email record per recipient.

Fields:

- `id`: UUID primary key.
- `user_id`: owning user.
- `sender_id`: foreign key to sender.
- `recipient_email`: destination address.
- `subject`: email subject.
- `body`: email body.
- `scheduled_at`: intended execution time.
- `status`: `scheduled`, `processing`, `sent`, or `failed`.
- `idempotency_key`: nullable request idempotency key.
- `bullmq_job_id`: deterministic queue job identifier.
- `message_id`: stable logical Message-ID.
- `provider_message_id`: provider response when available.
- `preview_url`: Ethereal preview URL when available.
- `sent_at`: nullable successful-send timestamp.
- `last_error`: sanitized error details.
- `created_at`, `updated_at`.

Use database constraints and indexes for idempotency, ownership, scheduled execution, and common list queries. Ensure the uniqueness scope of an idempotency key is explicit.

### 5.4 Email Attempts

Fields:

- `id`: UUID primary key.
- `email_id`: foreign key to email.
- `attempt_number`: monotonically increasing attempt number.
- `started_at`, `finished_at`.
- `outcome`: `in_progress`, `accepted`, `rejected`, or `unknown`.
- `provider_message_id`: nullable provider reference.
- `error_code`: nullable sanitized error category.
- `error_message`: nullable sanitized diagnostic.

This table records delivery attempts; it does not independently authorize a resend.

### 5.5 Slack Connections

Fields:

- `id`: UUID primary key.
- `user_id`: owning user or tenant.
- `team_id`: Slack workspace identifier.
- `access_token_encrypted`: encrypted token.
- `scopes`: granted permissions.
- `connected_at`, `updated_at`.

Use a connection status or revocation mechanism as needed. OAuth tokens must never be returned to the frontend.

### 5.6 Reliable Events and Notifications

Use a durable event/outbox mechanism for work that must not be lost between a PostgreSQL commit and an external operation.

An event record should include:

- `id`.
- `event_type`.
- `aggregate_id`.
- `payload`.
- `created_at`.
- `processed_at`.
- `attempt_count`.
- `last_error`.

Use unique event identifiers to make consumers idempotent. Apply this mechanism to Elasticsearch indexing and, where appropriate, Slack notification delivery.

## 6. Email Lifecycle

```text
API request
    |
    v
Validate authentication, payload and limits
    |
    v
Persist logical email records
    |
    v
Enqueue deterministic BullMQ delayed jobs
    |
    v
Worker receives eligible job
    |
    v
Atomically claim scheduled email in PostgreSQL
    |
    v
Reserve sender delay and hourly quota
    |
    +---- Limit unavailable ----► Reschedule job
    |                             |
    |                             └──► Preserve scheduled record
    |
    v
Record delivery attempt
    |
    v
Send through Ethereal SMTP
    |
    +---- Accepted ----► Persist sent status and provider details
    |
    +---- Permanent failure ----► Persist failed status
    |
    +---- Retryable failure ----► Apply configured retry policy
    |
    └---- Ambiguous outcome ----► Reconcile conservatively
```

Each recipient is an independent logical email. A batch request can therefore have partial success without hiding which recipients were accepted, rejected, or scheduled.

## 7. API Contracts

All endpoints require authentication unless explicitly designated as an OAuth callback or health endpoint.

### Authentication

- `GET /api/auth/google`: initiate Google OAuth.
- `GET /api/auth/google/callback`: validate the OAuth response and establish the session.
- `POST /api/auth/logout`: terminate the session.
- `GET /api/auth/me`: return the authenticated user's profile.

### Email scheduling

- `POST /api/emails/schedule`: validate, persist, and enqueue a single or batch scheduling request.
- `GET /api/emails/scheduled`: list the user's scheduled emails.
- `GET /api/emails/sent`: list sent and failed emails.
- `GET /api/emails/:id`: retrieve a permitted email record.
- `GET /api/search/emails`: search indexed email records.

### Slack

- `GET /api/slack/connect`: initiate Slack OAuth.
- `GET /api/slack/callback`: validate and complete the authorization.
- `DELETE /api/slack/connection`: disconnect Slack.
- `GET /api/slack/connection`: return connection status without credentials.

### Operations

- `GET /health`: process health.
- `GET /ready`: readiness of required dependencies.
- Bull Board: expose the queue dashboard at a documented, protected route.

Use consistent response envelopes, validation errors, HTTP status codes, pagination, and ownership checks.

## 8. Scheduling and Persistence

### 8.1 Database-to-queue coordination

PostgreSQL and Redis do not share a transaction. A successful database write followed by a failed queue operation can leave a scheduled email without a job.

For reliable recovery:

1. Persist email records in PostgreSQL.
2. Record durable scheduling intent, using an outbox or equivalent recoverable mechanism.
3. Enqueue BullMQ jobs using deterministic job IDs derived from email IDs.
4. Mark scheduling intent as processed only after successful enqueueing.
5. Reconcile pending scheduling intent and scheduled email rows during startup and through an explicitly triggered recovery operation.
6. Make all reconciliation operations safe to repeat.

Use bounded batches and avoid loading the entire database into memory.

### 8.2 Redis persistence

Configure Redis persistence and persistent storage volumes. Document the actual durability settings used.

BullMQ can recover persisted jobs, but Redis persistence alone does not replace database reconciliation.

### 8.3 No cron

Use BullMQ delayed jobs for scheduled execution. Do not use cron libraries, operating-system cron, or in-process timers to decide when emails should be sent.

## 9. Idempotency and Delivery Guarantees

BullMQ can redeliver work after worker failures. Database state and queue state must therefore be coordinated.

- Use the email UUID as the deterministic BullMQ job ID.
- Claim an email using an atomic conditional update from `scheduled` to `processing`.
- Skip jobs whose database record is no longer eligible for processing.
- Persist attempt state and the stable Message-ID.
- Use a clear retry policy for known transient failures.
- Avoid automatic retries when SMTP acceptance may already have occurred but cannot be confirmed.
- Reconcile stale processing records according to documented recovery rules.

**Guarantee limitation:** Exactly-once external email delivery cannot be guaranteed by PostgreSQL, BullMQ, and ordinary SMTP alone. A crash after SMTP acceptance but before recording success can cause uncertainty. The system must document this limitation and prefer conservative recovery over blindly resending.

## 10. Distributed Rate Limiting

### 10.1 Minimum delay

Enforce minimum intervals per sender through Redis-backed atomic coordination.

Maintain a next-eligible-send timestamp or equivalent reservation. An atomic operation must ensure that concurrent workers cannot reserve overlapping send slots.

If a sender is not yet eligible, defer the job rather than blocking a worker with an in-memory sleep.

Define whether the configured interval is measured between send reservations or completed send attempts. Document the chosen semantics and test them.

### 10.2 Hourly quota

Use a Redis-backed atomic quota reservation keyed by sender and a defined UTC hour window.

An atomic script should:

1. Identify the relevant sender and quota window.
2. Read the configured limit.
3. Reserve capacity only if the quota permits it.
4. Set or preserve the counter expiry.
5. Return the reservation outcome and next eligible window.

Define how reservations are accounted for after worker crashes or SMTP failures. Do not decrement a quota blindly when the outcome is ambiguous.

### 10.3 Deferred jobs

When the quota is exhausted:

- Keep the database record scheduled.
- Move the active BullMQ job to an eligible future time using supported BullMQ APIs and worker-token semantics.
- Use a deterministic offset to preserve approximate ordering.
- Treat quota exhaustion as deferral, not a delivery failure.
- Avoid repeatedly notifying Slack for every blocked job.

Use a consistent locking/reservation order to avoid deadlocks between the delay and hourly-quota mechanisms.

## 11. Slack Notification Lifecycle

1. The user initiates Slack OAuth.
2. The backend validates OAuth state and exchanges the authorization code.
3. The backend stores the encrypted connection against the user or tenant.
4. A rate-limit reservation identifies a quota-hit event.
5. The application creates a deduplicated notification event for that sender and window.
6. A notification handler sends a real message through Slack.
7. Delivery outcome and retry information are recorded.
8. Missing or revoked connections are handled without disrupting email scheduling.

Notification failure must not discard queued emails or bypass the quota.

## 12. Elasticsearch Indexing

PostgreSQL remains authoritative for email records.

- Index documents using the PostgreSQL email ID.
- Index searchable fields such as recipient, subject, status, scheduled time, sent time, sender, and owner.
- Update indexed state after relevant transitions.
- Use durable asynchronous indexing so Elasticsearch downtime does not break scheduling.
- Make indexing idempotent.
- Provide retry and reindexing capabilities.
- Enforce authorization when serving search results.

Search results may lag behind PostgreSQL during outages. Document the consistency model and provide a way to recover missed updates.

## 13. Frontend Architecture

Organize the frontend by feature:

- Authentication and user profile.
- Dashboard navigation.
- Compose form and CSV parsing.
- Scheduled email table.
- Sent and failed email table.
- Search.
- Slack connection status.
- Shared API client and TypeScript response types.
- Shared loading, empty, error, toast, and form components.

The frontend must match the supplied ReachInbox reference while retaining every assignment-required control. The compose form must submit actual scheduling parameters to the backend.

Do not rely on client-side authorization or treat client-provided rate limits as trusted configuration.

## 14. Security

- Verify Google identity server-side.
- Use secure session handling and appropriate CSRF protection.
- Validate OAuth state for both providers.
- Scope database queries and search results to the authenticated owner.
- Validate every request on the backend.
- Encrypt stored OAuth tokens.
- Keep SMTP and provider credentials server-side.
- Restrict CORS and operational dashboard access.
- Redact secrets and unnecessary personal data from logs.
- Use TLS in deployed environments.
- Avoid including credentials in queue payloads.
- Apply reasonable payload-size and batch-size limits.

## 15. Observability

Record structured events for:

- Scheduling requests and rejected recipients.
- Job enqueueing and reconciliation.
- Worker claims and state transitions.
- Rate-limit reservations and deferrals.
- SMTP outcomes and retry decisions.
- Slack notification outcomes.
- Elasticsearch indexing failures.
- Worker shutdown and recovery.

Use correlation IDs or email IDs to trace one logical email through the system. Do not log access tokens, SMTP passwords, or full sensitive message contents.

## 16. Key Failure Scenarios

| Failure | Required behavior |
|---|---|
| API stops after database insert | Durable scheduling intent is reconciled |
| Queue enqueue fails | Pending intent remains recoverable |
| Worker crashes before SMTP send | Job can recover without creating another logical email |
| Worker crashes after SMTP acceptance | Outcome is treated as potentially ambiguous |
| Hourly quota is exhausted | Job is deferred, not dropped |
| Two workers reserve a sender simultaneously | Atomic coordination enforces limits |
| Slack is disconnected | Email processing continues |
| Slack API is unavailable | Notification is retried without losing email jobs |
| Elasticsearch is unavailable | Core scheduling and delivery continue |
| Redis container restarts | Persistent queue state is recovered where possible; DB reconciliation repairs gaps |
| Duplicate API request arrives | Idempotency prevents duplicate logical email creation |
| User queries another user's record | Access is denied |

## 17. Performance and Scale

For 1,000 or more emails scheduled at a similar time:

- Batch database inserts.
- Use BullMQ bulk enqueueing.
- Configure bounded worker concurrency.
- Apply sender-level distributed throttling.
- Defer jobs when limits are reached.
- Keep queue payloads small.
- Use indexed database queries and pagination.
- Keep search indexing asynchronous.
- Record the batch size and conditions used in load tests.

Do not claim unlimited throughput or production-scale guarantees from a small assignment load test.

## 18. Architectural Decision Rules

1. PostgreSQL is the source of truth.
2. BullMQ and Redis control scheduled execution.
3. No cron-based scheduling.
4. Rate limits must be safe across multiple workers.
5. External side effects must be treated as potentially ambiguous after crashes.
6. Elasticsearch is a derived, recoverable index.
7. Slack notification failures must not lose email jobs.
8. All user-specific operations enforce server-side ownership checks.
9. Every mandatory requirement maps to `docs/requirements-checklist.md`.
10. Every implemented feature must have verification evidence.
11. Trade-offs and unimplemented requirements must be documented honestly.