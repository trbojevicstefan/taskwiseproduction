# Session Handoff

## Project Overview
We are upgrading Taskwise from a single-user Fathom integration into a workspace-owned multi-connection model. On top of that, we are adding workflow-driven outbound webhooks with granular filtering/transforms and an authenticated MCP surface for meetings and action items.

## Current State
The repo baseline was stabilized in the last session. The failing `chat-sessions` pagination test was fixed, the blocking lint errors in settings were removed, CI now runs `build`, and `quickjs-emscripten` was added for future workflow transform execution.

This session added the first workspace-owned persistence layer and started wiring it into the live Fathom surface. New collection modules now exist for:
- `fathomConnections`
- `automationWorkflows`
- `webhookDeliveries`
- `mcpApiKeys`

The following route-level migration work is now in place:
- `/api/fathom/oauth/start` now creates workspace-scoped OAuth state in `fathomConnectionOauthStates`.
- `/api/fathom/oauth/callback` now creates or updates a `fathomConnections` record, still dual-writing the legacy `fathomInstallations` and user flags for rollback compatibility.
- `/api/fathom/webhook/setup`, `/api/fathom/webhooks`, and `/api/fathom/revoke` now resolve the preferred workspace connection instead of assuming a single user-owned install.
- `/api/workspaces/[workspaceId]/fathom/connections` now provides workspace-scoped connection listing plus OAuth-start preparation for create/update flows.
- `/api/workspaces/[workspaceId]/fathom/connections/[connectionId]` now supports per-connection rename and revoke operations.
- `/api/workspaces/[workspaceId]/fathom/connections/[connectionId]/webhooks` now provides explicit per-connection webhook list/create/delete operations, and the settings modal now uses these routes end-to-end.
- `/api/workspaces/[workspaceId]/automation/workflows` now provides workspace-scoped workflow list/create operations, while `/api/workspaces/[workspaceId]/automation/workflows/[workflowId]` provides detail/update/delete operations.
- `/api/workspaces/[workspaceId]/automation/workflows/[workflowId]/test` now sends a direct test delivery and records the result in `webhookDeliveries`.
- `/api/workspaces/[workspaceId]/automation/workflows/[workflowId]/deliveries` now lists delivery history for a single workflow.
- Domain-event dispatch now handles both `meeting.ingested` and `meeting.updated`, and both event types run workflow matching against enabled workspace workflows.
- Workflow delivery execution is now async via jobs: matched workflows create `webhookDeliveries` and enqueue `workflow-webhook-delivery-send` jobs with retry/backoff scheduling.
- `/api/fathom/webhook` now resolves inbound tokens from `fathomConnections` first, then falls back to legacy user tokens.
- `/api/users/me` now derives Fathom workspace integration state from `fathomConnections`, including connection count and preferred connection metadata, and no longer exposes legacy `fathomConnected` / `fathomWebhookToken` / `fathomUserId` fields in the public auth payload.
- `AuthContext` / `AppUser` now consume workspace-owned Fathom integration state only instead of the legacy single-install flags.
- `src/lib/fathom.ts` now has connection-aware token refresh and webhook helpers, with legacy `fathomInstallations` maintained as compatibility shadow writes instead of being the primary source for active connection flows.
- `fathom-sync` and `fathom-webhook-ingest` now carry `connectionId` and `providerSourceId`, and Fathom ingestion now scopes duplicate detection by connection while still matching legacy single-install meetings during migration.
- `src/lib/fathom-ingest.ts` now resolves workspace ownership from the linked `fathomConnections` record (when present) before user defaults, and persists connection/workspace metadata on meeting/planning-session writes.
- `src/lib/services/meeting-ingestion-side-effects.ts` now resolves workspace in this order: payload workspace -> persisted meeting workspace -> user bootstrap fallback, preventing accidental drift to `activeWorkspaceId`.

Validation completed:
- `npm test -- --runInBand src/app/api/users/me/route.test.ts src/app/api/fathom/webhook/route.test.ts src/lib/fathom-connections.test.ts src/lib/automation-workflows.test.ts src/lib/webhook-deliveries.test.ts src/lib/mcp-api-keys.test.ts`
- `npx tsc --noEmit`
- `npm test -- --runInBand src/app/api/fathom/webhook/route.test.ts src/lib/fathom-ingest.test.ts`
- `npx tsc --noEmit`
- `npm test -- --runInBand src/lib/fathom-ingest.test.ts src/app/api/fathom/webhook/route.test.ts`
- `npx tsc --noEmit`
- `npm test -- --runInBand --runTestsByPath src/app/api/users/me/route.test.ts src/app/api/workspaces/[workspaceId]/automation/workflows/route.test.ts src/app/api/workspaces/[workspaceId]/automation/workflows/[workflowId]/route.test.ts src/app/api/workspaces/[workspaceId]/automation/workflows/[workflowId]/test/route.test.ts src/app/api/workspaces/[workspaceId]/automation/workflows/[workflowId]/deliveries/route.test.ts`
- `npx tsc --noEmit`
- `npm test -- --runInBand --runTestsByPath src/lib/meeting-workflow-automation.test.ts src/lib/jobs/handlers/workflow-webhook-delivery-send-job.test.ts src/lib/domain-events.test.ts src/lib/services/meeting-ingestion-command.test.ts src/lib/realtime-events.test.ts`
- `npm test -- --runInBand --runTestsByPath src/lib/fathom-ingest.test.ts`
- `npx tsc --noEmit`

## Active Files

### `src/lib/fathom-connections.ts`
- Added typed workspace-owned connection docs, OAuth state docs, index creation, preferred-connection helpers, and serializers.

### `src/lib/automation-workflows.ts`
- Added typed workflow persistence, indexes, CRUD helpers, and serializer.

### `src/lib/webhook-deliveries.ts`
- Added typed delivery persistence, attempt logging helpers, indexes, replay helper, and serializer.

### `src/lib/mcp-api-keys.ts`
- Added typed MCP API key persistence, hash generation, indexes, usage/revoke helpers, and serializer.

### `src/app/api/fathom/oauth/start/route.ts`
```ts
const workspaceScope = await resolveWorkspaceScopeForUser(db, userId, {
  minimumRole: "member",
  adminVisibilityKey: "integrations",
  requestedWorkspaceId: requestUrl.searchParams.get("workspaceId"),
});

const state = await createFathomConnectionOAuthState(db as any, {
  workspaceId: workspaceScope.workspaceId,
  userId,
  connectionId: existingConnection?._id || null,
  label: requestedLabel,
});
```

### `src/app/api/fathom/oauth/callback/route.ts`
```ts
const connection = await upsertWorkspaceFathomConnection(db, {
  workspaceId: stateDoc.workspaceId,
  userId,
  connectionId: stateDoc.connectionId || null,
  requestedLabel: stateDoc.label || null,
  accessToken: payload.access_token,
  refreshToken: payload.refresh_token || null,
  expiresAt: payload.expires_in ? Date.now() + payload.expires_in * 1000 : null,
  scope: payload.scope || null,
  providerUserId: payload.user_id || null,
  webhookToken,
});
```

### `src/app/api/fathom/webhook/setup/route.ts`
- Now resolves the preferred workspace connection, updates its webhook token/status, and syncs webhook metadata back into the connection doc after creation.

### `src/app/api/fathom/webhooks/route.ts`
- Now reads and deletes webhook metadata from the preferred workspace connection instead of the legacy installation doc.

### `src/app/api/fathom/revoke/route.ts`
- Now revokes the preferred workspace connection and removes only that connection’s managed webhooks.

### `src/app/api/fathom/webhook/route.ts`
- Now resolves inbound webhook tokens from `fathomConnections` first, then loads the owning user for the existing ingest pipeline.

### `src/app/api/users/me/route.ts`
```ts
const workspaceIntegrations = await buildWorkspaceIntegrationSummary(
  db,
  activeWorkspaceId,
  userId
);

const appUser = toAppUser(user, workspaceContext.memberships, {
  activeWorkspaceRole: workspaceContext.activeMembershipRole,
  activeWorkspaceAdminAccess: workspaceContext.activeWorkspaceAdminAccess,
  workspaceIntegrations,
});
```

### `src/app/api/workspaces/[workspaceId]/automation/workflows/route.ts`
- New workspace-scoped list/create route for automation workflows with unique-name checks and secret-aware serialization on create responses.

### `src/app/api/workspaces/[workspaceId]/automation/workflows/[workflowId]/route.ts`
- New workspace-scoped detail/update/delete route with creator-or-admin authorization and duplicate-name protection on rename.

### `src/app/api/workspaces/[workspaceId]/automation/workflows/[workflowId]/test/route.ts`
- New test-delivery route that creates a `webhookDeliveries` record, performs a direct POST to the destination, and stores the result as an attempt.

### `src/app/api/workspaces/[workspaceId]/automation/workflows/[workflowId]/deliveries/route.ts`
- New delivery-log route that filters `webhookDeliveries` by workflow and optional status/limit query params.

### `src/lib/meeting-workflow-automation.ts`
- New meeting workflow runtime layer: resolves canonical meeting payload, evaluates workflow filters/field selection, creates signed webhook delivery records, and enqueues delivery-send jobs.

### `src/lib/jobs/handlers/workflow-webhook-delivery-send-job.ts`
- New async webhook-delivery sender: posts queued deliveries, records attempt metadata, and schedules retries with exponential backoff until `maxAttempts` is reached.

## Remaining Tasks

### Stability Baseline
- [ ] Reduce warnings in touched Fathom/settings/workflow files to a low-noise baseline before feature work.

### Data Model + Migration
- [ ] Add `fathomConnections` schema with `workspaceId`, label, OAuth state, webhook state, source ids, status, and audit timestamps.
- [ ] Add `connectionId` and `providerSourceId` fields to Fathom-derived meetings, planning sessions, and linked chat artifacts.
- [ ] Add `automationWorkflows` schema for trigger, filters, field selection, JS transform, destination, enablement, and version.
- [ ] Add `webhookDeliveries` schema for queued/sent/failed attempts, request/response metadata, and replay support.
- [ ] Add `mcpApiKeys` schema plus indexes for connections, workflows, deliveries, and auth lookups.
- [ ] Build an additive migration from legacy user-level Fathom state to workspace-owned connections with dual-read rollback support.

### Fathom Connection Backend
- [x] Replace the single-install helper surface in `src/lib/fathom.ts` with first-class connection-aware token refresh and webhook helpers.
- [x] Extend OAuth state persistence so the callback restores `workspaceId` and optional connection label.
- [x] Change Fathom OAuth start/callback routes to create or update a workspace connection record instead of only overwriting the current user install.
- [ ] Move inbound webhook token and webhook secret ownership from `users` to `fathomConnections`.
- [x] Make webhook setup create or refresh a webhook per connection without deleting sibling managed webhooks.
- [x] Update webhook list, delete, and revoke flows to target the preferred workspace connection.
- [x] Change recording hash and duplicate detection to include connection identity.
- [x] Update sync and ingest jobs to resolve workspace and downstream writes from the connection record, not `user.activeWorkspaceId`.

### Workflow Engine
- [x] Add workflow trigger support for `meeting.ingested` and `meeting.updated`.
- [ ] Define filter operators for meeting title, transcript text, summary, metadata, attendees, tags, and extracted task fields.
- [x] Define payload selection for `all fields` versus granular field subsets.
- [x] Add a worker-side workflow evaluator that loads enabled workflows for a workspace and matches events.
- [ ] Implement sandboxed JS transforms with `quickjs-emscripten`, no network access, strict timeout, and output size caps.
- [x] Build a canonical workflow input payload with workspace, connection, meeting, attendees, tasks, and metadata.
- [x] Add outbound webhook signing headers, delivery ids, and replay-safe timestamps.
- [x] Queue outbound webhook deliveries through the job system with retries and backoff.
- [ ] Persist delivery logs with request/response metadata, last error, and manual replay support.
- [ ] Add failure guardrails for disabled workflows, transform exceptions, oversized payloads, and repeated destination failures.

### APIs + UI
- [x] Add workspace-scoped API routes to list, create, update, and delete Fathom connections.
- [x] Move remaining Fathom settings webhook actions to explicit workspace-connection routes end-to-end.
- [x] Add workspace-scoped API routes to list, create, update, delete, and test workflows, plus browse delivery logs.
- [x] Update `/api/users/me` and auth context to expose connection counts and selected connection ownership instead of one Fathom flag.
- [ ] Build a settings UI for multiple Fathom connections with labels, source details, sync state, and per-connection actions.
- [ ] Build a workflow builder UI with trigger selection, filter builder, field selector, destination settings, and JS editor.
- [ ] Add a workflow playground UI that previews matched meetings, selected payload, transform output, and a test delivery result.
- [ ] Add operator UI for enabling/disabling workflows and replaying failed deliveries.

### MCP
- [ ] Add a workspace-authenticated MCP endpoint with workspace-scoped API keys and streamable HTTP transport.
- [ ] Expose read tools for latest meeting, list meetings, get meeting detail, and list action items.
- [ ] Expose safe write tools for task status, assignee, due date, notes, and canonical title updates.
- [ ] Add MCP authz, rate limits, audit logs, key rotation, and revoke flows.
- [ ] Run end-to-end validation for multi-connection ingest, workflow delivery, MCP reads/writes, worker recovery, and rollback runbooks.

## Next Immediate Step
Continue from the workflow execution baseline:
- Implement sandboxed workflow JS transforms using `quickjs-emscripten` and strict guardrails (timeout, memory/output limits, no network).
- Expand failure controls: workflow-disable thresholds for repeated delivery failures and explicit handling for transform/runtime exceptions.
- Decide when to remove the remaining legacy user-level Fathom shadow writes in OAuth/webhook routes once rollback confidence is high.
