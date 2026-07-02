# TaskWiseAI Blueprint

## Product Shape

TaskWiseAI turns meetings, transcripts, notes, and follow-up conversations into reviewed tasks that teams can assign, schedule, and track on a board.

The product has two intentionally separate layers:

1. Core user product: create or sync a meeting, review suggested tasks, assign owners and dates, then track work on the board.
2. Advanced operator platform: workspace integrations, Fathom multi-connection management, workflow webhooks, MCP keys, audit logs, replay, and runbook-driven recovery.

The default app experience should privilege the core loop. Advanced controls stay available to admins/operators, but they should not compete with normal end-user navigation.

## Current Architecture

- Next.js App Router application with React client components for authenticated dashboard surfaces.
- NextAuth-based authentication and session handling.
- MongoDB persistence for users, workspaces, meetings, canonical tasks, board items, people, integrations, jobs, domain events, workflows, webhook deliveries, MCP keys, and audit logs.
- Workspace-aware authorization helpers for membership, role, and admin visibility checks.
- AI meeting/task flows through Genkit/OpenAI-style flow modules.
- Meeting ingestion side effects sync attendees and suggested canonical tasks. Board projection is explicit and happens when a user approves selected tasks or moves a task to a board.
- Job worker support handles async Fathom sync/webhook ingest, domain-event dispatch, and workflow webhook delivery.
- Realtime refresh uses domain event/SSE infrastructure.

## Core Workflow

1. User creates a task list by pasting transcript/notes, trying sample data, or connecting Fathom.
2. Taskwise creates or syncs a meeting record.
3. AI extraction produces suggested tasks and people.
4. The user reviews tasks in the Review Tasks queue.
5. The user edits titles, notes, owners, due dates, priority, and status.
6. Approved tasks are promoted from `suggested` to active work and projected onto the board.
7. People pages and board views show responsibility and completion state.

## Default Navigation

Standard members should see:

- Home
- Review Tasks
- Board
- People

Admins/owners also get Settings access. Advanced features live under Settings -> Advanced.

## Settings Structure

- Profile: display name, avatar, account actions.
- Workspace: workspace name, invitations, members, admin visibility controls.
- Integrations: Google Workspace, Trello, Slack, Fathom connection health and basic actions.
- Preferences: meeting automation, completion-review preferences, Slack automation channel, transcript export, appearance.
- Advanced: workflow builder, webhook delivery replay, MCP API keys/audit logs, operator runbook links.

## Feature Flags

The simplification release uses client-visible flags with safe default-on behavior:

- `NEXT_PUBLIC_FEATURE_SIMPLE_NAV`
- `NEXT_PUBLIC_FEATURE_REVIEW_TASKS_HOME`
- `NEXT_PUBLIC_FEATURE_ADVANCED_SETTINGS`
- `NEXT_PUBLIC_FEATURE_MANUAL_MEETING_INGEST`
- `NEXT_PUBLIC_FEATURE_FATHOM_MULTI_CONNECTION_UI`
- `NEXT_PUBLIC_FEATURE_MCP_UI_ADVANCED_ONLY`

Existing core-first backend flags remain in `src/lib/core-first-flags.ts`.

## Supported Integrations

Current in-app integration paths are:

- Fathom meeting sync and webhooks.
- Google Workspace integration for Google/Calendar/Tasks related flows.
- Slack sharing and automation.
- Trello task/card export.
- MCP access for external AI clients, gated under Advanced.

Unsupported or future integrations should not be presented as currently available in core product copy.

## Validation Expectations

Before release:

- `npm run lint`
- `npm run typecheck`
- `npm run build`
- `npm test`
- `npm run test:routes:smoke`
- `npm run validate:core-first:remaining`

Known stability gates include webhook burst p95, worker recovery, SSE latency, Fathom multi-connection end-to-end checks, MCP real-client read/write validation, and rollback/recovery runbook validation.

## Design Direction

Taskwise is an operational productivity tool. UI should be quiet, dense enough for repeated work, and organized around scanning and action. Avoid marketing-like dashboard decoration inside the authenticated app. The homepage can be expressive, but product claims must map to implemented in-app flows.
