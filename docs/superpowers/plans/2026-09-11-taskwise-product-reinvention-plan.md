# Taskwise Product Reinvention Plan — Meeting Memory to Action OS

Date: 2026-09-11
Branch: `feat/taskwise-product-reinvention-sep2026`
Owner: Taskwise product engineering

## Goal

Turn Taskwise from a collection of meeting/task features into one coherent meeting-memory operating system: capture a meeting, understand what happened, turn it into reviewed work, keep people/client context current, prepare the next meeting, and share/automate the output without hunting through the app.

The pass must improve usefulness and discoverability at the same time. Product work, documentation, SEO, onboarding, integration coverage, and activation instrumentation are one release program rather than independent projects.

## Product thesis

Taskwise should own the transition from **conversation -> memory -> decision -> commitment -> execution -> follow-up**.

The strongest pattern across mature AI notetakers is not “better transcription.” It is continuity: meeting context remains useful after the call. Taskwise already has the correct backend rails (meeting ingestion, transcript search, canonical tasks, people/companies, scoped chat, workflows, MCP, calendar, board). This pass should make those rails feel like one product.

## Approaches considered

### A. Full visual rewrite

Replace the authenticated product shell and rebuild all screens around a new design system.

Trade-off: highest visual novelty, highest regression risk, duplicates already-working flows, and conflicts with the repository rule to preserve proven backend behavior.

### B. Add another AI/notetaker layer on top

Build a new “AI Notes” surface while leaving Board, Planning, People, Workflows, and MCP mostly untouched.

Trade-off: faster demo, but creates another silo and makes Taskwise feel even more fragmented.

### C. Converge around meeting memory and actions — chosen

Keep the proven backend/domain rails, but redesign information architecture, interaction patterns, and cross-links so every surface starts from shared meeting/task/people context. Promote existing hidden capabilities (Task Sweep, workflow automation, MCP) instead of rebuilding them.

Why chosen: maximum user-visible gain per regression risk, reuses the August unified-chat/RAG work, and creates one defensible product story.

## Confirmed current-state findings

- [x] Unified scoped chat already supports durable sessions, meeting/workspace scope, grounded sources, MCP-backed read/tool loops, and deterministic task actions.
- [x] Hybrid transcript retrieval and meeting search already exist; do not build a second RAG path.
- [x] Board already has filters, URL-persisted view state, bulk actions, exports, Trello/Google Tasks/Slack actions, priority scoring, and a Task Sweep flow.
- [x] Task Sweep already ranks stale/vague/overdue/inactive work and supports keep/discard/snooze/complete; its interaction model is the gap.
- [x] People/client/company foundations already exist, including person classification, companies, profiles, reports, merge logic, and task/meeting relationships.
- [x] Calendar already has Taskwise meetings, Google events, task due dates, event details/create-link flows, and reminder overlays.
- [x] Workflow backend is substantial (filters, transform, preview, webhook delivery, replay, guardrails), but the UI is buried in Settings -> Advanced and is opened through the Fathom settings path.
- [x] MCP registry/tools/resources/prompts exist and should be documented and surfaced as a product capability, not rewritten.
- [x] Fathom is the primary integration. Fireflies and Grain already use the generic meeting-provider adapter framework.
- [x] The generic provider framework can support three more API-key based note takers without forking extraction: tl;dv, Otter.ai, and MeetGeek.

## Product principles for this release

- [ ] One source of truth per concept. One chat, one task model, one person identity, one meeting record.
- [ ] Every AI answer shows where it came from and provides the next useful action.
- [ ] Every dense surface has a “what should I do here?” explanation without permanently consuming space.
- [ ] Tooltips explain unfamiliar controls; empty states explain the next action; destructive actions explain consequences.
- [ ] Fathom remains first in integration hierarchy and gets the best setup/health UX.
- [ ] Advanced capabilities remain safe, but no longer invisible.
- [ ] Mobile is not a shrunk desktop board. High-frequency mobile actions become swipe/review flows.
- [ ] Marketing claims must map to a real product path and a public docs page.

# Development checkpoints

## CP0 — Baseline, safety, release map

- [x] Audit current architecture and recent commits before coding.
- [x] Create isolated branch `feat/taskwise-product-reinvention-sep2026` from `main`.
- [ ] Capture baseline CI status for typecheck, lint, Jest, build, and route smoke tests.
- [ ] Add this plan to the repository and update checkboxes as work lands.
- [ ] Keep integration code on the shared `meeting-providers` ingestion rail.

Acceptance: no production behavior changed before a repository-aware plan exists.

## CP1 — Information architecture and discoverability

Target: core navigation should read like a workflow rather than a feature inventory.

- [ ] Keep **Meetings**, **Tasks**, **Board**, **Calendar**, **People**, **Clients**, **Chat** as first-class work areas.
- [ ] Rename/reframe “Review Tasks” so users understand it is the inbox for AI-extracted commitments.
- [ ] Promote **Automations** to a visible navigation destination for users allowed to manage integrations.
- [ ] Keep Settings focused on configuration rather than hiding product workflows.
- [ ] Add contextual “?” help/tooltips to nav and non-obvious toolbar actions.
- [ ] Add compact command-style shortcuts from Meetings -> Ask, Share, Review tasks, Plan next meeting.
- [ ] Preserve collapsed-sidebar tooltips and keyboard accessibility.

Primary files:
- `src/components/dashboard/SidebarNav.tsx`
- `src/components/dashboard/SidebarNav.test.tsx`
- new `src/app/automations/page.tsx`
- new `src/components/dashboard/automations/*`

Acceptance:
- users can reach Automations in one click from the main product shell;
- labels explain outcome, not internal implementation;
- no duplicate chat/task routes are introduced.

## CP2 — Workflow Builder becomes a product surface

Target: turn a technically capable but hidden webhook form into an approachable automation builder.

- [ ] Extract workflow UI/state from the oversized `SettingsPageContent.tsx` into dedicated components.
- [ ] Create `/automations` overview with template cards, active workflows, health, failed deliveries, and “New automation”.
- [ ] Add simple template-first recipes:
  - [ ] Meeting finished -> Slack summary.
  - [ ] Meeting finished -> webhook/CRM payload.
  - [ ] Client meeting -> send selected fields.
  - [ ] Action items extracted -> downstream handoff.
  - [ ] Meeting updated -> notify external system.
- [ ] Keep an Advanced mode for filters, field selection, QuickJS transform, signing secret, custom headers, and replay.
- [ ] Add a live “When / If / Then” summary above the editor so non-technical users can understand the workflow.
- [ ] Add inline examples/tooltips for filter fields and transform behavior.
- [ ] Add preview using the existing playground endpoint before Save/Test.
- [ ] Show delivery health and last failure at the workflow-card level.
- [ ] Fix Settings “Open Workflow Builder” so it navigates to `/automations`, not the Fathom settings dialog.

Primary files:
- `src/components/dashboard/settings/SettingsPageContent.tsx`
- `src/lib/automation-workflows.ts`
- existing `/api/workspaces/[workspaceId]/automation/workflows/*`
- new `src/components/dashboard/automations/AutomationWorkspace.tsx`
- new `src/components/dashboard/automations/AutomationTemplatePicker.tsx`
- new `src/components/dashboard/automations/WorkflowHealthCard.tsx`

Acceptance: a user can understand, create, preview, enable, test, and inspect a workflow without entering Settings -> Advanced.

## CP3 — Board declutter: Swipe Sweep

Target: make cleaning a noisy board feel closer to triage than project administration.

- [ ] Keep existing stale/overdue/vague ranking as the source of candidates.
- [ ] Replace numeric session-size input with a slider + presets (5 / 10 / 20 / all up to cap).
- [ ] Add a **cleanup strictness slider** that controls which candidate scores enter the swipe queue.
- [ ] Render the active task as a swipeable card deck using the existing Framer Motion dependency.
- [ ] Swipe right = keep; left = discard; up = snooze; down = complete.
- [ ] Keep visible buttons for accessibility and discoverability.
- [ ] Add keyboard shortcuts: arrows plus K/D/S/C.
- [ ] Show AI recommendation/confidence and the exact reasons a task was selected.
- [ ] Add undo for the immediately previous action when the underlying mutation permits it.
- [ ] Add remaining-task count and “minutes saved”/processed count only as lightweight feedback, not gamified noise.
- [ ] On mobile, default the Board “Clean up” action to the swipe flow.
- [ ] Preserve current reason capture every N discards for model/product feedback.

Primary files:
- `src/components/dashboard/board/TaskSweepDialog.tsx`
- `src/components/dashboard/board/BoardPageContent.tsx`
- tests for sweep queue threshold/session helpers and keyboard/swipe mapping.

Acceptance: 10 stale tasks can be processed without opening a task detail dialog or moving the pointer between four buttons.

## CP4 — Meeting workspace: one page for memory + action

Target: the meeting detail page becomes the main unit of work after a call.

- [ ] Reorganize meeting detail into clear sections/tabs: Overview, Transcript, Tasks, Decisions, People, Chat.
- [ ] Add sticky action bar: Ask, Share, Review tasks, Create task, Plan follow-up.
- [ ] Surface linked client/company and attendee identity status.
- [ ] Show extracted tasks with approval state and source evidence.
- [ ] Show completion suggestions and evidence in context.
- [ ] Make source chips from chat deep-link to transcript position where timestamps exist.
- [ ] Add previous/next meeting context for the same client/company where confidence is high.
- [ ] Add “prepare next meeting” card using outstanding tasks + last decisions + attendee context.

Acceptance: a user should not need Meetings -> Chat -> Review -> People -> Planning navigation just to finish one meeting.

## CP5 — Share Center for everything extracted from a meeting

Target: one share action with selectable output instead of separate, inconsistent exports.

- [ ] Add a Meeting Share Center.
- [ ] Select what to include: summary, decisions, action items, attendees, key transcript moments, full transcript, source link.
- [ ] Formats: clean text, Markdown, copy-to-clipboard, downloadable Markdown/PDF, Slack.
- [ ] Reuse existing Slack connection and export helpers.
- [ ] Add share presets: Executive recap, Client follow-up, Internal handoff, Tasks only, Full notes.
- [ ] Preserve source attribution/timestamps where present.
- [ ] Add stable share-link architecture only after access-control semantics are explicit; do not expose private meetings by default.
- [ ] Add a “Copy follow-up email brief” output without auto-sending.

Primary files:
- meeting detail components
- `src/lib/exportUtils.ts`
- `src/components/dashboard/common/ShareToSlackDialog.tsx`
- new `src/components/dashboard/meetings/MeetingShareCenter.tsx`

Acceptance: the complete useful output of a meeting can be packaged in under 3 clicks.

## CP6 — Chat becomes the universal query/action layer

Target: retain one scoped chat and make its actions more useful.

- [ ] Keep `GeneralChatPanel` as the canonical composer.
- [ ] Improve meeting-mode prompt suggestions: decisions, commitments, disagreements, follow-ups, “what changed?”.
- [ ] Improve workspace-mode prompts: outstanding client promises, overdue owner, repeated blockers, unresolved decisions.
- [ ] Render deterministic `create_task` and `schedule_slack_reminder` suggested actions with explicit confirmation.
- [ ] Add “Add answer to meeting notes” and “Share answer” UI actions that do not mutate silently.
- [ ] Show source type + timestamp consistently.
- [ ] Add scoped empty/no-evidence states that suggest narrowing to a meeting/client/person.
- [ ] Keep all writes auditable through existing deterministic tools.

Primary files:
- `src/components/dashboard/chat/GeneralChatPanel.tsx`
- `src/app/api/ai/chat/route.ts`
- `src/lib/chat-command-executor.ts`
- MCP task/workspace tools where needed.

Acceptance: users can ask and then act without leaving chat, but no casual question mutates data.

## CP7 — People and Clients become lightweight CRM memory

- [ ] Make People default to clear teammate/client/unknown segments.
- [ ] Add “Needs review” identity queue for uncertain duplicates/classifications.
- [ ] Make Clients company-first, then people.
- [ ] Add client health strip: last meeting, next meeting, open commitments, overdue items, relationship owner.
- [ ] Add timeline combining meetings, commitments, decisions, notes, and status changes.
- [ ] Add “Ask about this client/person” scoped chat entry.
- [ ] Add one-click share/report from client/company profile.
- [ ] Preserve manual identity/classification overrides over inferred data.

Acceptance: a user can answer “what do we owe this client and what happened last time?” from one profile.

## CP8 — Calendar and meeting planning

- [ ] Keep Calendar as the temporal view of meetings + due work, not a generic Google Calendar clone.
- [ ] Improve day/week density, current-time marker, client/company chips, recording/provider state, and outstanding-task badge.
- [ ] Upcoming meeting drawer should show agenda status, relevant previous meeting, open commitments, and prepare action.
- [ ] Past meeting drawer should prioritize recap/tasks/share/ask.
- [ ] Add quick “Prepare” action from every upcoming meeting.
- [ ] Add quick “Review” action from every completed meeting.
- [ ] Keep external conference link as an explicit secondary action.
- [ ] Make Planning and Calendar cross-link rather than duplicate upcoming-meeting lists.

Acceptance: upcoming and past meetings have visibly different next actions.

## CP9 — Integrations: Fathom #1 + five alternatives

### Fathom — primary

- [ ] Keep Fathom first and visually marked “Recommended / Primary”.
- [ ] Surface connection health, last sync, webhook health, last successful meeting, and actionable errors.
- [ ] Make reconnect/sync/logs discoverable without opening an oversized modal.

### Existing alternatives

- [ ] Fireflies.ai: retain generic adapter; improve setup copy, health, tests, and live-run documentation.
- [ ] Grain: retain generic adapter; improve setup copy, health, tests, and live-run documentation.

### New alternatives

- [ ] tl;dv adapter:
  - [ ] API-key validation via documented production API.
  - [ ] meeting list.
  - [ ] transcript fetch.
  - [ ] MeetingReady / TranscriptReady webhook normalization.
  - [ ] provider tests.
- [ ] Otter.ai adapter:
  - [ ] Bearer API-key validation for Enterprise Public API.
  - [ ] conversation list.
  - [ ] conversation detail with `include=all` or required relationships.
  - [ ] `conversation.completed` webhook normalization.
  - [ ] clearly label Enterprise API requirement in UI/docs.
  - [ ] provider tests.
- [ ] MeetGeek adapter:
  - [ ] Bearer API-key validation.
  - [ ] meeting list/detail.
  - [ ] transcript retrieval.
  - [ ] completed-analysis webhook normalization.
  - [ ] provider tests.

Shared files:
- `src/lib/meeting-providers/types.ts`
- `src/lib/meeting-providers/index.ts`
- new provider adapter/test files
- `src/components/dashboard/settings/MeetingProviderIntegrationCard.tsx`
- `src/components/dashboard/settings/SettingsPageContent.tsx`

Acceptance: Taskwise supports Fathom plus Fireflies, Grain, tl;dv, Otter.ai, and MeetGeek on the same canonical ingestion rail; provider-generated data never bypasses canonical task review.

## CP10 — Integration health and onboarding

- [ ] Add consistent states: not connected, validating, active, degraded, auth expired/revoked, webhook missing, last sync failed.
- [ ] Store/display `lastSyncAt`, `lastSuccessAt`, and safe `lastError` metadata where appropriate.
- [ ] Add provider-specific setup steps beside webhook URL.
- [ ] Add “Test connection” and “Sync recent meetings” actions.
- [ ] Never render API keys/secrets after save.
- [ ] Add onboarding suggestion after first manual transcript: “Connect Fathom to automate this.”

## CP11 — MCP: turn implementation depth into a visible feature

- [ ] Audit registry against docs so tool/resource/prompt lists are generated from the registry where possible.
- [ ] Add a human-readable `/docs/mcp` quick start before exhaustive reference.
- [ ] Explain scopes (`mcp:read` / `mcp:write`) and which tools mutate data.
- [ ] Add copy-ready examples for Claude Code, Codex, ChatGPT-compatible clients, OpenClaw, and generic MCP clients where supported.
- [ ] Add “What can I ask?” prompt gallery using real registered tools.
- [ ] Add key rotation/revocation and audit log explanation.
- [ ] Link MCP docs from Automations and relevant advanced surfaces.
- [ ] Add MCP health self-check UI without exposing secrets.

Acceptance: a technical user can connect a client without reading source code or reverse engineering routes.

## CP12 — Help system and microcopy

- [ ] Add reusable `HelpHint` / explanatory tooltip primitive rather than ad-hoc `title` attributes.
- [ ] Tooltip every icon-only action on core pages.
- [ ] Add concise “Why am I seeing this?” explanation for AI flags/recommendations.
- [ ] Add first-use inline tours for: Review Tasks, Board Sweep, Automations, MCP setup.
- [ ] Add contextual docs links in empty/error states.
- [ ] Ensure help is dismissible and does not permanently reduce work-surface density.

Acceptance: a first-time user can identify the purpose of every primary control without external training.

## CP13 — Visual system and interaction polish

- [ ] Preserve calm light theme but tighten hierarchy and spacing.
- [ ] Create consistent page shell, toolbar, work panel, compact row, badge, and empty/error/loading patterns.
- [ ] Remove unnecessary gradients/glass effects from operational surfaces.
- [ ] Keep one primary CTA per screen section.
- [ ] Standardize 8/12/16/24 spacing rhythm and card radii.
- [ ] Improve focus-visible states, keyboard order, target sizes, and reduced-motion behavior.
- [ ] Test 360px mobile, tablet, 1366px laptop, and large desktop layouts.
- [ ] Do not use color alone for status.

## CP14 — SEO: own high-intent meeting-to-action queries

- [ ] Audit root metadata, canonical tags, robots, sitemap, OG/Twitter images, structured data, and indexable public routes.
- [ ] Build public landing pages around implemented use cases, not keyword stuffing:
  - [ ] AI meeting notes to tasks.
  - [ ] Chat with meeting transcripts.
  - [ ] Fathom task management / Fathom alternative workflow layer.
  - [ ] Fireflies to task board.
  - [ ] Grain to task board.
  - [ ] tl;dv to task board.
  - [ ] Otter action items to execution.
  - [ ] MeetGeek task workflow.
  - [ ] MCP for meeting memory.
  - [ ] AI meeting workflow automation.
- [ ] Add SoftwareApplication + FAQ/Breadcrumb structured data only where content supports it.
- [ ] Add integration directory and comparison/use-case internal-link graph.
- [ ] Add public docs to sitemap.
- [ ] Make landing claims measurable and linked to product screenshots/workflows.

Acceptance: every target page has unique intent, metadata, useful content, and a direct activation CTA.

## CP15 — Marketing/viral loops tied to product value

- [ ] Add shareable branded meeting recap output with opt-in Taskwise attribution.
- [ ] Add tasteful “Made actionable with Taskwise” footer on externally copied/shared templates, removable by user.
- [ ] Add referral/teammate invite prompt only after user reaches a value moment (e.g. shares or approves tasks), not on first load.
- [ ] Add public template gallery for automation recipes and meeting-output formats.
- [ ] Build comparison pages from factual capability matrices.
- [ ] Add “before Taskwise / after Taskwise” interactive demo using sample meeting data.
- [ ] Add sample workspace path that demonstrates transcript -> chat -> review -> board -> follow-up without signup friction where privacy permits.
- [ ] Instrument activation funnel: landing -> signup -> first meeting -> first reviewed task -> first share -> first integration -> retained week.

Do not manufacture social proof, fake counters, fake urgency, or unsupported competitor claims.

## CP16 — Analytics and product instrumentation

- [ ] Define events for first meeting ingested, transcript chat used, task approved, task sweep completed, share center used, provider connected, workflow created, MCP key created.
- [ ] Track time-to-first-value and meeting-to-reviewed-task conversion.
- [ ] Track how many extracted tasks users discard/edit before approval as extraction quality feedback.
- [ ] Track Sweep outcomes by reason without logging transcript content.
- [ ] Track integration health failures by safe error code, never secret/payload content.
- [ ] Add operational dashboards/queries using existing observability stack.

## CP17 — Documentation

- [ ] Rewrite docs home around jobs-to-be-done: Capture, Ask, Review, Plan, Share, Automate, Integrate, MCP.
- [ ] Add Fathom-first onboarding guide.
- [ ] Add provider guides for Fireflies, Grain, tl;dv, Otter, MeetGeek.
- [ ] Add Automations cookbook with 5 recipes.
- [ ] Add Share Center guide.
- [ ] Add Board Sweep guide including keyboard/swipe controls.
- [ ] Add MCP quick start + troubleshooting.
- [ ] Cross-link docs from in-product help.

## CP18 — Release verification

- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm test -- --runInBand`
- [ ] `npm run test:routes:smoke`
- [ ] `npm run eval:chat-rag`
- [ ] `npm run build`
- [ ] Provider adapter unit tests for all five alternatives.
- [ ] Manual responsive QA of Meetings / Board Sweep / Calendar / People / Clients / Chat / Automations / Settings.
- [ ] Manual Fathom connection + sync smoke test with real credentials when available.
- [ ] Manual provider live tests are explicitly tracked separately from mocked contract tests.
- [ ] Security review of webhook authentication, API-key redaction, MCP write scopes, and share privacy.

# Delivery order for this branch

1. [ ] CP1 navigation/discoverability + CP2 Automations entry surface.
2. [ ] CP3 Swipe Sweep.
3. [ ] CP9 add tl;dv/Otter/MeetGeek adapters and expose all five Fathom alternatives.
4. [ ] CP5 Meeting Share Center foundation.
5. [ ] CP6 chat action improvements + CP12 reusable help hints.
6. [ ] CP11 MCP docs/productization.
7. [ ] CP14 public SEO/integration pages + metadata/internal linking.
8. [ ] CP4/CP7/CP8 cross-link and visual polish pass.
9. [ ] CP16 instrumentation and CP17 docs.
10. [ ] CP18 full verification and review.

# Non-goals / guardrails

- Do not replace the canonical task pipeline with provider action items.
- Do not create separate chat implementations for meeting/client/person scopes.
- Do not bypass workspace authorization because an integration supplied an external id.
- Do not expose transcript content in analytics/logging.
- Do not present a provider as production-verified until it has had a real credential live run.
- Do not add a new database or queue for features already served by Mongo/job infrastructure.
- Do not silently auto-publish private meeting content as a viral growth mechanism.
- Do not let SEO work degrade authenticated product performance.
