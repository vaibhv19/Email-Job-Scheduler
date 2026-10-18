# Email Job Scheduler — Architecture

## 1. Purpose

Define the architecture, component responsibilities, data flow, persistence guarantees, rate-limiting strategy, and failure-handling behavior for the Email Job Scheduler.

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
| Infrastructure | Docker Compose | Local service and single-host orchestration |
| Reverse proxy | Nginx / Caddy | Public TLS termination and routing (Phase 10 deployment) |
| Deployment target | Oracle Cloud Infrastructure (Always Free VM) | Constrained single-host demonstration hosting (Phase 10) |

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

The frontend provides a clean, responsive interface retaining every required scheduling and monitoring control. The compose form must submit actual scheduling parameters to the backend.

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

Do not claim unlimited throughput or production-scale guarantees from a single-node load test.

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

## 19. Target Deployment Architecture — Oracle Cloud Infrastructure (OCI) Always Free VM

### 19.1 Target Platform and Single-Host Topology
- **Platform:** Oracle Cloud Infrastructure (OCI) Always Free compute tier.
- **Topology:** Single standalone virtual machine running the full containerized application stack via Docker Compose.
- **Hardware & CPU Architecture:**
  - Deployment target candidates include OCI Ampere A1 Compute (Arm-based, up to 4 OCPUs / 24 GB RAM eligible across tenancy) or AMD micro compute instances (x86_64, 1/8 OCPU / 1 GB RAM).
  - **Architecture Dependency:** If an Ampere A1 (ARM64) instance is selected, all container images (Node.js base images for API/worker/frontend, PostgreSQL, Redis, Elasticsearch) and native dependencies must support `linux/arm64`. Multi-arch or ARM64-compatible Docker base images (`node:20-alpine` or `node:20-bookworm-slim`, official `postgres:16-alpine`, `redis:7-alpine`, and official `elasticsearch:8.x`) must be verified at deployment time.
  - **Deployment-Time Fact Verification:** Target shape, actual CPU architecture, available memory, disk quota, region availability, and Always Free capacity availability are strictly deployment-time facts to verify during Phase 10. Do not treat instance availability as a static guarantee.
- **Availability & SLA Assumption:**
  - This architecture represents a containerized single-host deployment topology suitable for cloud VM hosting.
  - It is **not** a fault-tolerant, multi-AZ, or highly available distributed cluster.
  - Single-host failure, cloud hypervisor maintenance, host reboots, or cloud provider capacity reclamation will result in service downtime. Uninterrupted uptime is explicitly disclaimed.

### 19.2 Container Orchestration & Private Network Boundary
The containerized runtime topology on the target VM consists of:
1. **Reverse Proxy (Nginx / Caddy):** Exposes ports `80` (HTTP redirect) and `443` (HTTPS). Manages TLS certificate provisioning (e.g., Let's Encrypt / Certbot) and proxies traffic to the internal frontend and API containers.
2. **React Web Frontend (Vite / Static Web Server):** Serves the compiled client SPA bundle over the internal Docker network.
3. **Express API Server:** Listens on internal port `3001` (or internal network), reachable only through the reverse proxy.
4. **BullMQ Background Worker:** Runs as a dedicated background process on the internal Docker network, connecting to PostgreSQL and Redis. No external ports exposed.
5. **PostgreSQL 16:** Runs on the internal Docker network (`scheduler_network`).
6. **Redis 7:** Runs on the internal Docker network with AOF persistence enabled.
7. **Elasticsearch 8:** Runs on the internal Docker network for indexing and search queries.

```text
                      Internet (Public Clients / Webhooks)
                                       │
                              HTTPS:443 / HTTP:80
                                       ▼
                       ┌───────────────────────────────┐
                       │  Reverse Proxy (Nginx/Caddy)  │  (Public Edge)
                       └───────────────┬───────────────┘
                                       │ Docker Private Network
       ┌───────────────────────────────┼──────────────────────────────┐
       │                               │                              │
┌──────▼──────┐                 ┌──────▼──────┐                ┌──────▼──────┐
│  React Web  │                 │ Express API │                │ Bull Board  │
│  (Port 80)  │                 │ (Port 3001) │                │(Auth-Gated) │
└─────────────┘                 └──────┬──────┘                └──────┬──────┘
                                       │                              │
            ┌──────────────────────────┼──────────────────────────────┤
            │                          │                              │
     ┌──────▼──────┐            ┌──────▼──────┐                ┌──────▼──────┐
     │ PostgreSQL  │            │ Redis 7.x   │◄───────────────┤   Worker    │
     │ (Port 5432) │            │ (Port 6379) │                │ (No Ports)  │
     └──────┬──────┘            └─────────────┘                └──────┬──────┘
            │                          ▲                              │
            │                          │ (AOF Volume)                 ▼
            │                   ┌──────┴──────┐                ┌─────────────┐
            └──────────────────►│Elasticsearch│                │Ethereal SMTP│
                                │ (Port 9200) │                │(Outbound    │
                                └─────────────┘                │ Port 587)   │
```

**Network Isolation Safeguards:**
- Internal stateful services (`postgres`, `redis`, `elasticsearch`) and worker processes **must not publish host ports** directly to `0.0.0.0` or the public VM IP.
- Operational dashboards (Bull Board at `/admin/queues`) must be routed strictly through the reverse proxy behind HTTP Basic Authentication and session authorization; never exposed on raw host ports.
- Oracle Cloud VCN Security Lists / Network Security Groups (NSGs) and host firewalls (`iptables` / `firewalld` / `ufw`) must restrict inbound ingress strictly to ports `22` (SSH administrative access, key-based only), `80` (HTTP ACME/redirect), and `443` (HTTPS).

### 19.3 Resource Constraints & Elasticsearch Heap Budgeting
- **Elasticsearch Memory Footprint:**
  - Elasticsearch is a Java-based process with significant memory and heap demands. By default, Elasticsearch can exhaust available RAM on small VMs, causing Linux Out-Of-Memory (OOM) killer terminations of the worker, API, or database.
  - On a constrained VM (e.g., Ampere A1 with 6–24 GB or an AMD instance), Elasticsearch heap must be explicitly bounded via `ES_JAVA_OPTS`:
    - Recommended budget: `-Xms512m -Xmx512m` (or at most `-Xms1g -Xmx1g` if ample RAM exists).
    - Swap should be disabled or memory paging controlled to preserve Lucene performance.
- **System Memory Budgeting:**
  - Target allocation across containers must be budgeted before deployment:
    - PostgreSQL: ~256MB–512MB shared buffers / working memory.
    - Redis: ~128MB–256MB (maxmemory policy: `noeviction` for queue reliability).
    - Elasticsearch: 512MB heap + ~512MB Lucene off-heap cache = ~1GB.
    - Node.js API: ~256MB.
    - Node.js Worker: ~256MB.
    - Reverse Proxy & OS Overhead: ~512MB.
  - Total working set: ~2.5 GB minimum recommended RAM. If running on an instance with less memory, resource starvation risks must be documented and monitored.
- **Worker Concurrency Bounding:**
  - Worker concurrency (`WORKER_CONCURRENCY`) must be tuned to VM CPU cores (typically `2` to `5` jobs).
  - Do not blindly increase concurrency to compensate for resource constraints, as excessive concurrent Nodemailer connections and DB transactions will trigger connection timeouts and CPU saturation.

### 19.4 Persistence, Backup Considerations, and Crash Recovery
- **Docker Named Volumes:**
  - Persistent state must reside in dedicated Docker named volumes or host-mounted volumes:
    - PostgreSQL data: `postgres_data -> /var/lib/postgresql/data`
    - Redis data: `redis_data -> /data`
    - Elasticsearch data: `es_data -> /usr/share/elasticsearch/data`
- **Redis Durability:**
  - Append-Only File (`appendonly yes`, `appendfsync everysec`) must be enabled on Redis so that delayed job metadata in BullMQ survives container restarts.
- **Single-Host Failure Boundary & Backup Considerations:**
  - **Volume Durability Limit:** Named volumes protect data across container updates and restarts (`docker compose down && docker compose up -d`), but **do not protect against VM termination, local disk corruption, or cloud tenancy deletion**.
  - Periodic database backups (`pg_dump`) to remote object storage or local compressed snapshots represent a necessary consideration for persistent environments.
- **Restart Policies & Reboot Resilience:**
  - All Compose services must configure `restart: unless-stopped`.
  - The Docker daemon must be enabled via `systemctl enable docker` so the full stack recovers automatically on VM reboot.
  - On startup, the transactional outbox reconciliation service detects and re-enqueues any orphaned email jobs, ensuring clean recovery from host reboots.

### 19.5 Networking, HTTPS, and Outbound SMTP Verification
- **HTTPS & OAuth Callbacks:**
  - Google OAuth 2.0 and Slack OAuth strictly require HTTPS callback URLs for non-localhost endpoints.
  - The reverse proxy must provide valid TLS certificates matching the registered domain (e.g., `https://scheduler.<domain>/api/auth/google/callback`).
  - Session cookies must enforce `COOKIE_SECURE=true` and `SameSite=lax`.
- **Server-Side Secret Isolation:**
  - All credentials (`SESSION_SECRET`, `TOKEN_ENCRYPTION_KEY`, `GOOGLE_CLIENT_SECRET`, `SLACK_CLIENT_SECRET`, database passwords) must reside exclusively in a server-side `.env` file on the VM with restricted file permissions (`chmod 600 .env`).
  - Client-side builds must contain only public `VITE_*` variables.
- **Outbound SMTP Port Egress Verification:**
  - Cloud hosting platforms (including Oracle Cloud Infrastructure) frequently block outbound TCP traffic on port `25` by default to prevent spam, and some tenancies restrict outbound ports `587` or `465`.
  - SMTP connectivity to `smtp.ethereal.email` over port `587` (STARTTLS) or `465` (SSL) must be actively verified from within the deployed VM using `nc -zv smtp.ethereal.email 587` or a probe script.
  - Security Lists and OCI VCN Egress Rules must permit outbound TCP traffic to the target SMTP port.

### 19.6 Operational & Delivery Limitations
- **Ethereal SMTP Preview-Only:** Ethereal SMTP captures messages for testing and provides message preview URLs (`nodemailer.getTestMessageUrl`); it does not deliver messages to real recipient inboxes.
- **Single Point of Failure (SPOF):** Running all application tiers, queue storage, and relational storage on a single VM means any hardware, hypervisor, or OS fault halts the entire system.
- **At-Least-Once Delivery Ambiguity:** As defined in Section 11, BullMQ ensures at-least-once job execution. Network interruptions occurring after SMTP acceptance but before database confirmation cannot guarantee exactly-once delivery; recovery logic handles this conservatively without blind duplicate dispatch.