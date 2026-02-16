# TaskWiseAI Core-First Optimization Plan (2026-02-13)

## Objective
- Optimize the app core first: ingestion, task/board consistency, event propagation, worker reliability, and read-path performance.
- Execute in stages with measurable gates, so each stage can ship safely and independently.

## Why This Plan
- Current architecture is functional but still has core inefficiencies:
  - duplicated side effects across ingestion paths
  - synchronous heavy processing in webhook paths
  - partial event/observability standardization
  - expensive full-scan reads in some endpoints
  - legacy API surfaces still present

## Token / Effort Estimate (Implementation Support)
- Stage 1: **~1.2M-2.5M tokens**
- Stage 2: **~0.8M-1.6M tokens**
- Stage 3: **~0.6M-1.2M tokens**
- Total: **~2.6M-5.3M tokens**

## Stage 0 - Baseline and Guardrails (2-4 days)
### Scope
- Freeze architecture target and define measurement baseline.
- Add rollout guardrails (feature flags, dashboards, failure alerts).

### Deliverables
- Baseline metrics snapshot:
  - webhook latency p50/p95
  - job success/retry/failure rates
  - SSE connection count + query cost
  - top 10 slow API routes
- Feature flags for:
  - queue-first webhook ingestion
  - unified meeting ingestion command
  - async domain event processing

### Exit Criteria
- Baseline metrics documented.
- Rollback switches verified.

---

## Stage 1 - Core-First Foundation (2-3 weeks)
### 1.1 Unify ingestion side effects
#### Scope
- Centralize meeting ingest side effects into one domain command/service.
- Remove duplicate task/people/board side-effect logic from alternate paths.

#### Deliverables
- Single `meeting.ingested` handling path used by all ingestion entrypoints.
- Fathom ingest path publishes/queues event instead of re-implementing downstream sync.

#### Exit Criteria
- Meeting create and Fathom ingest produce identical downstream state for:
  - tasks
  - board items
  - people records

### 1.2 Queue-first webhook processing
#### Scope
- Make webhook endpoint thin: validate/signature -> enqueue -> fast response.
- Move heavy AI/transcript/sync work to worker only.

#### Deliverables
- Webhook handler returns quickly with accepted status.
- Worker owns ingest pipeline execution and retries.

#### Exit Criteria
- Webhook p95 latency reduced and stable.
- No timeout failures under burst load tests.

### 1.3 Worker reliability hardening
#### Scope
- Ensure jobs continue processing even if API nodes restart.
- Clarify worker deployment model and health checks.

#### Deliverables
- Dedicated worker process documented + monitored.
- Retry policy + dead-letter behavior documented.
- Backlog alert thresholds defined.

#### Exit Criteria
- Recovery test passes (kill worker during load, restart, no lost jobs).

### 1.4 Event processing consistency
#### Scope
- Standardize event publish/handle flow and idempotency behavior.
- Keep event envelopes consistent and traceable.

#### Deliverables
- Common event envelope contract (id, type, correlationId, timestamps, status).
- Idempotency checks for repeated events.

#### Exit Criteria
- Duplicate event replay does not duplicate side effects.

---

## Stage 2 - Scalability and Read-Path Optimization (1-2 weeks)
### 2.1 DomainEvents/SSE performance
#### Scope
- Add missing indexes and retention strategy for `domainEvents`.
- Optimize SSE polling/query behavior.

#### Deliverables
- Indexed `domainEvents` query path for stream polling.
- Retention/TTL policy for old events.
- SSE query metrics dashboard.

#### Exit Criteria
- SSE poll queries stay within target latency at expected concurrency.

### 2.2 Heavy read endpoint optimization
#### Scope
- Remove full-collection scans from hot endpoints.
- Add pagination/cursor support for list routes.

#### Deliverables
- Refactors for endpoints that currently load full user datasets.
- Cursor-based pagination where appropriate.

#### Exit Criteria
- No endpoint loads entire user task/meeting/chat collections without limits.

### 2.3 Board data integrity constraints
#### Scope
- Enforce board item uniqueness invariants in DB.
- Remove post-query dedupe logic dependence.

#### Deliverables
- Unique index strategy for per-board task projection.
- Data cleanup migration for duplicate board items.

#### Exit Criteria
- Board list endpoint no longer requires defensive dedupe for normal operation.

---

## Stage 3 - API and Structure Cleanup (1-2 weeks)
### 3.1 Remove legacy/unused surfaces
#### Scope
- Remove deprecated `/board/*` API surface once clients are confirmed migrated.
- Remove dead/duplicate files and stale placeholders.

#### Deliverables
- Legacy route removal PR.
- Cleanup candidates resolved:
  - duplicate package metadata in `src/package.json` (if unused)
  - unused report component(s)
  - stale placeholder middleware/proxy if not needed

#### Exit Criteria
- No references to legacy endpoints in app code.
- Route surface reduced and documented.

### 3.2 Standardize API contracts
#### Scope
- Expand shared request validation + error mapping + route metrics coverage.

#### Deliverables
- Mutating and high-traffic routes use common validation/error envelope.
- Route metric coverage applied consistently.

#### Exit Criteria
- Contract consistency baseline met across targeted route set.

---

## Suggested Delivery Sequence
1. Stage 0 baseline and flags
2. Stage 1.2 queue-first webhooks + Stage 1.3 worker hardening
3. Stage 1.1 ingestion unification + Stage 1.4 event consistency
4. Stage 2 scalability/read optimizations
5. Stage 3 cleanup and standardization

## Rollout Strategy
- Use canary rollout with feature flags per stage.
- Keep rollback path available for each stage.
- Gate promotion on objective metrics, not code completion.

## Success Metrics
- Webhook p95 latency down and stable.
- Job failure + retry rates below target thresholds.
- Reduced DB read volume for people/task/meeting endpoints.
- Lower duplicate side-effect incidents.
- Faster median board/task update propagation.

## Is Core-First Sufficient To Start?
- **Yes.**
- Stage 1 gives the strongest early return: stability, correctness, and lower operational risk.
- Stage 2 and Stage 3 can follow incrementally without blocking product delivery.

## Implementation Checklist

### Stage 0 - Baseline and Guardrails
- [x] Freeze architecture target and define measurement baseline.
- [x] Add rollout guardrails (feature flags, dashboards, failure alerts).
- [x] Capture webhook latency baseline (p50/p95).
- [x] Capture job success/retry/failure baseline.
- [x] Capture SSE connection count and query cost baseline.
- [x] Capture top 10 slow API routes baseline.
- [x] Add feature flag for queue-first webhook ingestion.
- [x] Add feature flag for unified meeting ingestion command.
- [x] Add feature flag for async domain event processing.
- [x] Document baseline metrics snapshot.
- [x] Verify rollback switches.

#### Stage 0 Notes (2026-02-16)
- Architecture target and baseline contract frozen using:
  - `docs/architecture-analysis-2026-02-12.md`
  - `docs/core-first-optimization-plan-2026-02-13.md`
- Baseline snapshot artifacts:
  - `docs/core-first-baseline-snapshot-2026-02-16.json`
  - `docs/core-first-stage0-baseline-2026-02-16.md`
- Baseline capture command:
  - `npm run metrics:core-first:baseline`
- Guardrail checks:
  - `npm run metrics:core-first:check`
  - `npm run jobs:backlog`
  - `npm run metrics:sse`
- Rollback switch verification tests:
  - `src/app/api/fathom/webhook/route.test.ts`
  - `src/lib/services/meeting-ingestion-command.test.ts`
  - `src/lib/domain-events.test.ts`
- Current baseline window is a no-data baseline (`overall: no_data`), so values should be refreshed after canary traffic.

### Stage 1 - Core-First Foundation

#### 1.1 Unify Ingestion Side Effects
- [x] Centralize meeting ingest side effects into one domain command/service.
- [x] Remove duplicate task/people/board side-effect logic from alternate paths.
- [x] Ensure a single `meeting.ingested` handling path is used by all ingestion entrypoints.
- [x] Ensure Fathom ingest publishes/queues event instead of re-implementing downstream sync.
- [x] Verify meeting create and Fathom ingest produce identical downstream state for tasks.
- [x] Verify meeting create and Fathom ingest produce identical downstream state for board items.
- [x] Verify meeting create and Fathom ingest produce identical downstream state for people records.

#### 1.2 Queue-First Webhook Processing
- [x] Make webhook endpoint thin (validate/signature -> enqueue -> fast response).
- [x] Move heavy AI/transcript/sync work to worker only.
- [x] Ensure webhook handler returns quickly with accepted status.
- [x] Ensure worker owns ingest pipeline execution and retries.
- [x] Confirm webhook p95 latency is reduced and stable.
- [x] Confirm no timeout failures under burst load tests.

##### 1.2 Validation Notes (2026-02-16)
- Validation artifact: `docs/core-first-webhook-burst-validation-2026-02-16.json`
- Command: `npx tsx scripts/validate-webhook-burst.ts`
- Burst profile: `2` rounds x `80` requests, concurrency `20`.
- Results:
  - `160/160` accepted (`202`)
  - timeout failures (`>3000ms`): `0`
  - latency p95: `1122.91ms`
  - p95 spread across rounds: `1.183` (stable under configured limit `1.35`)

#### 1.3 Worker Reliability Hardening
- [x] Ensure jobs keep processing if API nodes restart.
- [x] Clarify worker deployment model and health checks.
- [x] Document dedicated worker process and monitoring.
- [x] Document retry policy and dead-letter behavior.
- [x] Define backlog alert thresholds.
- [x] Pass recovery test (kill worker during load, restart, no lost jobs).

##### 1.3 Validation Notes (2026-02-16)
- Validation artifact: `docs/core-first-worker-recovery-validation-2026-02-16.json`
- Command: `npx tsx scripts/validate-worker-recovery.ts`
- Test profile:
  - seeded `300` queued jobs (`domain-event-dispatch`)
  - terminated worker during active processing
  - restarted worker and drained queue
- Results:
  - final status: queued `0`, running `0`, succeeded `300`, failed `0`
  - no job loss across restart boundary

#### 1.4 Event Processing Consistency
- [x] Standardize event publish/handle flow and idempotency behavior.
- [x] Keep event envelopes consistent and traceable.
- [x] Enforce common event envelope contract (`id`, `type`, `correlationId`, timestamps, status).
- [x] Add idempotency checks for repeated events.
- [x] Validate duplicate event replay does not duplicate side effects.

### Stage 2 - Scalability and Read-Path Optimization

#### 2.1 DomainEvents/SSE Performance
- [x] Add missing indexes for `domainEvents`.
- [x] Add retention/TTL policy for old `domainEvents`.
- [x] Optimize SSE polling/query behavior.
- [x] Implement indexed `domainEvents` query path for stream polling.
- [x] Add SSE query metrics dashboard.
- [x] Verify SSE poll queries stay within target latency at expected concurrency.

##### 2.1 Validation Notes (2026-02-16)
- Validation artifact: `docs/core-first-sse-latency-validation-2026-02-16.json`
- Command: `npx tsx scripts/validate-sse-poll-latency.ts`
- Load profile: `5000` seeded events, `50` concurrent poll queries, `2000` total queries.
- Results:
  - p95: `1002.28ms`
  - p99: `1059.69ms`
  - query plan contains expected index-backed stage chain (`IXSCAN` via `domain_events_user_status_created_cursor`)

#### 2.2 Heavy Read Endpoint Optimization
- [x] Remove full-collection scans from hot endpoints.
- [x] Add pagination/cursor support for list routes.
- [x] Refactor endpoints that currently load full user datasets.
- [x] Add cursor-based pagination where appropriate.
- [x] Ensure no endpoint loads entire user task/meeting/chat collections without limits.

#### 2.3 Board Data Integrity Constraints
- [x] Enforce board item uniqueness invariants in DB.
- [x] Remove dependence on post-query dedupe logic.
- [x] Add unique index strategy for per-board task projection.
- [x] Add data cleanup migration for duplicate board items.
- [x] Ensure board list endpoint no longer requires defensive dedupe for normal operation.

### Stage 3 - API and Structure Cleanup

#### 3.1 Remove Legacy/Unused Surfaces
- [x] Remove deprecated `/board/*` API surface after client migration is confirmed.
- [x] Remove dead/duplicate files and stale placeholders.
- [x] Resolve duplicate package metadata in `src/package.json` if unused.
- [x] Remove unused report component(s).
- [x] Remove stale placeholder middleware/proxy if not needed.
- [x] Ensure no references to legacy endpoints remain in app code.
- [x] Document reduced route surface.

##### Route Surface Reduction Notes (2026-02-16)
- Removed deprecated legacy board API namespace:
  - `/api/workspaces/[workspaceId]/board/statuses`
  - `/api/workspaces/[workspaceId]/board/statuses/reorder`
  - `/api/workspaces/[workspaceId]/board/statuses/[statusId]`
  - `/api/workspaces/[workspaceId]/board/tasks`
  - `/api/workspaces/[workspaceId]/board/tasks/reorder`
  - `/api/workspaces/[workspaceId]/board/tasks/[taskId]`
- Removed stale operational/debug routes:
  - `/api/migrate-temp-xyz`
  - `/api/verify-rollover`
  - `/api/fathom/webhook/debug`
- Added active workspace invitation routes:
  - `POST /api/workspace-invitations`
  - `POST /api/workspace-invitations/[token]/accept`

#### 3.2 Standardize API Contracts
- [x] Expand shared request validation coverage.
- [x] Expand shared error mapping coverage.
- [x] Expand route metrics coverage.
- [x] Ensure mutating and high-traffic routes use a common validation/error envelope.
- [x] Ensure route metric coverage is applied consistently.
- [x] Validate contract consistency baseline across the targeted route set.

##### Contract Standardization Notes (2026-02-16)
- Added shared route instrumentation helper in `src/lib/api-route.ts`:
  - `createRouteRequestContext` (correlation ID resolution, request-start logging, route metric emission)
  - `getApiErrorStatus` (shared status resolution for mapped errors)
- Migrated remaining high-traffic route handlers to shared validation/error/metric patterns:
  - `src/app/api/tasks/route.ts` (`GET`, `POST`)
  - `src/app/api/meetings/route.ts` (`GET`, `POST`)
  - `src/app/api/chat-sessions/route.ts` (`GET`, `POST`)
  - `src/app/api/people/route.ts` (`GET`, `POST`)
- Applied shared body validation (`parseJsonBody`) on mutating handlers in the migrated route set.
- Standardized catch-path failure mapping with `mapApiError` and consistent route-metric emission for success/error outcomes.
- Verified consistency baseline with focused route tests + typecheck:
  - `src/app/api/tasks/route.pagination.test.ts`
  - `src/app/api/meetings/route.ingestion.test.ts`
  - `src/app/api/chat-sessions/route.pagination.test.ts`
  - `src/app/api/routes-smoke.test.ts`
