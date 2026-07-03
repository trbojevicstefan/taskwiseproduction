# Taskwise simplification + AI upgrade — session handoff

**Branch:** `feat/taskwise-simplification-ai-upgrade` (cut from `staging` with `--no-track`; push with `git push -u origin feat/taskwise-simplification-ai-upgrade`).
**Spec:** `taskwise.md` (repo root). **Implementation map:** `docs/superpowers/plans/2026-07-02-simplification-ai-upgrade-plan.md` — read that first; it condenses a 9-subsystem audit (key files, choke points, hazards, do-not-touch list).
**Last updated:** 2026-07-03.

## Phase status

Phases were executed in dependency order, not spec order. One commit per phase; every commit was gated on fresh `npm run typecheck` + `npm run lint` (0 errors) + `npm test -- --runInBand` (all suites green), with `next build` verified at milestones.

| Phase | Spec section | Status | Commit |
|---|---|---|---|
| 0 | Audit + implementation map | ✅ done | `c133194` |
| 1 | UI simplification (nav, theme, headers) | ✅ done | `a782720` |
| 6 | People vs Clients | ✅ done | `52dcd61` |
| 2 | General AI Chat | ✅ done | `69c807e` |
| 3 | Task cleanup / vanity filter | ✅ done | `b82b0bc` |
| 9 | Task prioritization | ✅ done | `36171c2` |
| 4 | Calendar (replaces Explore) | ✅ done | `afe58c3` |
| 5 | Planning workspace | ✅ done | `11ae150` |
| 10 | Slack scheduled reminders | ✅ done | see `git log` (`feat: Phase 10`) |
| 7 | Fireflies + Grain providers | ✅ done | see `git log` (`feat: Phase 7`) |
| 8 | MCP expansion + client configs | ⬜ pending | — |

## What each done phase delivered

- **Phase 1** — Simple-nav sidebar is now Meetings / Calendar (`/explore`) / Review Tasks / Board / Planning / People / Clients / Chat / Settings (visible to all members). Sidebar collapse persists via the `sidebar_state` cookie. Landing page no longer calls `setTheme('dark')` (scoped `.dark` wrapper instead — it used to permanently hijack the logged-in theme). Fixed invalid `hsla(var(--x), a)` CSS (7 spots) and dead links/buttons. `DashboardHeader` gained a `description` prop (every page states its purpose). Shared `EmptyState` in `src/components/common/`. Dark/light contrast QA pass over dashboard components.
- **Phase 6** — `personType` (`teammate|client|unknown`) + `personTypeSource` (`manual|auto`, manual never overwritten) + `company` + `nextFollowUpAt` on people. Heuristics in `src/lib/person-classification.ts` (Slack-synced → teammate; internal domain → teammate; external non-free domain → client). Hooks in meeting-ingestion people upserts and the Slack sync job. `GET /api/people?type=`, hardened zod PATCH (was raw `$set` passthrough), `POST /api/people/reclassify`. New `/clients` page grouped by company with open/overdue counts and last-contacted.
- **Phase 2** — `src/lib/workspace-retrieval.ts`: keyword retrieval + ranking (title×3/summary×2/attendee×2, recency boost, transcript snippet extraction, overdue + priority intents). `POST /api/ai/chat` (authed, workspace-scoped): returns `{answer, confidence, sources[], suggestedActions[]}`; empty retrieval short-circuits to a deterministic no-evidence answer with **no LLM call**; LLM-returned sources are filtered against retrieved ids (anti-hallucination). Flow `src/ai/flows/general-chat-flow.ts` (gpt-4o-mini via `runPromptWithFallback`, never throws). UI: `GeneralChatPanel` mounted in Chat when no meeting session is active.
- **Phase 3** — Reversible cleanup model on tasks (`cleanupStatus/Category/Reason/Confidence/Evidence`, `expiresAt`, `duplicateOfTaskId`, `cleanupReviewedAt/By`) threaded through all five field choke points and deliberately **excluded from `buildTaskRecords`** so meeting re-sync can't clobber review decisions. Heuristics-before-LLM classifier (`src/lib/task-cleanup-heuristics.ts`) with protected classes (client commitments, legal/finance/compliance keywords, deliverable verbs, owned future-dated tasks are never flagged). Task Quality Auditor flow (evidence required for completed suggestions). `runTaskCleanupScan` with strictness gates + category toggles + auto-expiry. Routes: `POST /api/tasks/cleanup/scan`, `GET …/suggestions`, `POST …/actions` (bulk expire/duplicate/complete/dismiss/restore; completion publishes `task.status.changed`). Board items GET hides expired (`includeExpired=1` opt-out). UI: `/review/cleanup` view, Task Cleanup settings card (Settings → Preferences, persisted via `users/me` → workspace `settings.taskCleanup`), badges on board cards and review rows.
- **Phase 9** — `src/lib/task-priority.ts`: deterministic 0–100 score with a documented weight table (due-date urgency, explicit priority, client impact, blocker signals, recency, workload relief), labels `low|medium|high|urgent`, top-3-factor `priorityReason`. Fields threaded through the same choke points. `POST /api/tasks/priority/recompute` (bulk, only-changed writes); inline recompute in `PATCH /api/tasks/[id]` when due/priority/assignee/status change. Board badges support `urgent` with reason tooltip; retrieval answers "what should I do first?". No LLM (reasons are deterministic).
- **Phase 5** — `GET /api/planning/overview`: open tasks bucketed into exactly one of Today / This week / Blocked / Waiting on client / Needs owner / Needs due date (precedence-ordered; `planningFlags` carry all applicable flags for chips), sorted by `priorityScore`, capped 50/section with uncapped counts. `/planning` renders the new `PlanningWorkspacePageContent` (6-section grid, quick controls: assign / set due date / mark done / open; recompute-priorities button); the Google Meeting Planner moved unchanged to `/planning/agendas` with cross-links. AI planning assistant = `GeneralChatPanel` (new optional `heroTitle`/`suggestedPrompts`/`compact` props) posting to the existing `/api/ai/chat`. Orphaned `PlanningPageContent` (dead planning-sessions editor) deleted; `PlanningHistoryContext` untouched (Chat/paste still use it). `BLOCKER_SIGNAL_REGEX` exported from `task-priority.ts` (shared, no behavior change).
- **Phase 10** — New `taskReminders` collection (string UUID `_id`s; statuses `scheduled|sent|failed|canceled`; `dedupKey = taskId+':'+kind+':'+dueAtISO` with a unique partial `(workspaceId, dedupKey)` index so re-sweeps can't double-enroll). `src/lib/task-reminders.ts`: `runReminderSweep` (enrolls before-due/on-due/overdue instants per workspace settings, timezone + quiet-hours aware, cancels stale reminders whose task/dueAt vanished, optional daily digest), `sendTaskReminder` (`sent|skipped|failed`; re-checks task status and dueAt drift at send time), `cancelRemindersForTask`, `enqueueReminderSweepJob` (duplicate-pending guarded). Two new job types `slack-reminder-send` / `slack-reminder-sweep` (sweep self-re-enqueues at +6h while enabled) — **trigger story: the existing Mongo job queue + `kickJobWorker` on request traffic, NOT Slack `chat.scheduleMessage`** (decision documented in the lib header). Cancel-on-complete lives inside the existing `task.status.changed` handler (one best-effort `updateMany` when status is `done`); `PATCH /api/tasks/[id]` cancels + re-sweeps only on a *real* dueAt change (Date-vs-ISO normalized). Routes: `GET /api/slack/reminders?taskId=&status=`, `POST /api/slack/reminders/sweep`. Settings: `settings.slackReminders` resolved by `resolveSlackReminderSettings` (defaults disabled), persisted via `users/me` PATCH mirroring the taskCleanup block, edited in a new `SlackRemindersSettingsCard` (Settings → Preferences, admin-gated). UI: read-only reminders card in `TaskDetailDialog`; `GET /api/calendar` gained an additive `reminders` array rendered as Bell chips in Agenda/Week views.
- **Phase 7** — Provider abstraction in `src/lib/meeting-providers/`: `types.ts` pins `MeetingProviderAdapter` (verifyWebhookRequest / parseWebhookPayload / fetchMeeting / listMeetings / validateCredentials) + `NormalizedProviderMeeting`; `ingest-pipeline.ts` exposes `ingestProviderMeeting` (dedup → meeting upsert → same `meeting.ingested` domain events Fathom publishes, so extraction/Calendar/Chat/Review ride existing rails — the task-extraction pipeline is NOT forked). Fathom was strangler-refactored, not rewritten: only `fathom-ingest.ts` (inline upsert → shared `upsertMeetingIdempotently`) and `meeting-builder.ts` (optional `ingestSource`/`defaultTitle` params) changed; all fathom-* tests pass unmodified; the legacy `/api/fathom/webhook` route is untouched and the generic route 404s `fathom`. Fireflies (GraphQL, HMAC `x-hub-signature` webhooks → `kind:'ref'` fetch-on-event) and Grain (REST PAT, recordings list/get, VTT/JSON transcript parsing, hook-secret header) adapters own only their files. New `meetingConnections` collection (`src/lib/meeting-connections.ts`, unique `(workspaceId, provider)`, per-connection `webhookToken` routing key; `fathomConnections` untouched). Routes: `POST /api/webhooks/[provider]?token=`, `POST|GET|DELETE /api/integrations/[provider]`, `POST /api/integrations/[provider]/sync`. Job types `meeting-provider-webhook-ingest` + `meeting-provider-sync`. UI: `MeetingProviderIntegrationCard` (both providers) mounted after the Fathom card in Settings → Integrations (9-line surgical mount). `ingestSource` union += `'fireflies' | 'grain'`.
- **Phase 4** — `GET /api/calendar?from&to` (≤62-day span): meetings by `startTime`, open tasks by `dueAt` (schemaless string/Date coercion in JS), `isClientMeeting` via client-person emails/name-keys, workspace-wide `warnings` counts. New `src/components/dashboard/calendar/` tree: Month grid / Week columns / Agenda with warnings strip; Google events overlay via new `?allEvents=1` opt-in on `/api/google/calendar/upcoming` (default hangoutLink-only contract untouched — Meeting Planner depends on it). Old `ExplorePageContent` + orphaned subcomponents deleted; `SelectionViewDialog` kept (Chat/Meetings use it).

## Verification state (last full run)

- `npm run typecheck` — clean
- `npm run lint` — 0 errors, 53 warnings (baseline was 66; dead-code deletion reduced it)
- `npm test -- --runInBand` — 126 suites / 693 tests, all passing (baseline was 86/272)
- `MONGODB_URI=mongodb://127.0.0.1:27099/x npm run build` — succeeds (build needs the var **set**, not a live Mongo)

Not verified (no env/services in this session): live OpenAI calls, live Slack/Google/Fathom APIs, a real Mongo. All AI/integration code paths are unit-tested with the repo's mock-everything jest convention.

## Key decisions and deviations

- **Phase order** was re-sequenced for dependencies: 1 → 6 → 2 → 3 → 9 → 4 → 5 → 10 → 7 → 8 (clients feed chat/calendar/planning/priority; MCP last so it exposes everything).
- Phase 2 chat went through a **new authed API route**, not the existing client-callable server actions (those have no auth inside — see plan doc hazards).
- Phase 9 uses **no LLM**: the transparent weight table makes reasons deterministic; spec allowed AI only "where deterministic scoring is not enough".
- Phase 5 reuses `POST /api/ai/chat` for the planning assistant instead of a new flow, and moves the existing Google Meeting Planner to `/planning/agendas`.
- Phase 10 uses the app's own job queue for reminder timing (auditable statuses, quiet hours, cancel-on-complete) instead of Slack `chat.scheduleMessage` (fire-and-forget, hard to cancel/audit). Reminder delivery depends on the job worker (`npm run jobs:worker`) or request-traffic `kickJobWorker`; the sweep self-perpetuates every 6h while enabled.
- `package-lock.json` churn from a local `npm install` was deliberately reverted; the committed lockfile is untouched.
- New indexes were added to `scripts/create-performance-indexes.js` (tasks `dueAt`, meetings `startTime`, four `taskReminders` indexes incl. the unique dedup index, and `meetingConnections` indexes) — **run `npm run db:indexes:perf` against production Mongo when deploying**. The lib also self-ensures `taskReminders` indexes at runtime via `ensureTaskReminderIndexes`.

## Hazards for whoever continues

- The five task-field choke points (`TASK_LIST_PROJECTION`, `normalizeTask`, `src/types/project.ts`, `ExtractedTaskSchema`, task-hydration) must all be updated for any new task field; keep review-owned fields **out** of `buildTaskRecords` `$set`.
- Don't move `getSessionUserId` (`src/lib/server-auth`) or the workspace-scope export paths — ~35 route tests mock those module paths.
- `PATCH /api/tasks/[id]` is still an unvalidated creator-scoped passthrough (pre-existing; only priority recompute was added). Hardening it is worthwhile but touches many callers.
- CI (`.github/workflows/ci.yml`) has never been green: the build step lacks `MONGODB_URI` and triggers only cover main/master. Not fixed in this session (out of scope of taskwise.md, but one small PR away).
- Phase 7 residual risks (documented, deliberate scope cuts): (1) cross-note-taker fingerprint dedupe still pins `ingestSource:'fathom'` — a Fathom bot and a Fireflies/Grain bot in the same call produce two meeting docs; (2) both adapters carry `VERIFY-ON-FIRST-LIVE-RUN` header comments — external API shapes (Fireflies duration units / signature scheme, Grain hook header name / event types) are fetch-mocked, never validated live; (3) provider action items persist as `providerActionItems` on the meeting doc but are not mapped to tasks (matches Fathom — tasks come from LLM extraction only); (4) webhook connections without a stored `webhookSecret` accept unverified payloads (fathom precedent, surfaced in settings UI copy).
- Remaining phase: 8 should generate `/docs/mcp` from a tool registry to stop doc drift.

## How to continue

1. Read `docs/superpowers/plans/2026-07-02-simplification-ai-upgrade-plan.md` (per-phase file lists + hazards).
2. Check `git log --oneline staging..HEAD` for what landed.
3. Run the four gates above before and after changes.
4. Remaining work per spec: Phase 10 (`<phase_10_slack_reminders>`), Phase 7 (`<phase_7_more_note_takers>`), Phase 8 (`<phase_8_mcp_and_agent_plugins>`).
