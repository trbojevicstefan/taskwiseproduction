# TaskWiseAI Architecture Analysis (2026-02-12)

## Scope
- Reviewed runtime architecture, backend services, integrations, data model, API design, operational scripts, and engineering practices.
- Source of truth for findings: current repository code only.

## Executive Summary
- The app is currently a Next.js monolith with 66 API routes, MongoDB as the primary data store, and AI/integration workflows embedded in route handlers.
- It also contains a second backend surface (Firebase Cloud Functions) that is partially active/legacy and currently inconsistent with the main backend direction.
- The core product pipeline (Fathom ingest -> meeting analysis -> task sync -> board sync -> Slack auto-share) is feature-rich, but operational risk is elevated due to exposed debug/migration routes, schema/validation gaps, and large synchronous request handlers.
- The fastest upgrade path is: harden security and build gates first, then split long-running work into background workers, then consolidate backend surfaces and simplify the data model.

## Current Architecture (As Implemented)

### 1) Application Runtime
- Next.js App Router application with API routes and server-side handlers.
- Auth is NextAuth (JWT session strategy): `src/lib/auth.ts:118`, `src/lib/auth.ts:120`.
- API-layer user auth is mostly `getSessionUserId` based across route handlers.

### 2) Data Layer
- Primary persistence is MongoDB with shared connection helper:
  - `src/lib/mongodb.ts:3`
  - `src/lib/db.ts:39`
- Workspace is user-scoped and resolved from user document:
  - `src/lib/workspace.ts:4`
- Tasks are canonicalized/synced from meetings/chats into `tasks` collection:
  - `src/lib/task-sync.ts:91`

### 3) AI Layer
- Genkit prompt definitions are used as wrappers, but prompt execution is routed through direct OpenAI Responses API calls:
  - `src/ai/prompt-fallback.ts:226`
  - `src/ai/prompt-fallback.ts:279`
- Meeting/task analysis is embedded directly in API flows and ingest paths:
  - `src/lib/fathom-ingest.ts`
  - `src/app/api/meetings/[id]/rescan/route.ts:475`

### 4) Integration Layer
- Active integrations in Next API routes:
  - Slack OAuth/tokens/storage: `src/lib/slack.ts:46`, `src/app/api/slack/oauth/callback/route.ts:37`
  - Google token refresh/revoke: `src/lib/google-auth.ts:21`, `src/lib/google-auth.ts:74`
  - Fathom OAuth/webhooks/ingest: `src/lib/fathom.ts:81`, `src/app/api/fathom/webhook/route.ts:49`
- Additional Firebase Cloud Functions backend exists in `src/functions`:
  - `src/functions/index.ts:16`
  - Also duplicated `functions/package.json` in root while root `functions/` has no source files.

### 5) Task/Board Domain Flow
- Meeting/chat tasks are synced into canonical tasks, then mapped into board items/statuses:
  - `src/lib/task-sync.ts`
  - `src/lib/board-items.ts`
  - `src/lib/boards.ts`
- Hydration layer reconstructs task references from canonical tasks:
  - `src/lib/task-hydration.ts`

## Findings

### Critical
1. Unauthenticated operational/debug routes are exposed and perform write actions.
- Migration endpoint mutates all meetings/chats via GET: `src/app/api/migrate-temp-xyz/route.ts:7`, `src/app/api/migrate-temp-xyz/route.ts:49`.
- Verification endpoint creates/deletes test records via GET: `src/app/api/verify-rollover/route.ts:10`, `src/app/api/verify-rollover/route.ts:42`, `src/app/api/verify-rollover/route.ts:131`.
- Debug webhook endpoint logs request payload previews without auth: `src/app/api/fathom/webhook/debug/route.ts:7`, `src/app/api/fathom/webhook/debug/route.ts:25`.

2. Secret hygiene risk in repo conventions.
- `.env` is tracked by git in this repository, while `.gitignore` ignores `.env.local` but not `.env`: `.gitignore:26`.
- This increases leakage risk and complicates safe rotation.

### High
3. Backend surface area is split and inconsistent.
- Next.js API routes are primary path, but Firebase Cloud Functions still implement overlapping integrations and webhooks:
  - `src/functions/index.ts:16`
  - Trello UI still calls Firebase callable functions: `src/components/dashboard/common/PushToTrelloDialog.tsx:13`, `src/app/auth/trello/callback/page.tsx:7`
- TypeScript excludes both `functions` and `src/functions`, so these paths are outside main app typecheck pipeline: `tsconfig.json:41`, `tsconfig.json:42`.

4. Build safety checks are explicitly weakened.
- Root build config ignores TypeScript build errors: `next.config.ts:7`.
- A second config file also ignores ESLint during builds: `src/next.config.ts:10`.

5. Identifier model is mixed (string ids + ObjectId compatibility layer), creating ongoing complexity.
- Compatibility query helper: `src/lib/mongo-id.ts:3`, `src/lib/mongo-id.ts:7`.
- This pattern spreads across task/meeting routes and sync logic.

6. Request validation coverage is low.
- Only 3 of 66 API routes use `safeParse` validation:
  - `src/app/api/auth/register/route.ts:13`
  - `src/app/api/users/me/route.ts:98`
  - `src/app/api/ai/task-insights/route.ts:71`
- Most routes accept loosely shaped JSON with ad hoc checks.

7. Heavy, multi-collection workflows run synchronously inside request handlers.
- Example: meeting rescan runs AI analysis, sync, board updates, and cross-session updates in one request:
  - `src/app/api/meetings/[id]/rescan/route.ts:475`
  - `src/app/api/meetings/[id]/rescan/route.ts:599`
  - `src/app/api/meetings/[id]/rescan/route.ts:854`
- Similar coupling appears in task status/update endpoints.

### Medium
8. Core domain logic is duplicated across multiple routes.
- Repeated helpers (`updateLinkedChatSessions`, `cleanupChatTasksForSessions`, `syncBoardItemsToStatus`) in:
  - `src/app/api/tasks/[id]/route.ts:131`
  - `src/app/api/tasks/status/route.ts:60`
  - `src/app/api/meetings/[id]/rescan/route.ts:291`

9. Polling-based refresh patterns may not scale well.
- 60s polling appears in client contexts/data utilities:
  - `src/contexts/MeetingHistoryContext.tsx:310`
  - `src/lib/data.ts:28`
  - `src/lib/data.ts:120`

10. Documentation is stale relative to implementation.
- Blueprint still states Firebase Auth and n8n integration as core architecture:
  - `docs/blueprint.md:5`
  - `docs/blueprint.md:11`

11. Test and CI coverage is thin for backend-critical paths.
- Only one visible test file in repo: `src/ai/flows/extract-tasks.test.ts:2`.
- No repository CI workflow directory found (`.github/workflows` absent).

## Positive Architecture Signals
- OAuth state handling for Slack/Fathom is present and persisted server-side:
  - `src/lib/slack.ts:46`
  - `src/lib/fathom.ts:81`
- Fathom webhook signature verification and replay-window protection are implemented:
  - `src/app/api/fathom/webhook/route.ts:49`
  - `src/app/api/fathom/webhook/route.ts:62`
- Recording id hashing + unique index strategy exists for dedupe/idempotency:
  - `src/lib/fathom.ts:73`
  - `scripts/create-meetings-unique-index.js:21`
- Performance index script exists for main collections:
  - `scripts/create-performance-indexes.js`

## Upgrade Plan (Prioritized)

### P0: Immediate Hardening (this sprint)
1. Disable or auth-gate non-production operational routes.
- Remove or protect:
  - `src/app/api/migrate-temp-xyz/route.ts`
  - `src/app/api/verify-rollover/route.ts`
  - `src/app/api/fathom/webhook/debug/route.ts`
- If retained, require admin auth + environment flag + audit logging.

2. Enforce build correctness.
- Stop ignoring TS/ESLint build failures.
- Keep one authoritative `next.config.ts`; remove or merge `src/next.config.ts`.

3. Secrets and config hygiene.
- Move all secrets to runtime secret manager/env injection.
- Add `.env` to ignore policy, rotate exposed credentials, and avoid plaintext in repo.

4. Add a shared API validation layer.
- Standardize request schemas with Zod for all mutating routes first.
- Add shared response/error envelope and central error mapper.

### P1: Backend Service Quality Upgrades (2-4 weeks)
1. Introduce background jobs for long-running tasks.
- Move rescan/ingest/sync-heavy flows to queue workers (BullMQ/Redis or Cloud Tasks).
- Keep API endpoints thin: enqueue + return job id + status endpoint.

2. Consolidate backend surfaces.
- Decide one integration backend path:
  - Option A (recommended): Next.js API + worker service, retire Firebase callable paths.
  - Option B: Keep Firebase functions for integrations only, but isolate clearly and typecheck/deploy independently.

3. Extract domain services from route handlers.
- Centralize task/meeting sync logic into shared service modules (single source of truth).
- Route handlers should orchestrate auth/input/output only.

4. Add observability baseline.
- Structured logs with correlation ids.
- Error tracking and latency metrics per route/job.
- Track external API failures (Slack/Google/Fathom/OpenAI) as first-class events.

### P2: Data Model and Scalability (1-2 months)
1. Normalize identifier strategy.
- Pick one canonical id format for primary docs (recommended: string UUID or ObjectId consistently) and migrate.
- Remove `buildIdQuery` compatibility layer after migration completion.

2. Event-driven state propagation.
- Use domain events for "task status changed", "meeting ingested", "board item updated" to reduce cross-route coupling.

3. Real-time update channel.
- Replace periodic client polling with SSE/WebSocket for meeting/task updates where needed.

4. CI and quality gates.
- Add CI workflow for lint/typecheck/tests + route smoke checks.
- Expand tests around:
  - auth/authorization boundaries
  - webhook verification and idempotency
  - task/meeting/board consistency invariants

## Recommended Target Shape (Pragmatic)
- Keep Next.js for UI + authenticated API facade.
- Introduce worker process/service for async jobs (ingest, rescan, heavy sync).
- Keep MongoDB as system of record, but enforce strict schema and id conventions.
- Consolidate integrations into one backend path (prefer non-Firebase for reduced cognitive load unless Firebase is a strategic platform requirement).

## Suggested Implementation Sequence
1. P0 hardening and build gates.
2. Queue + worker introduction for rescan/ingest.
3. Route-to-service refactor and duplicate logic removal.
4. ID normalization migration.
5. CI + expanded tests + observability completion.

## Implementation Checklist (Live)
- [x] P0.1 Disable/auth-gate non-production operational routes (`src/app/api/migrate-temp-xyz/route.ts`, `src/app/api/verify-rollover/route.ts`, `src/app/api/fathom/webhook/debug/route.ts`) using env gate + authenticated user check (+ optional allowlist). (Completed: 2026-02-12)
- [x] P0.2 Enforce build correctness by removing TS/ESLint ignore build settings and consolidating to one authoritative `next.config.ts`. (Completed: 2026-02-12)
- [x] P0.3 Apply secrets/config hygiene updates (`.env` ignore policy + credential rotation process). (Completed: 2026-02-12; see `docs/secrets-rotation-runbook.md`)
- [x] P0.4a Add shared API validation foundation (shared Zod body parser + central error mapper + standardized API envelope utilities). (Completed: 2026-02-12; `src/lib/api-route.ts`)
- [x] P0.4b Roll shared validation/envelope layer across remaining mutating routes. (Completed: 2026-02-12; mutating routes migrated to shared API error envelope/validation utilities, `52/52` mutating routes now reference `@/lib/api-route`)
- [x] P1.1 Introduce background jobs for long-running ingest/rescan/sync flows. (Completed: 2026-02-12; added Mongo-backed job queue + worker runtime + status endpoint + async job-backed `meetings/[id]/rescan`, `fathom/sync`, and `slack/users/sync`)
- [x] P1.2 Consolidate backend surfaces (choose Next.js API + worker or isolate Firebase path cleanly). (Completed: 2026-02-12; removed legacy Firebase function code paths/folders and migrated remaining Trello client calls to Next API routes)
- [x] P1.3 Extract duplicated domain logic into shared services. (Completed: 2026-02-12; introduced shared session-task sync + board-status sync services and refactored task/meeting routes + meeting-rescan job to use them)
- [x] P1.4 Add observability baseline (structured logs, correlation ids, latency/error metrics). (Completed: 2026-02-12; added correlation-id propagation + structured JSON logs, persisted route/job latency+error metrics for queue-backed API/job flows, and external API failure event tracking across Slack/Google/Fathom/OpenAI integration paths.)
- [x] P2.1 Normalize identifier strategy and retire compatibility query layer. (Completed: 2026-02-13)
  - Started strict string-id query migration in shared data services and task migration flow:
    - `src/lib/workspace.ts`
    - `src/lib/task-sync.ts`
    - `src/lib/task-hydration.ts`
    - `src/lib/people-sync.ts`
    - `src/lib/boards.ts`
    - `src/lib/board-items.ts`
    - `src/lib/fathom-ingest.ts`
    - `src/lib/fathom-logs.ts`
    - `src/lib/services/session-task-sync.ts`
    - `src/lib/services/board-status-sync.ts`
    - `src/lib/jobs/handlers/fathom-sync-job.ts`
    - `src/lib/jobs/handlers/meeting-rescan-job.ts`
    - `src/lib/task-completion.ts`
    - `src/app/api/tasks/migrate/route.ts`
  - Added legacy reference-field normalizer script: `scripts/normalize-legacy-identifiers.js` (`npm run ids:normalize` for dry run, `npm run ids:normalize -- --apply` to execute).
  - Validation run (2026-02-12): `npm run ids:normalize` (dry run) completed successfully and reported no legacy ObjectId reference fields in the current configured database.
  - Progress update (2026-02-13): completed `buildIdQuery` removal from `meeting-rescan-job` and `task-completion`.
  - Completion update (2026-02-13): migrated remaining API route usage of `buildIdQuery` / `matchesId` and removed `src/lib/mongo-id.ts`.
- [x] P2.2 Move to event-driven state propagation for cross-domain updates. (Completed: 2026-02-13)
  - Added a shared domain event module with persisted event envelopes + synchronous dispatch handlers: `src/lib/domain-events.ts`.
  - Wired core cross-domain events:
    - `task.status.changed` published from task status update routes (`src/app/api/tasks/status/route.ts`, `src/app/api/tasks/[id]/route.ts`) and handled via board-status synchronization.
    - `meeting.ingested` published from meeting create flow (`src/app/api/meetings/route.ts`) and handled for people upsert + canonical task sync + default board item provisioning.
    - `board.item.updated` published from board item patch flow (`src/app/api/workspaces/[workspaceId]/boards/[boardId]/items/[itemId]/route.ts`) and handled to propagate board-driven edits/status into canonical tasks.
- [x] P2.3 Replace polling with real-time update channel where needed. (Completed: 2026-02-13)
  - Added authenticated SSE stream endpoint backed by persisted domain events: `src/app/api/realtime/stream/route.ts`.
  - Added shared realtime topic mapping/parser + client subscription helper:
    - `src/lib/realtime-events.ts`
    - `src/lib/realtime-client.ts`
  - Replaced 60s polling in client data paths with SSE-triggered refresh:
    - `src/contexts/MeetingHistoryContext.tsx`
    - `src/lib/data.ts` (`onPeopleSnapshot`, `onTasksForPersonSnapshot`)
  - Wired board view subscription for board/task event-driven refresh:
    - `src/components/dashboard/board/BoardPageContent.tsx`
  - Extended board item update event payload for targeted board/workspace refresh filtering:
    - `src/lib/domain-events.ts`
    - `src/app/api/workspaces/[workspaceId]/boards/[boardId]/items/[itemId]/route.ts`
  - Added SSE topic mapping tests: `src/lib/realtime-events.test.ts` (`npm run test -- src/lib/realtime-events.test.ts`).
- [x] P2.4 Add CI quality gates and expand backend-critical automated tests. (Completed: 2026-02-13)
  - Added CI workflow with enforced quality gates (`lint`, `typecheck`, full Jest suite, dedicated route smoke checks):
    - `.github/workflows/ci.yml`
    - `package.json` (`test:routes:smoke`)
  - Added auth/authorization boundary tests:
    - `src/lib/operational-route-guard.test.ts`
  - Added webhook verification + idempotent duplicate ingest behavior tests:
    - `src/app/api/fathom/webhook/route.test.ts`
  - Added task/meeting/board consistency invariant tests for domain event dispatch:
    - `src/lib/domain-events.test.ts`
  - Added API route smoke checks for core handlers:
    - `src/app/api/routes-smoke.test.ts`
