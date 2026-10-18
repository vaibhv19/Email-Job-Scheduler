# Email Job Scheduler — Feature Walkthrough & Demo Guide

> **Goal:** Complete a clear, structured, end-to-end demonstration of all core system capabilities in **under 5 minutes**.

---

## Pre-Recording Checklist (1 Minute Before Recording)

1. **Services Running:**
   - PostgreSQL (`localhost:5433` or `5432`), Redis (`localhost:6380` or `6379`), and Elasticsearch (`localhost:9200`) running via Docker.
   - API running on `http://localhost:3001`.
   - Worker running (`apps/worker`).
   - Web frontend running on `http://localhost:5173`.
2. **Browser Setup:**
   - Tab 1: Frontend `http://localhost:5173` (logged out).
   - Tab 2: Bull Board `/admin/queues` (have credentials `admin` / `admin` ready).
   - Tab 3: Connected Slack workspace channel (to see rate-limit alert) or Ethereal inbox.
3. **Screen Layout:** 1080p desktop recording with clear audio.

---

## 5-Minute Demo Timeline

### 0:00 – 0:45 | Authentication & Identity (AUTH-01..AUTH-14, FE-02)
- **Action:** Open `http://localhost:5173`. Point out the clean modern dark slate UI.
- **Narrate:** "The application enforces real Google OAuth 2.0 with PKCE and HMAC-signed state cookies. Unauthenticated requests are rejected server-side."
- **Action:** Click **"Sign in with Google"**. Complete the standard Google consent screen.
- **Outcome:** Dashboard loads with user's verified identity pill in the top header (name, email, avatar image, and "OAuth Active" badge).
- **Narrate:** "The authenticated identity is verified from Google's stable subject ID and stored in PostgreSQL with secure, HTTP-only session cookies."

---

### 0:45 – 2:00 | Bulk Scheduling & Recipient Validation (BE-01..BE-04, FE-10..FE-18)
- **Action:** Click **"Compose Email"** button. The compose modal slides open.
- **Action:** Show the configured Sender dropdown with configured delay (e.g. 2,000ms) and hourly limit (e.g. 50/hr).
- **Action:** Switch recipient input mode to **"CSV File Upload"** and upload a sample CSV (or paste 5 recipient emails in Text mode).
- **Highlight:** Point out the real-time **recipient validation pill** showing detected valid recipient count.
- **Action:** Fill in subject: `Product Update - Q4 Overview` and a message body.
- **Action:** Click the **"+5m"** quick preset to stagger start time, or keep immediate send.
- **Action:** Click **"Schedule Email Batch"**. The button disables immediately with client-side idempotency protection.
- **Outcome:** Modal closes, toast notification confirms scheduling, and emails appear in the **Scheduled Outbox** tab with status `scheduled`.

---

### 2:00 – 2:50 | Worker Execution, SMTP Delivery & Ethereal Previews (SMTP-01..SMTP-04, FE-05)
- **Action:** Switch to the **"Sent & Delivered"** tab.
- **Narrate:** "The BullMQ worker picks up scheduled jobs using atomic database claims (`SELECT ... FOR UPDATE SKIP LOCKED` / atomic claim query) to eliminate duplicate sends across concurrent workers."
- **Highlight:** As jobs complete, the status badge transitions from `scheduled` → `processing` → `sent`.
- **Action:** Click the **"Open Preview"** link on one of the sent email rows.
- **Outcome:** The Ethereal Email web preview opens in a new tab showing the rendered HTML email, headers, stable `Message-ID`, and delivery timestamp.

---

### 2:50 – 3:45 | Full-Text Search via Elasticsearch & User Isolation (ES-01..ES-12, AUTH-08)
- **Action:** Click into the search bar: `"Search emails (Elasticsearch full-text)..."`.
- **Action:** Type a distinct keyword from the scheduled email subject or body (e.g., `Product` or recipient address).
- **Highlight:** The live search pill lights up, displaying instant full-text search hits from Elasticsearch.
- **Narrate:** "Elasticsearch indexes newly scheduled emails immediately upon creation and updates document status upon delivery. Every query is scoped server-side to the authenticated user ID (`bool.filter: { term: { user_id } }`), completely preventing cross-tenant data leaks."

---

### 3:45 – 4:30 | Rate Limiting, Slack Notifications & Bull Board (RATE-02..RATE-21, SLACK-01..SLACK-11, OPS-01..OPS-03)
- **Action:** In the top header, show the **"Slack Connected"** status pill (or click **"Connect Slack"** to demonstrate OAuth linkage).
- **Narrate:** "The worker enforces dual distributed rate limits via atomic Redis Lua scripts: minimum inter-send spacing and a sliding hourly quota per sender."
- **Action:** Show terminal logs or trigger batch exceeding the quota cap.
- **Outcome:**
  1. Worker logs show quota exhaustion: `Hourly quota exhausted for sender... Deferring to next UTC hour`.
  2. Emails are safely rescheduled to the next window using BullMQ `moveToDelayed` without treating exhaustion as a failure.
  3. A real, formatted **Rate Limit Alert block** appears in the connected Slack workspace channel.
  4. Point out Redis atomic deduplication: repeated blocked jobs in the same hour do NOT spam Slack.
- **Action:** Click **"Bull Board"** in the top header.
- **Action:** Show the HTTP Basic Auth prompt (`admin` / `admin`).
- **Outcome:** Bull Board dashboard renders live BullMQ queues displaying active, delayed, waiting, and completed job metrics.

---

### 4:30 – 5:00 | Wrap-up & Architecture Summary (INF-01..INF-14, DOC-01..DOC-21)
- **Action:** Briefly show the project repository structure:
  - Clean TypeScript monorepo (`apps/api`, `apps/worker`, `apps/web`, `packages/shared`, `packages/db`, `packages/redis`).
  - Production Docker Compose configuration (`docker-compose.prod.yml`) with internal network isolation and Caddy TLS reverse proxy.
  - Zero mock shortcuts in production paths: genuine OAuth, real PostgreSQL, Redis, Elasticsearch, and Ethereal SMTP.
- **Closing statement:** "This concludes the walkthrough of the Email Job Scheduler implementation."
