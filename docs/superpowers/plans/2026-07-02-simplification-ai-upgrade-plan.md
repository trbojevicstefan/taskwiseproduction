# Taskwise simplification + AI upgrade — implementation map (Phase 0 output)

Date: 2026-07-02. Source spec: `taskwise.md` (repo root). Branch: `feat/taskwise-simplification-ai-upgrade` (off `staging`).
Baseline verified: typecheck clean, lint 0 errors / 66 warnings, 86/86 jest suites (272 tests) pass, `next build` succeeds with any `MONGODB_URI` set (dead-port dummy OK).

## Repo understanding

- Next.js App Router (React 18.3, TS strict), NextAuth v4 JWT (`src/lib/auth.ts` = authOptions only; `getSessionUserId` lives in **`src/lib/server-auth.ts`**), MongoDB with string UUIDs (`src/lib/db.ts`, `src/lib/mongodb.ts` — test env never connects), Tailwind + shadcn/Radix (`src/components/ui`), Mongo-backed job queue (`src/lib/jobs`, delayed `runAt` supported, worker = `npm run jobs:worker` + per-request `kickJobWorker`).
- AI: Genkit is used ONLY for prompt templating/schemas; every model call goes through `runPromptWithFallback()` in `src/ai/prompt-fallback.ts` (OpenAI Responses API, default `OPENAI_MODEL || OPENAI_FALLBACK_MODEL || 'gpt-4o-mini'`). Flows in `src/ai/flows/*`, lenient JSON recovery via `extractJsonValue`.
- Page pattern: `src/app/<route>/page.tsx` (thin server component) → `DashboardPageLayout` → `'use client'` `*PageContent` in `src/components/dashboard/<area>/`. New top-level dashboard routes MUST be added to `dashboardPrefixes` in `src/components/common/Providers.tsx` or context hooks crash.
- Task lifecycle: extraction embeds tasks in `meeting.extractedTasks` → domain event → `syncTasksForSource` writes canonical `tasks` docs with `taskState='suggested'` → confirm-tasks route flips to active/confirmed + creates `boardItems`. Dual source of truth (embedded trees vs `tasks` collection) reconciled by `task-sync`/`task-hydration`.
- New task fields must be added at ALL choke points: `TASK_LIST_PROJECTION` (`src/lib/task-projections.ts`), `normalizeTask` (`src/lib/data.ts`), types (`src/types/project.ts`, `src/types/chat.ts` ExtractedTaskSchema), `hydrateTaskReferenceLists` projection — and kept OUT of `buildTaskRecords` `$set` in `src/lib/task-sync.ts` if meeting re-sync must not clobber them.
- Auth/scoping: `assertWorkspaceAccess` (defined `src/lib/workspace-authz.ts`, consumed/mocked via `src/lib/workspace-context.ts`), `requireWorkspaceRouteAccess` (`src/lib/workspace-route-access.ts`) for workspace routes, `resolveWorkspaceScopeForUser` for user-scoped lists. Mutating routes use `src/lib/api-route.ts` helpers.
- Tests: mock-everything convention (`jest.mock('@/lib/db')` etc.), route handlers imported directly and called with `new Request(...)`. Never move `getSessionUserId`/`assertWorkspaceAccess` export paths — ~35 tests mock those module paths.

## Existing features (build on, don't rebuild)

- **Chat**: single-meeting chat via `extractTasksFromChat` server action; `answerFromTranscript` already returns `{answerText, sources:[{timestamp,snippet}]}`. No cross-meeting retrieval; no server-side authed chat endpoint.
- **Completed-task auditor**: `buildCompletionSuggestions` (`src/lib/task-completion-detection.ts`, embeddings + jaccard prefilter) + `detectCompletedTasks` flow — Phase 3 extends this.
- **Task Sweep** (`TaskSweepDialog` + heuristics in `BoardPageContent`): client-side cleanup precursor with keep/discard/snooze/complete — vocabulary to reuse in Phase 3.
- **Explore page**: already titled "Calendar", week view only, meetings by day + Google Calendar overlay + full bulk-action toolbar. Month/agenda views and task-by-dueAt are new builds.
- **Meeting Planner** at `/planning` (Google Calendar agenda tool). `PlanningPageContent` (planning-sessions editor) is ORPHANED dead code, but `PlanningHistoryContext.createNewPlanningSession` is used by Chat/paste — don't delete the context.
- **People**: CRUD, merge, Slack sync (`people.slackId`), heuristic task matching (uid → email → nameKey, duplicated in ~5 places). No type/classification, no clients, no commitments.
- **Fathom**: full OAuth/webhook/sync pipeline; ~25 fathom-* files where `ingestFathomMeeting` (530 lines) mixes provider parsing with shared pipeline. Extensive tests to use as behavior specs when extracting the Phase 7 provider abstraction.
- **Slack**: OAuth + token rotation + `chat.postMessage` send paths + Block Kit formatter + `slack-users-sync` job. NO reminder/scheduling code; `webhookDeliveries` + `workflow-webhook-delivery-send` job is the template for audited scheduled sends.
- **MCP**: hand-rolled JSON-RPC at `/api/workspaces/{id}/mcp`, 11 tools (6 read / 5 write), workspace-scoped hashed keys with `mcp:read`/`mcp:write`, per-key rate limits, write audit logs (TTL 90d), `/docs/mcp` static docs. Resources/prompts are greenfield.
- **Jobs**: 6 types with exhaustive never-checks in `src/lib/jobs/processor.ts` — new types must extend `JOB_TYPES`, payload typings, and the switch.

## Phase order (dependency-driven, deviates from spec numbering)

1. **Phase 1** UI simplification (foundation)
2. **Phase 6** People vs Clients (data model consumed by chat/calendar/planning/priority)
3. **Phase 2** General AI Chat (retrieval cites people/clients)
4. **Phase 3** Task cleanup / vanity filter
5. **Phase 9** Prioritization (uses client impact; feeds calendar/planning)
6. **Phase 4** Calendar (renders cleanup warnings, priorities, client meetings)
7. **Phase 5** Planning workspace
8. **Phase 10** Slack reminders (then wired into Calendar + task detail)
9. **Phase 7** Fireflies + Grain providers
10. **Phase 8** MCP expansion (exposes everything built above)

## Files most likely to change per phase

- **P1**: `SidebarNav.tsx`, `DashboardPageLayout.tsx` (read sidebar_state cookie), `DashboardHeader.tsx` (+description slot), new `EmptyState` component, `HeaderNav.tsx` (dead "Copy Selected" item), `globals.css` (broken `hsla(var(--x), a)` syntax), `src/app/page.tsx` (remove `setTheme('dark')` hijack, dead Watch-demo/contact links), `LegalPageLayout.tsx` (fake `prose` classes), page metadata/titles, `*PageContent` header purposes.
- **P6**: `src/types/people.ts`-ish person type + `personType: teammate|client|unknown` + `classificationSource: manual|auto`, domain heuristics helper, `people-sync.ts` hook, new `/clients` page + API, SidebarNav entry, harden `PATCH /api/people/[id]` with zod.
- **P2**: new `src/lib/retrieval/` (keyword/title/summary/attendee ranking + recency boost), new authed `POST /api/ai/chat` route (workspace-scoped — NOT a server action), new `general-chat-flow.ts` using `runPromptWithFallback`, Chat UI "Ask anything" mode with suggested prompts + source chips, tests (401/scoping/sources/empty-context).
- **P3**: cleanup fields at all task choke points, `task-cleanup-flow.ts` extending detect-completed-tasks patterns, workspace cleanup settings, Cleanup Suggestions view (model on ReviewTasks + TaskSweep vocabulary), badges in `BoardTaskCard` + `TaskRow`, bulk endpoint (NOT N sequential DELETEs), hide-expired filter in board items GET.
- **P9**: `src/lib/task-priority.ts` deterministic scorer + fields at choke points, recompute on ingest/PATCH, badge maps (add `urgent`), planning sort, calendar highlight.
- **P4**: new calendar component tree (month/week/agenda) reusing SessionCard/CalendarEventCard/TaskDetailDialog; server date-range queries (`/api/meetings`?from/to, tasks by dueAt + index); keep `hangoutLink` filter behavior for Meeting Planner via opt-in param.
- **P5**: replace `/planning` content with planning workspace (Today/This week/Blocked/Waiting on client/Needs owner/Needs due date); `blocked`/`waiting_on_client` as task flags NOT status-enum widening; AI planning assistant endpoint following `/api/ai/task-insights` pattern.
- **P10**: `reminders` collection (statuses scheduled/sent/failed/canceled, dedup key taskId+kind+dueDate), `slack-reminder-send` + sweep job types, workspace reminder settings, cancel-on-complete via `task.status.changed` handler (cheap flip), task detail + settings UI, Calendar panel.
- **P7**: `src/lib/meeting-providers/` interface {listMeetings, fetchTranscript, parseWebhookPayload, verifyWebhookRequest, registerWebhook, oauth, normalizeTranscript}; extract shared pipeline from `ingestFathomMeeting` keeping fathom tests green; `meetingConnections` generalization (fathomConnections has `provider` field already); `/api/webhooks/[provider]` route; Fireflies (GraphQL API key) + Grain (PAT/OAuth) adapters; extend `ingestSource` union + job types.
- **P8**: central MCP tool registry (definition+zod+scope+handler), add tools/resources/prompts from spec, fix unreachable `attendees.*` aliases, audit logging for non-task writes, generate `/docs/mcp` content from registry, client config docs.

## Do NOT touch (or touch surgically)

- `src/components/ui/sidebar.tsx` (788-line stock shadcn primitive), `src/lib/mongodb.ts` NODE_ENV branches, module paths of `server-auth`/`workspace-context`/`workspace-route-access` exports, completion-detection thresholds/weights (benchmarked: precision 0.85 / recall 0.8 gates), `hashFathomRecordingId` scope strings + recordingIdHash semantics, legacy `fathomInstallations` dual-write, Trello 503 shells, dead flows (merge-tasks, summarize-chat-session, generate-mind-map, getSlackChannelsFlow placeholder), `docs/core-first-*` validation evidence.
- Monoliths to extend via NEW components, not inline edits: `BoardPageContent.tsx` (3220 lines), `MeetingsPageContent.tsx` (3906), `SettingsPageContent.tsx` (5282), `ChatPageContent.tsx` (2899).

## Known hazards (from audit)

- `PATCH /api/tasks/[id]` and `PATCH /api/people/[id]` are unvalidated `$set` passthroughs; tasks PATCH is creator-scoped while board routes are workspace-scoped — cleanup/priority mutations need a validated, workspace-scoped path.
- `syncTasksForSource` deletes canonical tasks missing from incoming embedded lists and `$set`s every field in `buildTaskRecords` — decide per-field survival for cleanup/priority fields and test the rescan path.
- `TASK_LIST_PROJECTION` omission silently drops fields (already bites `taskSweep`).
- 'use server' AI flows are client-callable with no auth inside; `extractTasksFromChat` reads previous meetings without a userId filter — Phase 2 must go through an authed route and not widen this hole.
- MCP: `WORKSPACE_MEMBERSHIP_GUARD_ENABLED` default OFF makes key-management routes effectively cross-tenant; empty-scope legacy keys get full access — don't increase blast radius silently.
- Fathom webhook signature verification passes when no secret stored — treat tightening as a behavior change.
- Reminder timing depends on a running worker; no cron exists. Phase 10 must state the trigger story.
- Landing page `setTheme('dark')` persists to localStorage and hijacks the logged-in app theme.
- CI (`.github/workflows/ci.yml`) has never been green and lacks `MONGODB_URI` for the build step; triggers only cover main/master.

## Verification per phase

`npm run typecheck` + `npm run lint` + `npm test -- --runInBand` after every phase; `MONGODB_URI=mongodb://127.0.0.1:27099/x npm run build` at milestones. Full audit details live in the session scratchpad (`audit/*.json`) and this plan is the durable summary.
