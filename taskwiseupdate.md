# Taskwise Product Repair And Expansion Guide

Date: 2026-07-06

This guide turns the current product concerns into developer-ready tasks. It is based on a repo pass over the chat, meeting retrieval, integrations, MCP, people matching, task completion, calendar, board, planning, people, and client areas.

## Executive Summary

Taskwise already has many of the right building blocks, but several features are split across old and new paths. The most urgent work is to converge the chat experience around the newer grounded chat UI, make meeting-specific chat truly transcript-aware for the entire session, and upgrade general chat from keyword retrieval to semantic meeting search over MongoDB.

The second priority is product reliability: Trello is currently disabled, MCP task tools are partially stubbed, people matching needs canonical source precedence, and completion detection needs stronger evaluation and review safety.

The third priority is UX polish: the light theme is too white, several core screens are dense but low-contrast, and profiles/planning/calendar/board need workflows that match user expectations from mature tools such as Asana, Trello, Google Calendar, and HubSpot-style CRM profiles.

There is no installed local Codex "design" skill in this workspace. Available skills found locally were imagegen, openai-docs, plugin-creator, skill-creator, and skill-installer. Treat the UI work below as a normal product/design implementation pass using the existing Tailwind/shadcn-style components.

## Current Architecture Map

Key files already in the repo:

- Chat page: `src/app/chat/page.tsx`
- Old chat/task orchestration surface: `src/components/dashboard/chat/ChatPageContent.tsx`
- Newer grounded workspace chat panel: `src/components/dashboard/chat/GeneralChatPanel.tsx`
- General chat API: `src/app/api/ai/chat/route.ts`
- General chat LLM flow: `src/ai/flows/general-chat-flow.ts`
- Keyword retrieval layer: `src/lib/workspace-retrieval.ts`
- Meeting transcript Q&A flow: `src/ai/flows/transcript-qa-flow.ts`
- Chat persistence: `src/contexts/ChatHistoryContext.tsx`, `src/app/api/chat-sessions/[id]/route.ts`
- Calendar UI and API: `src/components/dashboard/calendar/CalendarPageContent.tsx`, `src/app/api/calendar/route.ts`
- Board UI: `src/components/dashboard/board/BoardPageContent.tsx`
- Planning UI and API: `src/components/dashboard/planning/PlanningWorkspacePageContent.tsx`, `src/app/api/planning/overview/route.ts`
- People profiles: `src/components/dashboard/people/PersonDetailPageContent.tsx`
- Clients page: `src/components/dashboard/clients/ClientsPageContent.tsx`
- People matching: `src/lib/people-matching.ts`
- People merge route: `src/app/api/people/merge/route.ts`
- Trello routes: `src/app/api/trello/*`
- Trello helper: `src/lib/trelloAPI.ts`
- Generic meeting providers: `src/lib/meeting-providers/*`, `src/lib/meeting-connections.ts`, `src/app/api/integrations/[provider]/route.ts`
- MCP registration: `src/lib/mcp-register-all.ts`
- Legacy MCP write tools: `src/lib/mcp-write-tools.ts`
- New MCP task pack stub: `src/lib/mcp-task-tools.ts`
- Task completion detection: `src/lib/task-completion-detection.ts`, `src/ai/flows/detect-completed-tasks-flow.ts`, `src/lib/task-completion-sync.ts`
- Theme tokens: `src/app/globals.css`, `tailwind.config.ts`

Validation commands:

```bash
npm run typecheck
npm test
npm run lint
npm run build
```

For focused testing, run relevant Jest files such as:

```bash
npm test -- src/app/api/ai/chat/route.test.ts
npm test -- src/components/dashboard/chat/GeneralChatPanel.test.tsx
npm test -- src/lib/workspace-retrieval.test.ts
npm test -- src/lib/people-matching.test.ts
npm test -- src/lib/task-completion-detection.test.ts
npm test -- src/lib/mcp-write-tools.test.ts
```

## Priority 1: Fix And Unify Chat

### Problem

The chat page currently has two different input systems:

- The newer `GeneralChatPanel` renders only when there are no old messages and no meeting context.
- The older `ChatPageContent` composer remains at the bottom and drives task extraction, task mutation, and meeting-linked chat.

This creates inconsistent behavior. The newest chat UI should become the single composer and message experience.

### Target Behavior

One chat interface should handle:

- General workspace questions.
- Single-meeting questions with transcript context.
- Follow-up questions that retain the same meeting context throughout the chat history.
- Source citations from meetings/transcripts/tasks/people.
- Suggested actions such as open meeting, open task, create task, schedule Slack reminder.
- Task creation and edits through explicit actions, not by every casual chat message accidentally becoming tasks.

### Implementation Tasks

1. Promote `GeneralChatPanel` into the canonical chat surface.

   Keep the newer bubble/source/action UI. Remove or retire the duplicate bottom input from `ChatPageContent.tsx`, or refactor `ChatPageContent` into a shell that delegates all sending to the newer panel.

2. Add session-aware props to `GeneralChatPanel`.

   Suggested API:

   ```ts
   type ChatContextMode = "workspace" | "meeting";

   interface GeneralChatPanelProps {
     sessionId?: string;
     meetingId?: string;
     mode?: ChatContextMode;
     initialMessages?: PanelMessage[];
     persistMessages?: boolean;
     onMessagesChange?: (messages: PanelMessage[]) => void;
   }
   ```

3. Extend `/api/ai/chat` to accept chat context.

   Suggested request shape:

   ```ts
   {
     question: string;
     sessionId?: string;
     meetingId?: string;
     history?: Array<{ role: "user" | "assistant"; text: string }>;
   }
   ```

   Validate all fields with zod. Keep max sizes strict.

4. Add a meeting-scoped answer path.

   If `meetingId` is present, load the meeting from MongoDB using the same workspace scope rules as other meeting routes. Extract transcript from `originalTranscript` or transcript artifacts. Include the full transcript or a robust retrieved transcript subset in the answer context. The meeting context must persist for the entire session, not just the first question.

5. Reuse or replace `transcript-qa-flow.ts`.

   The current flow is useful, but it has an older output contract (`answerText`, `sources`). Either adapt it behind `/api/ai/chat` or migrate its transcript-specific prompt rules into a unified chat flow. Do not expose client-callable server actions for authenticated chat.

6. Persist chat history consistently.

   Use `ChatHistoryContext` and `/api/chat-sessions/[id]` so user and assistant messages are saved, reloaded, and tied to `sourceMeetingId` when relevant.

7. Preserve meeting transcript context on reload.

   When a chat session has `sourceMeetingId`, the UI should reopen in meeting mode and route every follow-up through the meeting-scoped path.

8. Split "chat answer" from "task creation".

   Today the old chat can call task extraction flows. The new chat should answer by default. Task creation should happen only through explicit action buttons or user commands routed by intent, with confirmation for destructive or multi-task changes.

### Acceptance Criteria

- `/chat` shows exactly one input field in all states.
- Opening chat from a meeting creates or resumes a session with `sourceMeetingId`.
- Asking "What did we decide about pricing?" inside a meeting chat answers from that meeting transcript and cites transcript snippets.
- Follow-up questions like "Who said that?" still use the same meeting transcript.
- General chat questions search across workspace meetings, tasks, and people.
- Chat history reload keeps messages and context mode.
- No casual general question creates tasks unless user explicitly asks for task creation.
- Tests cover general chat, meeting chat, missing transcript, invalid meeting access, and session reload.

## Priority 2: Upgrade General Chat Retrieval To Semantic MongoDB Search

### Problem

`src/lib/workspace-retrieval.ts` is keyword-first by design. The user expectation is semantic search across stored meetings/transcripts in MongoDB.

### Target Behavior

General chat should retrieve semantically relevant meetings and transcript snippets even when wording differs. It should still use tasks and people as structured context.

### Implementation Tasks

1. Add embeddings for meeting/transcript chunks.

   Store embeddings in MongoDB. Suggested collection:

   ```ts
   meetingSearchChunks {
     _id: string;
     workspaceId: string;
     meetingId: string;
     userId: string;
     chunkType: "summary" | "transcript";
     text: string;
     speaker?: string | null;
     timestamp?: string | null;
     startOffsetSeconds?: number | null;
     embedding: number[];
     createdAt: Date;
     updatedAt: Date;
   }
   ```

2. Generate chunks during meeting ingestion.

   Hook into the shared ingestion path so Fathom, Fireflies, Grain, and manual meetings all index consistently.

3. Backfill existing meetings.

   Add a script, for example `scripts/backfill-meeting-search-chunks.ts`, with dry-run and apply modes.

4. Upgrade `searchWorkspaceContext`.

   Hybrid retrieval is recommended:

   - Vector similarity over meeting chunks.
   - Keyword scoring as fallback and tie-breaker.
   - Recency boost.
   - Structured intents for overdue tasks, priorities, clients, and assignees.

5. Add indexes.

   Create normal Mongo indexes for workspace/meeting lookup. If using MongoDB Atlas Vector Search, add the vector index and document the required setup. If vector search is unavailable locally, fall back to local cosine similarity over a capped candidate set.

6. Add context budget controls.

   Avoid passing entire workspaces to the LLM. Return top meetings, top transcript snippets, top tasks, and top people with source ids.

### Acceptance Criteria

- A semantic query with different wording finds the right meeting transcript.
- Answers cite real meeting ids and snippets.
- No-evidence questions return the deterministic no-evidence answer.
- Retrieval tests include keyword miss/semantic hit cases.
- Backfill can run safely twice without duplicate chunks.

## Priority 3: Restore Trello Integration

### Current State

The Trello routes are hard-disabled:

- `src/app/api/trello/oauth/exchange/route.ts`
- `src/app/api/trello/boards/route.ts`
- `src/app/api/trello/cards/route.ts`

They return `503 integration_disabled`.

### Implementation Tasks

1. Add Trello env vars to `.env.example`.

   Suggested:

   ```env
   TRELLO_API_KEY=
   TRELLO_API_SECRET=
   TRELLO_REDIRECT_URI=
   ```

2. Implement OAuth or token flow directly in Next.js.

   Do not depend on retired Firebase functions.

3. Store Trello connection per user/workspace.

   Follow existing connection patterns from Google, Slack, or meeting provider connections. Redact secrets in serializers.

4. Implement board/list/card endpoints.

   Required routes:

   - Exchange/connect Trello auth.
   - List Trello boards.
   - List board lists.
   - Create card from one or more Taskwise tasks.
   - Disconnect/revoke.

5. Update `PushToTrelloDialog`.

   Ensure it handles disconnected, loading, auth expired, no boards, no lists, card creation success, and card creation failure states.

### Acceptance Criteria

- User can connect Trello from settings or push dialog.
- User can choose board and list.
- Selected Taskwise tasks create Trello cards with title, description, due date, assignee text, and source meeting link when available.
- Failed Trello calls show actionable errors.
- Tests cover auth required, disconnected, list boards, list lists, create card, and revoke.

## Priority 4: Add More Integrations

### Current State

The repo already has:

- Fathom legacy OAuth/webhooks.
- Slack OAuth/users/reminders/share.
- Google calendar/tasks.
- Generic meeting provider framework for Fireflies and Grain.

### Recommended Next Integrations

Implement in this order:

1. Trello restore, because UI paths already exist.
2. Fireflies live verification, because adapter code exists but comments say verify on first live run.
3. Grain live verification, for the same reason.
4. Google Calendar create/update polish, because calendar and planning depend on it.
5. Optional project/task sinks after Trello: Asana, Linear, Jira, Notion.

### Acceptance Criteria

- Integration cards have consistent connect/disconnect/sync status.
- Each provider has health diagnostics and last sync status.
- Provider errors are stored and visible in settings.
- Webhook setup instructions are copyable and provider-specific.

## Priority 5: Expand MCP Actions

### Current State

`src/lib/mcp-write-tools.ts` supports legacy update tools:

- `action_items.update_status`
- `action_items.update_assignee`
- `action_items.update_due_date`
- `action_items.update_notes`
- `action_items.update_title`

`src/lib/mcp-task-tools.ts` is currently an empty task pack with comments listing intended tools.

### Implementation Tasks

Fill `src/lib/mcp-task-tools.ts` with registry definitions for:

- `tasks.list`
- `tasks.create`
- `tasks.create_from_meeting`
- `tasks.update_status`
- `tasks.assign`
- `tasks.set_due_date`
- `tasks.prioritize`
- `tasks.schedule_slack_reminder`
- `meetings.create_task`
- `meetings.add_note`
- `meetings.update_details`

Use existing helpers where possible:

- Task priority: `src/lib/task-priority.ts`
- Task reminders: `src/lib/task-reminders.ts`
- Job enqueue: `src/lib/jobs/store.ts`
- Domain events: `src/lib/domain-events.ts`
- MCP helper patterns: `src/lib/mcp-tool-helpers.ts`

### Safety Rules

- Mutating tools must use `scope: "mcp:write"`.
- Validate all args with zod.
- Cap text lengths and list sizes.
- Audit every write.
- Never call `syncTasksForSource` with partial task lists.
- Use task user/workspace as actor because MCP has no interactive session user.

### Acceptance Criteria

- MCP tool list includes create/update task actions.
- Write actions respect workspace scope and API key scopes.
- Tool calls produce audit logs.
- Tests cover valid writes, invalid args, missing task, scope violations, and rate limits.

## Priority 6: People Matching, Canonical Profiles, And Duplicate Handling

### Problem

People are duplicated across Slack, transcripts, clients, and manual entries. Existing matching supports email/name/alias, but there is no strong canonical-source model.

### Target Behavior

Slack should be the primary source for teammates for now. Client profiles should be canonicalized by email/domain/company and manually overrideable.

### Implementation Tasks

1. Add canonical identity fields.

   Suggested fields on people:

   ```ts
   canonicalPersonId?: string;
   primarySource?: "slack" | "manual" | "meeting_provider" | "transcript";
   sourceIdentities?: Array<{
     provider: "slack" | "fathom" | "fireflies" | "grain" | "google" | "manual";
     externalId?: string;
     email?: string;
     name?: string;
     confidence?: number;
     lastSeenAt?: Date;
   }>;
   mergeState?: "active" | "merged" | "blocked";
   mergedIntoPersonId?: string;
   ```

2. Improve matching scores.

   Build on `src/lib/people-matching.ts`:

   - Exact email: 1.0
   - Slack id: 1.0
   - Existing alias: 0.92+
   - Same email domain plus similar name: medium confidence
   - Same first name only: low confidence, never auto-merge
   - Client company/domain match: suggest, do not auto-merge

3. Add duplicate review UX.

   Use or extend `PeopleDiscoveryDialog` and people page flows so users can approve, reject, or block suggested merges.

4. Make merge safer.

   Extend `src/app/api/people/merge/route.ts` to update all references, not just `tasks.assignee.uid`. Cover assignee name keys, meeting attendees, extracted task assignees, source session ids, client grouping, and aliases.

5. Protect manual classifications.

   Existing person type source fields already support manual/auto. Preserve manual values during sync and classification.

### Acceptance Criteria

- Slack teammates become canonical when Slack id or email matches.
- Transcript-only duplicate is suggested for merge into Slack person.
- Manual "do not merge" choice is remembered.
- Merging updates task assignees and profile task counts.
- Tests cover email match, alias match, fuzzy name match, Slack precedence, blocked match, and merge reference rewrites.

## Priority 7: Improve Task Completion Detection

### Current State

The system already has embeddings and a conservative LLM auditor in:

- `src/lib/task-completion-detection.ts`
- `src/ai/flows/detect-completed-tasks-flow.ts`
- `src/lib/task-completion-sync.ts`

### Problems To Solve

- Improve confidence in "new transcript completed old task" matching.
- Avoid false positives.
- Make suggested completions reviewable.
- Measure quality over time.

### Implementation Tasks

1. Expand gold fixtures.

   Use `scripts/benchmarks/completion-detection-gold.json` and add cases:

   - Explicit completed.
   - Implicit completed.
   - Discussed but not done.
   - Blocked or failed.
   - Similar task title, wrong assignee.
   - Same client, different project.
   - Short transcript snippets.
   - Multiple old tasks, one completion statement.

2. Add benchmark thresholds.

   `npm run bench:completion` should report precision, recall, false positives, and false negatives. Set minimum precision before auto-applying completions.

3. Introduce review states.

   Use fields such as:

   ```ts
   completionReviewStatus: "suggested" | "accepted" | "rejected" | "auto_applied";
   completionReviewedBy?: string;
   completionReviewedAt?: Date;
   ```

4. Auto-apply only high-confidence matches.

   Suggested policy:

   - Auto-apply only explicit completion with high semantic score and clear evidence.
   - Suggest for review when confidence is medium.
   - Ignore low confidence.

5. Show evidence in UI.

   In meeting detail, review, board, and planning rows, show completion evidence snippet and source meeting.

### Acceptance Criteria

- Benchmark suite exists and is documented.
- High-confidence completions are auto-applied only when evidence is explicit.
- Medium-confidence completions appear in review UI.
- Rejected suggestions are remembered and not re-suggested for the same evidence.
- Tests cover completion review status and false-positive protection.

## Priority 8: UI Readability And Light Theme Contrast

### Current State

`src/app/globals.css` uses pure white background/card tokens in light mode. Many screens layer `bg-background/70`, `bg-card/70`, and subtle borders, which causes low contrast.

### Design Direction

Taskwise is an operational SaaS app. It should feel clear, dense, and calm:

- More contrast between app background, panels, cards, and inputs.
- Less glassmorphism in work screens.
- Stronger text hierarchy.
- Predictable controls.
- Consistent empty/loading/error states.
- Better scanability for lists and kanban cards.

### Implementation Tasks

1. Update theme tokens.

   Suggested light mode direction:

   - `--background`: off-white app canvas, not pure white.
   - `--card`: true white or slightly warm/cool surface.
   - `--border`: darker than current for work surfaces.
   - `--muted`: visible enough for chips and secondary blocks.
   - `--muted-foreground`: pass contrast for small text.

2. Create reusable work-surface patterns.

   Add utility classes or components for:

   - Page canvas.
   - Toolbar.
   - Work panel.
   - Data row.
   - Empty state.
   - Dense card.

3. Audit primary screens.

   Screens to inspect in light theme:

   - `/chat`
   - `/meetings`
   - `/meetings/[meetingId]`
   - `/planning`
   - `/workspaces/[workspaceId]/board`
   - `/people`
   - `/people/[personId]`
   - `/clients`
   - `/settings`

4. Accessibility checks.

   Text, chips, borders, inputs, and disabled states should meet reasonable contrast. Do not rely only on color to communicate status.

### Acceptance Criteria

- Light theme no longer reads as white-on-white.
- Inputs and cards are distinguishable at a glance.
- Empty states are clear but not oversized.
- Buttons and chips have readable text at 100% and larger UI scale.
- Screens remain responsive on mobile.

## Priority 9: Team Member, Client, And Company Profiles

### Current State

People and clients exist, but client companies are grouped on the clients page rather than first-class company/account profiles.

### Target Behavior

Profiles should work like a practical CRM:

- One page per teammate.
- One page per client person.
- One page per client company/account.
- One-click report generation using all known transcripts, tasks, meetings, and notes.

### Implementation Tasks

1. Improve person profile layout.

   In `PersonDetailPageContent.tsx`, reorganize into:

   - Profile header with avatar, name, role, company, type, Slack status.
   - Relationship summary.
   - Open tasks and overdue tasks.
   - Meeting timeline.
   - Recent transcript mentions.
   - Notes and aliases.
   - Source identities and merge suggestions.
   - Actions: share tasks, generate report, merge, mark teammate/client.

2. Add company/account model.

   Suggested collection:

   ```ts
   companies {
     _id: string;
     workspaceId: string;
     name: string;
     domain?: string;
     aliases?: string[];
     peopleIds: string[];
     createdAt: Date;
     updatedAt: Date;
   }
   ```

3. Add company routes and pages.

   Suggested:

   - `src/app/clients/[companyId]/page.tsx`
   - `src/app/api/companies/route.ts`
   - `src/app/api/companies/[id]/route.ts`
   - `src/app/api/companies/[id]/report/route.ts`

4. Upgrade clients page.

   `ClientsPageContent.tsx` should link company cards to company profiles. People under each company should link to person profiles.

5. Generate one-click reports.

   Report should include:

   - Executive summary.
   - Open commitments.
   - Overdue/risk items.
   - Completed work.
   - Recent meetings.
   - Key decisions.
   - Transcript evidence snippets.
   - Suggested next action.

### Acceptance Criteria

- Client company has its own URL and profile page.
- Client person and company reports can be generated with one click.
- Reports cite source meetings/transcript snippets/tasks.
- Company profile aggregates all people, meetings, and tasks for that company.
- Manual company assignments override domain inference.

## Priority 10: Calendar Meeting Details And Meeting Creation

### Problem

Calendar should open details about past and upcoming meetings instead of immediately opening an external meeting link. Users should also be able to create meetings from the calendar.

### Current State

`CalendarPageContent.tsx` routes internal meetings to `/meetings/[id]`, but Google overlay entries open `entry.link` in a new tab.

### Implementation Tasks

1. Add calendar event detail drawer.

   For Google events, open an in-app drawer/modal with title, time, attendees, description, conferencing link, related Taskwise meeting if found, and actions.

2. Add actions.

   - Open external meeting link.
   - Create Taskwise meeting from event.
   - Link to existing Taskwise meeting.
   - Create agenda.
   - Add tasks.

3. Add create meeting route.

   Reuse `src/app/api/meetings/route.ts` where possible. Add a narrow calendar-specific wrapper only if needed.

4. Match Google events to Taskwise meetings.

   Match by external event id, title/time proximity, organizer, and attendees.

### Acceptance Criteria

- Clicking any calendar item opens in-app details first.
- External meeting URL is an explicit action.
- User can create a Taskwise meeting from a calendar event.
- Created meeting appears on calendar and planning.
- Tests cover internal meeting click, Google event click, create meeting, and link existing.

## Priority 11: Board Visual And Workflow Upgrade

### Goal

Make the board feel closer to mature kanban tools: clear columns, compact cards, strong metadata, fast controls, and useful filtering.

### Implementation Tasks

1. Improve card density and readability.

   Cards should show title, assignee, due date, priority, source meeting, client/person, and completion evidence if relevant.

2. Improve column headers.

   Show count, WIP cues, quick add, sort/filter controls, and clear column category.

3. Improve drag and drop polish.

   Ensure stable card dimensions, clear drop indicators, and no layout jump.

4. Add views and filters.

   Useful controls:

   - Search.
   - Assignee.
   - Client/company.
   - Due date.
   - Priority.
   - Source meeting.
   - Completion suggestion status.

5. Add keyboard and bulk actions.

   Bulk move, assign, due date, mark done, export/share, push to Trello/Google Tasks.

### Acceptance Criteria

- Board is readable in light theme.
- Cards do not resize unpredictably on hover.
- Drag/drop is smooth and visually clear.
- Filters are preserved in query string or local storage.
- Tests cover board rendering, filters, move task, and bulk actions.

## Priority 12: Planning And Agendas

### Problem

`/planning` can show "Nothing to plan yet" because it only uses task triage from `/api/planning/overview`. It does not work as a future-meeting planning inbox.

### Target Behavior

Planning should help users prepare for upcoming meetings and update meeting details with more control.

### Implementation Tasks

1. Add upcoming meetings to planning overview.

   Extend `/api/planning/overview` or add `/api/planning/upcoming-meetings`.

   Include:

   - Upcoming Google calendar events.
   - Upcoming Taskwise meetings.
   - Meetings without agendas.
   - Meetings with open tasks from same attendees/client.

2. Add agenda workspace.

   For each future meeting, show:

   - Meeting details.
   - Attendees.
   - Related people/client/company.
   - Open tasks.
   - Suggested agenda topics.
   - User-editable agenda sections.
   - Carry-over items from previous meetings.

3. Let users control meeting updates.

   When AI suggests updates, show checkboxes/toggles:

   - Update title.
   - Update attendees.
   - Update agenda.
   - Link client/company.
   - Add tasks.
   - Change due dates.
   - Add notes.

4. Improve `/planning/agendas`.

   Make it the entry point for meeting agenda creation and review, not a disconnected screen.

### Acceptance Criteria

- Future meetings appear on `/planning`.
- "Nothing to plan yet" appears only when there are no tasks and no upcoming meetings.
- User can create/edit agenda for a future meeting.
- User can choose which meeting fields AI updates.
- Planning assistant can answer using upcoming meeting context.

## Priority 13: Meeting Details Improvements

### Tasks

1. Make meeting detail pages action-oriented.

   Show summary, transcript, attendees, extracted tasks, completion suggestions, linked chat, agenda, related company/client, and source integrations.

2. Add "Ask about this meeting" using the unified chat.

   This should open meeting-scoped chat with transcript context.

3. Add "Generate report" for meeting.

   Use transcript, tasks, decisions, attendees, and completion signals.

4. Add better transcript source navigation.

   Source snippets in chat should jump to transcript location when possible.

### Acceptance Criteria

- Meeting page can launch the new single-input chat in meeting mode.
- Transcript Q&A cites snippets.
- Tasks and completion suggestions are actionable from the meeting page.
- Reports are source-grounded.

## Priority 14: Data Model And Migration Notes

Add migrations or scripts for:

- Meeting search chunks and embeddings.
- Company/account collection.
- Person canonical/source identity fields.
- Trello connection storage.
- Completion review status fields if needed.

Migration rules:

- Add dry-run mode for scripts.
- Scripts should be idempotent.
- Log counts: scanned, inserted, updated, skipped, errors.
- Do not delete legacy data until replacement paths are verified.

## Priority 15: Suggested Delivery Order

1. Unify chat UI and keep one input.
2. Add meeting-scoped chat context and persistence.
3. Add semantic meeting retrieval for general chat.
4. Restore Trello.