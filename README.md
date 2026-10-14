# ReachInbox Full-Stack Email Job Scheduler

A production-grade, distributed email job scheduling system built for the ReachInbox Software Development Intern assignment. The platform provides persistent delayed email dispatch via BullMQ, atomic per-sender rate limiting (minimum inter-send interval and sliding hourly quota), Ethereal SMTP delivery with preview tracking, dual-provider OAuth integrations (Google Sign-In and Slack notifications), full-text search via Elasticsearch, operational queue visibility with Bull Board, and a ReachInbox-styled React dashboard.

---

## 1. Project Documentation Index

- **[Requirements Checklist](file:///docs/requirements-checklist.md):** Authoritative requirements source of truth tracing all assignment criteria.
- **[Architecture Specification](file:///docs/architecture.md):** Architectural decisions, state machines, Redis Lua scripts, failure recovery, and target OCI deployment topology.
- **[Implementation Roadmap](file:///docs/implementation-roadmap.md):** 10-phase dependency-ordered execution plan, branch workflow, and handoff protocols.
- **[Testing Strategy](file:///docs/testing-strategy.md):** Multi-tiered test pyramid, test isolation safeguards, and planned deployment acceptance checks.

---

## 2. Technology Stack

| Layer                   | Technology                            | Role                                                                    |
| ----------------------- | ------------------------------------- | ----------------------------------------------------------------------- |
| **Frontend**            | React, TypeScript, Vite, Tailwind CSS | ReachInbox-styled compose form, scheduling tables, search               |
| **API Backend**         | Node.js, Express, TypeScript          | Validation, auth sessions, scheduling outbox, search endpoints          |
| **Worker Backend**      | Node.js, BullMQ, TypeScript           | Atomic job claiming, rate-limit enforcement, SMTP delivery              |
| **Relational Database** | PostgreSQL 16                         | Primary authoritative state for emails, senders, and accounts           |
| **Queue & Cache**       | Redis 7 (AOF enabled)                 | BullMQ delayed queue storage, distributed locks, rate-limit counters    |
| **Search Engine**       | Elasticsearch 8                       | Full-text indexing of recipient, subject, status, and metadata          |
| **SMTP Delivery**       | Nodemailer + Ethereal Email           | Disposable test SMTP delivery and message preview tracking              |
| **Operational UI**      | Bull Board                            | Authenticated queue monitoring dashboard (`/admin/queues`)              |
| **Local Orchestration** | Docker Compose                        | Local development services (`infra/docker-compose.yml`)                 |
| **Target Deployment**   | Oracle Cloud Always Free VM           | Constrained single-host demonstration deployment (Planned for Phase 10) |
| **Reverse Proxy**       | Nginx / Caddy                         | HTTPS termination and internal Docker network isolation (Phase 10)      |

---

## 3. Local Development Setup

### 3.1 Prerequisites

- **Node.js:** v20.x or higher
- **npm:** v10.x or higher
- **Docker & Docker Compose:** Docker Engine 24+ with Compose v2+

### 3.2 Environment Configuration

Copy the template environment file in the repository root:

```bash
cp .env.example .env
```

Inspect `.env` and verify local development settings:

- `PORT=3001`
- `DATABASE_URL=postgresql://postgres:postgres@localhost:5433/reachinbox_scheduler` (or port 5432)
- `REDIS_URL=redis://localhost:6380` (or port 6379)
- `ELASTICSEARCH_NODE=http://localhost:9200`
- `WORKER_CONCURRENCY=5`
- Generate session and CSRF secrets if activating authentication.

### 3.3 Starting Local Infrastructure

Start the local data stores via Docker Compose:

```bash
docker compose -f infra/docker-compose.yml up -d
```

Verify container health:

```bash
docker compose -f infra/docker-compose.yml ps
```

### 3.4 Database Migrations

Run schema migrations against PostgreSQL:

```bash
npm run db:migrate
```

### 3.5 Running Application Services

Start services in separate terminal windows:

```bash
# Terminal 1: Express API Server
npm run dev --filter api

# Terminal 2: Background BullMQ Worker
npm run dev --filter worker

# Terminal 3: React Web Frontend
npm run dev --filter web
```

### 3.6 Automated Tests

Execute the automated test suite across packages:

```bash
# Unit, API, and worker integration tests
npm test

# Linting and TypeScript typechecking
npm run lint
npm run typecheck
```

---

## 4. Planned Deployment Target (Phase 10 — Oracle Cloud Always Free VM)

> [!NOTE]
> **Deployment Status Disclaimer:**  
> The application is currently under active development on the local baseline (`phase-04/worker-smtp`).  
> **It is not yet deployed, publicly hosted, or validated on Oracle Cloud.**  
> Hosted deployment, reverse proxy configuration, DNS setup, and live smoke testing are strictly scheduled for **Phase 10** (`phase-10/deployment-submission`).

### 4.1 Deployment Architecture Summary

- **Target Platform:** Oracle Cloud Infrastructure (OCI) Always Free tier.
- **Instance Candidates:**
  - OCI Ampere A1 Compute (Arm-based, up to 4 OCPUs / 24 GB RAM eligible across tenancy).
  - OCI AMD micro compute (x86_64, 1/8 OCPU / 1 GB RAM).
- **Topology:** Single virtual machine running the full containerized stack via Docker Compose fronted by an HTTPS reverse proxy (Nginx or Caddy).
- **ARM64 Compatibility Requirement:** If an Ampere A1 (ARM64) instance is selected, all container images (`node:20-alpine`, `postgres:16-alpine`, `redis:7-alpine`, `elasticsearch:8.x`) and native dependencies must run natively on `linux/arm64`. Compatibility will be verified at deployment time.

### 4.2 Network Boundary & Security Isolation

- **Public Ports:** Only ports `80` (HTTP redirect/ACME) and `443` (HTTPS) are exposed through the reverse proxy to the public internet. SSH (port `22`) is restricted to key-based administrative access.
- **Private Docker Network:** PostgreSQL (`5432`), Redis (`6379`), Elasticsearch (`9200`), the API (`3001`), and Bull Board are isolated within a private Docker bridge network (`reachinbox-network`) and **do not publish ports to the public host IP**.
- **HTTPS & OAuth Callbacks:** Google OAuth 2.0 and Slack OAuth strictly require HTTPS callback URLs. The reverse proxy provides TLS certificates (e.g. Let's Encrypt), and cookies enforce `COOKIE_SECURE=true; SameSite=Lax`.
- **Outbound SMTP Verification:** Outbound SMTP connectivity from within the VM to Ethereal SMTP over port `587` (STARTTLS) or `465` (SSL) will be explicitly verified; cloud firewalls (OCI Security Lists) must permit this outbound egress.

### 4.3 Resource Budgeting & Elasticsearch Heap Bounding

- **Elasticsearch Memory Management:** Elasticsearch is a significant memory consumer. On a constrained Always Free VM, its heap must be strictly bounded via `ES_JAVA_OPTS="-Xms512m -Xmx512m"` to prevent host memory exhaustion and Linux OOM killer termination.
- **Worker Concurrency Bounding:** `WORKER_CONCURRENCY` is bounded (typically 2–5) to prevent CPU starvation and connection saturation on the constrained single VM.

### 4.4 Persistence and Recovery Boundaries

- **Persistent Data:** PostgreSQL data, Redis AOF data, and Elasticsearch indices reside in Docker named volumes.
- **Reboot Resilience:** All services specify `restart: unless-stopped`. When the VM reboots (`sudo reboot`), the Docker daemon auto-resumes containers, and the transactional outbox reconciliation service recovers pending jobs.
- **Single-Host Limitation:** Named volumes protect data across container updates and restarts, but **do not protect against VM loss, disk corruption, or cloud tenancy reclamation**. Off-host database backups (`pg_dump`) represent the required disaster-recovery strategy for persistent environments.

---

## 5. Delivery Guarantees and Operational Limitations

1. **At-Least-Once Delivery Semantics:** BullMQ provides at-least-once job execution. Due to the network ambiguity window where a message is accepted by an SMTP server (SMTP 250) but the worker crashes before writing confirmation to PostgreSQL, impossible exactly-once delivery cannot be guaranteed over external SMTP. The system reconciles post-acceptance crashes conservatively without duplicate resends.
2. **Ethereal SMTP Preview-Only:** Ethereal SMTP is a developer testing service. It captures sent messages and returns preview URLs (`nodemailer.getTestMessageUrl`); it does not deliver messages to real recipient mailboxes.
3. **Single Point of Failure (SPOF):** The target Oracle Cloud Always Free deployment operates on a single host. If the VM is stopped or hypervisor maintenance occurs, all services experience temporary downtime. High availability and multi-region redundancy are out of scope for this assignment demonstration.
