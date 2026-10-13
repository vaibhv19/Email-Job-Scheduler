# ReachInbox Email Scheduler — Requirements Checklist

> **Purpose:** Trace every requirement in the ReachInbox Software Development Intern assignment to its implementation area and verification evidence.
>
> **Rule:** A requirement is complete only when its implementation exists and the corresponding verification has passed.
>
> **Project:** ReachInbox Full-stack Email Job Scheduler  
> **Deadline:** 48 hours from assignment start  
> **Status:** Not started

## Status Legend

- [ ] Not started
- [x] Verified complete
- [!] Blocked or requires attention

Do not mark a requirement complete merely because code has been generated.

---

## 1. Project Foundation and Infrastructure

| ID | Requirement | Implementation area | Verification |
|---|---|---|---|
| INF-01 | Create a private GitHub repository | Repository | Repository visibility is private |
| INF-02 | Set up a TypeScript monorepo | Root workspace | API, worker, and frontend run independently |
| INF-03 | Configure Express.js backend | `apps/api` | API starts and health endpoint responds |
| INF-04 | Configure React or Next.js frontend | `apps/web` | Frontend builds and renders |
| INF-05 | Configure PostgreSQL or MySQL | Database and migrations | Application connects and migrations succeed |
| INF-06 | Configure Redis | Infrastructure | Queue and Redis connections work |
| INF-07 | Configure Elasticsearch | Search infrastructure | Index can be created and queried |
| INF-08 | Configure Docker Compose where practical | `infra/docker-compose.yml` | Required services start successfully |
| INF-09 | Persist PostgreSQL and Redis data | Docker volumes and Redis configuration | Data survives container restarts |
| INF-10 | Provide environment variable templates | `.env.example` | A developer can identify every required setting |
| INF-11 | Separate API and worker processes | API and worker applications | Each process can start and stop independently |
| INF-12 | Configure health and readiness checks | API and infrastructure | Healthy and unavailable dependencies are handled correctly |
| INF-13 | Configure TypeScript, linting, formatting, and tests | Workspace configuration | Documented commands execute successfully |
| INF-14 | Prevent secrets from entering source control | Git configuration and secret handling | No real credentials are committed |

## 2. Email Scheduling API and Persistence

| ID | Requirement | Implementation area | Verification |
|---|---|---|---|
| BE-01 | Accept email scheduling requests | `POST /api/emails/schedule` | Valid request creates email records and jobs |
| BE-02 | Persist email records in a relational database | Email repository and migrations | Records remain after API restart |
| BE-03 | Support single and bulk recipients | Scheduling service | Multiple valid recipients create individual logical email records |
| BE-04 | Validate recipients, subject, body, and schedule | API validation | Invalid requests receive useful errors |
| BE-05 | Use BullMQ delayed jobs backed by Redis | Queue and scheduling service | Jobs execute at their intended future time |
| BE-06 | Avoid cron jobs and process-local scheduling timers | Scheduling implementation | No cron-based scheduling dependency or mechanism exists |
| BE-07 | Support deterministic queue job IDs | Queue producer | Repeated enqueue attempts do not create duplicate logical jobs |
| BE-08 | Make scheduling requests idempotent | API and database constraints | Repeated requests with the same idempotency key return the existing logical result |
| BE-09 | Recover scheduled jobs after application restarts | Startup reconciliation and BullMQ | Pending jobs remain scheduled at their original times |
| BE-10 | Recover from database-to-queue partial failures | Scheduling and reconciliation | Missing queue jobs are safely recreated |
| BE-11 | Support email status tracking | Email state machine | Database accurately records scheduled, processing, sent, and failed states |
| BE-12 | Prevent concurrent workers from claiming the same email | Atomic database claim | Only one worker successfully claims a scheduled row |
| BE-13 | Handle worker crashes and stalled jobs | Worker recovery configuration | Records are reconciled without blindly resending ambiguous deliveries |
| BE-14 | Support API pagination and filtering | Email list endpoints | Lists return stable, bounded results |
| BE-15 | Support multiple sender configurations | Sender management | Emails can be associated with different senders |
| BE-16 | Handle past or invalid scheduling times | Scheduling validation | Invalid schedules are rejected or handled according to documented policy |
| BE-17 | Provide consistent API errors | API middleware | Failures return structured, useful responses |

## 3. SMTP Delivery and Idempotency

| ID | Requirement | Implementation area | Verification |
|---|---|---|---|
| SMTP-01 | Send emails through Ethereal SMTP | Worker mail service | A test message is accepted by Ethereal |
| SMTP-02 | Support multiple sender SMTP configurations | Sender service | Different sender configurations can be used |
| SMTP-03 | Store delivery outcomes | Email repository | SMTP outcomes and timestamps are persisted |
| SMTP-04 | Store Ethereal preview URLs where available | Delivery service | Preview URL is available for inspection |
| SMTP-05 | Generate a stable Message-ID per logical email | Mail service | Retries retain the same logical message identifier |
| SMTP-06 | Classify retryable and permanent failures | Worker error handling | Failure tests follow the configured retry policy |
| SMTP-07 | Avoid duplicate logical email creation | Database constraints and API | Duplicate requests do not create separate logical records |
| SMTP-08 | Handle ambiguous SMTP outcomes conservatively | Worker recovery and attempt records | Crash scenarios are documented and do not trigger blind retries |
| SMTP-09 | Document the exactly-once delivery limitation | README | Documentation explains the SMTP acceptance crash window |

**Reliability note:** BullMQ provides at-least-once job processing, not guaranteed exactly-once external delivery. A stable Message-ID does not guarantee SMTP-provider deduplication. The implementation must explicitly document and mitigate this limitation.

## 4. Worker Concurrency, Delay, and Hourly Rate Limits

| ID | Requirement | Implementation area | Verification |
|---|---|---|---|
| RATE-01 | Configure worker concurrency through environment variables | Worker configuration | Changing configuration changes effective concurrency |
| RATE-02 | Enforce a minimum delay between individual sends | Per-sender rate limiter | Recorded send times respect the configured interval |
| RATE-03 | Enforce delay across concurrent workers | Redis-backed coordination | Two workers cannot bypass the sender's minimum interval |
| RATE-04 | Implement configurable hourly email quotas | Rate-limit service | Configured quota is enforced |
| RATE-05 | Enforce quotas across multiple workers or instances | Atomic Redis operation or equivalent | Concurrent reservations cannot exceed the defined quota |
| RATE-06 | Scope limits per sender or tenant | Rate-limit keys and ownership | Different senders are accounted for independently |
| RATE-07 | Configure limit values without hardcoding | Environment and validated request configuration | Changing permitted configuration changes behavior |
| RATE-08 | Define how UI limits relate to server limits | API validation and README | Effective limits and caps are documented |
| RATE-09 | Reschedule jobs when the hourly quota is exhausted | BullMQ worker | Jobs remain pending for the next eligible window |
| RATE-10 | Preserve job order as far as practical | Scheduling policy | Jobs receive deterministic deferred execution times |
| RATE-11 | Avoid treating quota exhaustion as delivery failure | Worker state transitions | Deferred jobs are not permanently failed or dropped |
| RATE-12 | Handle quota reservations and failed sends correctly | Atomic rate-limit logic | Reservations and quota accounting follow documented rules |
| RATE-13 | Handle 1,000 or more emails scheduled at similar times | Bulk insertion and queue producer | Load test creates the batch without dropping jobs |
| RATE-14 | Avoid unbounded simultaneous delivery | Worker and rate limiter | Actual sends respect configured concurrency and rate constraints |
| RATE-15 | Document throttling and quota trade-offs | README | Window semantics, ordering, and reservation behavior are explained |

## 5. Slack OAuth and Notifications

| ID | Requirement | Implementation area | Verification |
|---|---|---|---|
| SLACK-01 | Implement real Slack OAuth | Slack integration | Authorization succeeds in a real workspace |
| SLACK-02 | Provide a Connect Slack action | Frontend and API | User can initiate authorization |
| SLACK-03 | Validate OAuth state | OAuth callback | Invalid or missing state is rejected |
| SLACK-04 | Store Slack credentials per user or tenant | Connection repository | Correct tenant receives notifications |
| SLACK-05 | Secure stored credentials | Token storage | Tokens are not exposed in client responses or logs |
| SLACK-06 | Support disconnect and reconnect | Slack integration | Connection state updates correctly |
| SLACK-07 | Send an actual message when a sender hits its hourly limit | Notification service | Message is received in the connected workspace |
| SLACK-08 | Avoid duplicate alerts per sender and quota window | Atomic notification deduplication | Multiple blocked jobs produce one relevant alert |
| SLACK-09 | Handle missing Slack connections gracefully | Notification service | Rate limiting continues without a Slack connection |
| SLACK-10 | Support connecting Slack after deployment | Runtime connection handling | Newly connected Slack works without redeployment |
| SLACK-11 | Handle Slack API failures | Notification error handling | Notification failures do not lose or permanently fail email jobs |

## 6. Google Authentication and Authorization

| ID | Requirement | Implementation area | Verification |
|---|---|---|---|
| AUTH-01 | Implement real Google OAuth login | Authentication module | Real Google login succeeds |
| AUTH-02 | Create or retrieve the local user record | User service | Authenticated identity is persisted correctly |
| AUTH-03 | Display user name | Dashboard header | Name matches authenticated profile |
| AUTH-04 | Display user email | Dashboard header | Email matches authenticated profile |
| AUTH-05 | Display user avatar | Dashboard header | Avatar loads when available |
| AUTH-06 | Implement logout | Authentication module | Session or authentication credential is invalidated |
| AUTH-07 | Protect user-specific APIs | Authentication middleware | Unauthenticated requests are rejected |
| AUTH-08 | Enforce record ownership | API and repository queries | Users cannot read or modify another user's records |
| AUTH-09 | Configure local and production OAuth redirects | Deployment configuration | OAuth callback works in both intended environments |
| AUTH-10 | Handle authentication errors and expired sessions | Frontend and API | User receives a useful error or login prompt |

## 7. Frontend Dashboard and Composer

| ID | Requirement | Implementation area | Verification |
|---|---|---|---|
| FE-01 | Reproduce the supplied ReachInbox-style design | UI components and page layouts | Manual comparison with the supplied reference |
| FE-02 | Implement a clean login page | Login screen | Google login is accessible and functional |
| FE-03 | Implement the main dashboard | Dashboard layout | Dashboard loads after successful login |
| FE-04 | Implement Scheduled Emails view | Scheduled tab | Scheduled records display correctly |
| FE-05 | Implement Sent Emails view | Sent tab | Sent and failed records display correctly |
| FE-06 | Display recipient email | Email tables | Recipient matches backend record |
| FE-07 | Display subject | Email tables | Subject matches backend record |
| FE-08 | Display scheduled or sent time | Email tables | Correct timestamp is displayed in a clear timezone |
| FE-09 | Display email status | Email tables | Current backend status is shown |
| FE-10 | Implement Compose New Email action | Dashboard | Composer opens correctly |
| FE-11 | Provide subject input | Composer | Subject is validated and submitted |
| FE-12 | Provide body input | Composer | Body is submitted correctly |
| FE-13 | Support CSV and text recipient uploads | Composer and parser | Supported files are parsed correctly |
| FE-14 | Show the number of valid email addresses detected | Composer | Count matches parser output |
| FE-15 | Validate and deduplicate recipients | Recipient parser | Duplicate and invalid addresses are handled transparently |
| FE-16 | Provide start-time selection | Composer | Correct schedule reaches the API |
| FE-17 | Provide delay configuration | Composer | Valid delay reaches the API |
| FE-18 | Provide hourly-limit configuration | Composer | Valid quota reaches the API |
| FE-19 | Display loading states | Shared UI components | Requests show loading feedback |
| FE-20 | Display empty states | Scheduled and sent views | Empty datasets produce clear messages |
| FE-21 | Display useful error and success messages | Toasts and form errors | API failures and successful submissions are visible |
| FE-22 | Use reusable, typed components | Frontend architecture | Shared components and API types are maintained consistently |
| FE-23 | Prevent accidental repeated form submission | Composer | Repeated clicks do not create duplicate requests |
| FE-24 | Refresh email lists after scheduling and status changes | Frontend data layer | Displayed records reflect backend state |
| FE-25 | Provide usable responsive layouts | Frontend styling | Essential workflows work at narrower screen widths |

## 8. Elasticsearch and Search

| ID | Requirement | Implementation area | Verification |
|---|---|---|---|
| ES-01 | Create an Elasticsearch index | Search module | Index and mapping are created |
| ES-02 | Index emails when created | Indexing service | New records become searchable |
| ES-03 | Update the index after status changes | Indexing service | Search reflects sent and failed states |
| ES-04 | Provide a search endpoint | Search API | Queries return matching email records |
| ES-05 | Support pagination | Search API | Large result sets are bounded |
| ES-06 | Enforce user or tenant access in search | Search API | Search cannot expose unauthorized records |
| ES-07 | Avoid coupling delivery to Elasticsearch availability | Asynchronous indexing | Elasticsearch outage does not block scheduling or SMTP delivery |
| ES-08 | Recover missed index updates | Durable indexing and reindexing | Failed or missed events can be replayed |
| ES-09 | Make indexing idempotent | Index document IDs | Repeated events do not create duplicate documents |

## 9. Bull Board and Operational Visibility

| ID | Requirement | Implementation area | Verification |
|---|---|---|---|
| OPS-01 | Integrate a live BullMQ dashboard | Bull Board | Dashboard shows actual queue state |
| OPS-02 | Show waiting, delayed, active, completed, and failed jobs | Queue dashboard | States match queue inspection |
| OPS-03 | Protect Bull Board | Authentication and authorization | Unauthorized access is rejected |
| OPS-04 | Avoid exposing secrets through job payloads | Queue design | Sensitive credentials are absent from dashboard-visible data |
| OPS-05 | Configure useful application and worker logs | Logging | Scheduling, failures, and retries are diagnosable |
| OPS-06 | Support graceful process shutdown | API and worker lifecycle | Pending jobs remain recoverable |
| OPS-07 | Expose appropriate health and readiness information | Health endpoints | Dependency failures are identifiable |

## 10. Testing and Quality Assurance

| ID | Requirement | Implementation area | Verification |
|---|---|---|---|
| QA-01 | Test request validation | API tests | Invalid requests are rejected |
| QA-02 | Test database persistence | Integration tests | Records survive process restarts |
| QA-03 | Test delayed scheduling | Worker integration tests | Email executes at the intended time |
| QA-04 | Test idempotency | API and worker tests | Duplicate requests do not create duplicate logical emails |
| QA-05 | Test concurrent claims | Worker integration tests | Only one worker claims a given scheduled record |
| QA-06 | Test restart recovery | Integration tests | Pending jobs survive API and worker restarts |
| QA-07 | Test per-sender minimum delay | Concurrency tests | Actual send intervals satisfy the configured policy |
| QA-08 | Test hourly quotas under concurrency | Rate-limit tests | Quota cannot be exceeded by parallel reservations |
| QA-09 | Test quota-based rescheduling | Worker tests | Deferred jobs execute in an eligible future window |
| QA-10 | Test real Slack notifications | Integration or manual test | Actual notification is received |
| QA-11 | Test real Google login | Manual end-to-end test | OAuth flow and logout work |
| QA-12 | Test CSV validation and deduplication | Parser tests | Counts and accepted recipients are correct |
| QA-13 | Test Elasticsearch indexing and recovery | Integration tests | Status changes become searchable and missed events recover |
| QA-14 | Test access control | API security tests | Cross-user access is rejected |
| QA-15 | Test a 1,000-job batch | Load or integration test | Batch is enqueued without dropped logical jobs |
| QA-16 | Verify build and test commands | CI or local verification | Documented commands pass |
| QA-17 | Record actual results and limitations | Documentation | README does not claim unverified behavior |

## 11. Deployment and Documentation

| ID | Requirement | Implementation area | Verification |
|---|---|---|---|
| DOC-01 | Document architecture and component responsibilities | `README.md` | A reviewer can understand the system |
| DOC-02 | Document backend setup | `README.md` | API and worker can be started from instructions |
| DOC-03 | Document frontend setup | `README.md` | Frontend starts from instructions |
| DOC-04 | Document database and Redis setup | `README.md` | Infrastructure and migrations are reproducible |
| DOC-05 | Document Ethereal configuration | `README.md` | SMTP can be configured without source changes |
| DOC-06 | Document Google OAuth configuration | `README.md` | Redirect URI and credential setup are explained |
| DOC-07 | Document Slack OAuth configuration | `README.md` | OAuth setup and real notification testing are explained |
| DOC-08 | Document Elasticsearch setup | `README.md` | Indexing and search can be reproduced |
| DOC-09 | Explain restart recovery | `README.md` | Persistence and reconciliation are described |
| DOC-10 | Explain concurrency and rate limits | `README.md` | Delay, quota, reservation, and rescheduling behavior are explained |
| DOC-11 | Explain idempotency and SMTP limitations | `README.md` | Residual duplicate-delivery risk is acknowledged |
| DOC-12 | Document implemented features | `README.md` | Features map to assignment requirements |
| DOC-13 | Document assumptions and trade-offs | `README.md` | Shortcuts and limitations are explicit |
| DOC-14 | Provide `.env.example` | Repository | All required configuration variables are listed safely |
| DOC-15 | Deploy the application where feasible | Hosting configuration | Hosted application is accessible to reviewers |
| DOC-16 | Verify production configuration | Deployment | OAuth, database, Redis, worker, and integrations work in the target environment |

## 12. Submission Requirements

| ID | Requirement | Implementation area | Verification |
|---|---|---|---|
| SUB-01 | Keep the GitHub repository private | GitHub settings | Repository is private |
| SUB-02 | Invite `mitrajit` | GitHub collaborators | Invitation is issued |
| SUB-03 | Invite `Yadav036` | GitHub collaborators | Invitation is issued |
| SUB-04 | Push the source code and README | Git repository | Latest intended commit is available |
| SUB-05 | Provide a hosted assignment URL | Deployment | Application URL is accessible |
| SUB-06 | Record a demo video no longer than five minutes | Loom or Google Drive | Video link opens and duration is within the limit |
| SUB-07 | Demonstrate email scheduling | Demo video | A scheduled email is created |
| SUB-08 | Demonstrate scheduled and sent views | Demo video | Both views are shown |
| SUB-09 | Demonstrate restart recovery | Demo video | Pending jobs survive a process restart |
| SUB-10 | Demonstrate rate limiting where practical | Demo video | Delay or quota behavior is shown |
| SUB-11 | Verify demo permissions | Video hosting | Reviewers can access the video |
| SUB-12 | Complete the assignment submission form | ClickUp form | Form submission is confirmed |
| SUB-13 | Provide applicant details and résumé/cover letter | Submission form | Required fields and attachments are supplied |
| SUB-14 | Provide a relevant hosted project link | Submission form | Project URL is accessible |
| SUB-15 | Confirm README and code are pushed | Submission form | Repository contains the submitted implementation |
| SUB-16 | Confirm collaborator invitations | Submission form | Both reviewer invitations have been issued |
| SUB-17 | Confirm originality truthfully | Submission form | Submitted code is original and explainable |

Submission form: https://forms.clickup.com/9005062261/f/8cbwp3n-8876/6NNNJ92DV93PQTAYST

## 13. Definition of Done

The assignment is ready for submission only when:

- [ ] All mandatory requirements are implemented or any unavoidable limitation is explicitly documented.
- [ ] The scheduler, database, Redis queue, and SMTP delivery work together.
- [ ] Restart recovery has been demonstrated.
- [ ] Idempotency and concurrency safeguards have been tested.
- [ ] Per-sender minimum delay and hourly quotas work across workers.
- [ ] A real Slack notification has been verified.
- [ ] Real Google OAuth works.
- [ ] Elasticsearch indexing and search work.
- [ ] Bull Board is connected to the real queue and protected.
- [ ] Scheduled and sent/failed views work.
- [ ] The frontend has been checked against the supplied visual reference.
- [ ] README setup instructions have been followed successfully.
- [ ] Repository permissions and hosted links are verified.
- [ ] The demo video is recorded, accessible, and no longer than five minutes.
- [ ] The assignment submission form is completed.

---

**Maintenance rule:** Update the implementation area, verification evidence, and status as each requirement is completed. If a requirement is blocked, record the blocker and its impact rather than marking it complete.

This checklist is the requirements source of truth. The architecture document, implementation roadmap, and testing strategy should reference these IDs instead of duplicating or redefining the requirements.
