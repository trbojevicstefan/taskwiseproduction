# TaskWiseAI Multi-Workspace Architecture and Implementation Plan (2026-02-18)

## Objective
Enable each user to belong to multiple workspaces, switch active workspace safely, and preserve strict workspace data isolation across all APIs, jobs, and UI surfaces.

## Why This Change Is Needed
- Current model stores a single `user.workspace` object on `users`.
- Accepting an invite overwrites `user.workspace`, effectively moving the user instead of adding membership.
- There is no workspace switcher and no workspace membership model.
- Most routes trust `workspaceId` path params without a centralized membership authorization guard.

## Goals
- Support multi-workspace membership per user.
- Support explicit active workspace selection per user.
- Keep existing `/api/workspaces/[workspaceId]/...` feature surface working with authorization hardening.
- Migrate existing single-workspace data with zero downtime and rollback safety.
- Prevent cross-workspace data exposure in all read/write paths.

## Non-Goals (Initial Release)
- Enterprise SCIM/SAML provisioning.
- Cross-workspace unified search/feed.
- Complex billing separation per workspace.
- Fine-grained resource-level ACLs beyond workspace role.

## Success Criteria
- A user can be active in workspace A, switch to workspace B, and all views/queries resolve to B.
- A user can remain a member of N workspaces without losing previous memberships.
- Cross-workspace access attempts return 403/404 and do not leak existence.
- Invite acceptance adds membership and does not clobber unrelated workspace state.
- Migration completes idempotently with no orphaned data.

## Current State Snapshot (Code Anchors)
- Single workspace on user record: `src/lib/db/users.ts`.
- Workspace resolver returns only `user.workspace`: `src/lib/workspace.ts`.
- Invite acceptance overwrites `workspace`: `src/app/api/workspace-invitations/[token]/accept/route.ts`.
- Settings invite flow exists, but no membership management: `src/components/dashboard/settings/SettingsPageContent.tsx`.
- Sidebar derives board URL from one `user.workspace.id`: `src/components/dashboard/SidebarNav.tsx`.

## Target Architecture

## 1) Domain Model
Introduce first-class workspace entities and membership relationships.

### 1.1 Collections
- `workspaces`
  - `_id: string` (UUID)
  - `name: string`
  - `slug?: string` (optional, unique)
  - `createdByUserId: string`
  - `createdAt: Date`
  - `updatedAt: Date`
  - `status: "active" | "archived" | "deleted"`
  - `settings: { defaultBoardTemplate?, timezone?, ... }`

- `workspaceMemberships`
  - `_id: string` (UUID)
  - `workspaceId: string`
  - `userId: string`
  - `role: "owner" | "admin" | "member"`
  - `status: "active" | "invited" | "suspended" | "left"`
  - `joinedAt?: Date`
  - `createdAt: Date`
  - `updatedAt: Date`
  - `invitedByUserId?: string`

- `workspaceInvitations` (extend current collection)
  - Keep current fields, add:
  - `role: "admin" | "member"` (default `member`)
  - `acceptedByUserId?: string`
  - `revokedByUserId?: string`
  - `acceptedMembershipId?: string`
  - `tokenHash?: string` (if switching to opaque random token model)

### 1.2 Users Collection Changes
- Add `activeWorkspaceId: string | null`.
- Keep `workspace` temporarily as denormalized compatibility mirror of active workspace:
  - `workspace.id === activeWorkspaceId`
  - `workspace.name === active workspace name snapshot`

### 1.3 Index Plan
- `workspaces`
  - `{ _id: 1 }` unique
  - `{ slug: 1 }` unique sparse
  - `{ createdByUserId: 1, createdAt: -1 }`

- `workspaceMemberships`
  - `{ workspaceId: 1, userId: 1 }` unique
  - `{ userId: 1, status: 1, updatedAt: -1 }`
  - `{ workspaceId: 1, status: 1, role: 1 }`

- `workspaceInvitations`
  - Keep existing indexes
  - Add `{ workspaceId: 1, invitedEmail: 1, status: 1 }`
  - Add TTL index on `expiresAt` only if status semantics allow automatic cleanup

## 2) Authorization and Workspace Context
Centralize workspace resolution and authorization checks to avoid repeated route bugs.

### 2.1 New Core Helpers
- `src/lib/workspace-context.ts`
  - `getActiveWorkspaceForUser(db, userId)`
  - `setActiveWorkspaceForUser(db, userId, workspaceId)`
  - `listWorkspaceMembershipsForUser(db, userId)`
  - `assertWorkspaceAccess(db, userId, workspaceId, minRole?)`

- `src/lib/workspace-authz.ts`
  - Role precedence checks.
  - Error contract standardization (403 vs 404 behavior policy).

### 2.2 Route Guard Pattern
All workspace-scoped routes must:
1. Authenticate user.
2. Validate route `workspaceId`.
3. Call `assertWorkspaceAccess`.
4. Proceed only on success.

No route may rely only on query filters (`{ userId, workspaceId }`) without explicit membership check.

## 3) API Surface

### 3.1 New Endpoints
- `GET /api/workspaces`
  - Returns workspaces where membership is active.
  - Includes role and `isActive`.

- `POST /api/workspaces`
  - Creates workspace, creates owner membership, sets `activeWorkspaceId`.

- `POST /api/workspaces/switch`
  - Body: `{ workspaceId: string }`
  - Verifies membership active.
  - Updates `users.activeWorkspaceId` (+ compatibility mirror).

- `GET /api/workspaces/current`
  - Returns active workspace and membership role.

- `GET /api/workspaces/[workspaceId]/members`
- `POST /api/workspaces/[workspaceId]/members/invite`
- `PATCH /api/workspaces/[workspaceId]/members/[membershipId]`
- `DELETE /api/workspaces/[workspaceId]/members/[membershipId]`

### 3.2 Existing Endpoint Updates
- Keep existing board/task routes under `/api/workspaces/[workspaceId]/...`.
- Add centralized membership guard to every workspace-scoped route.
- Invitation accept route changes behavior:
  - Create or reactivate membership.
  - Mark invitation accepted.
  - Active workspace switch policy:
    - If user has no active workspace, set invited workspace active.
    - If user already has active workspace, keep current active by default and return switch hint.

### 3.3 Error Contract
- `401` unauthenticated.
- `403` authenticated but no access.
- `404` resource not found within accessible scope.
- `409` invalid state transitions (invite already accepted, owner removal blocked).

## 4) Auth/Session Strategy

### 4.1 JWT and Session Claims
- Keep user identity claims as-is.
- Add lightweight active workspace claim:
  - `token.activeWorkspaceId`
  - `session.user.activeWorkspaceId`
- Do not place full workspace list into JWT (staleness and size risk).

### 4.2 Source of Truth
- DB remains source of truth for active workspace and memberships.
- Client fetches `/api/users/me` or `/api/workspaces/current` after switch.
- API routes should not trust stale client state.

### 4.3 Backward Compatibility
- During migration, `getWorkspaceIdForUser` should read:
  1. `activeWorkspaceId`
  2. fallback to `workspace.id`

## 5) UI/UX Plan

### 5.1 Workspace Switcher
- Add workspace switcher in dashboard shell (header or sidebar top section).
- Show:
  - Current workspace name.
  - List of memberships.
  - Role badges.
  - Create workspace action.
  - Manage members shortcut for admins/owners.

### 5.2 Switch Behavior
- On switch:
  - call `POST /api/workspaces/switch`
  - refresh user/workspace context
  - navigate to equivalent route in new workspace when possible:
    - board routes -> target workspace board root
    - non-workspace routes (meetings/chat) reload scoped data

### 5.3 Invite UX
- Invite page should not claim "you are now in invited workspace" unless switch actually happened.
- If not auto-switched, show:
  - "You joined workspace X."
  - CTA: "Switch now."

### 5.4 Settings UX
- Split current workspace settings from membership management.
- Add members list with role management, revoke invite, and remove member actions.

## 6) Data Migration Plan (Zero-Downtime)

### Stage A: Additive Schema and Dual Read
- Add collections and indexes.
- Add `activeWorkspaceId` to user model.
- Keep old `user.workspace` reads working.

### Stage B: Backfill Script (Idempotent)
- Create `scripts/migrate-multi-workspace-phase1.js`:
  - For each user:
    - Create/find workspace from existing `user.workspace.id`.
    - Create owner membership if missing.
    - Set `activeWorkspaceId` if missing.
    - Sync `user.workspace` mirror from workspace document.
  - Log counters:
    - users scanned
    - workspaces created
    - memberships created
    - conflicts repaired

### Stage C: Dual Write
- When workspace name changes, write:
  - `workspaces.name`
  - `users.workspace.name` for active workspace mirror
- Invite acceptance writes membership first, then optional active switch.

### Stage D: Cutover
- All workspace resolution paths use membership + `activeWorkspaceId`.
- Deprecate direct semantic dependence on `users.workspace` (keep mirror until cleanup release).

### Stage E: Cleanup
- Remove fallbacks and legacy code once metrics confirm stability.

### Rollback Strategy
- Feature flags for:
  - new switcher UI
  - membership enforcement per route family
  - invite new behavior
- Rollback keeps old flows by:
  - disabling switcher
  - reverting to `users.workspace` resolver path
  - keeping data additive (no destructive migration in initial release)

## 7) Security and Abuse Controls
- Rate-limit invitation creation and acceptance attempts per IP/user/workspace.
- Enforce role checks:
  - owner/admin can invite
  - owner-only operations for ownership transfer and workspace delete/archive
- Ensure invite token entropy:
  - Prefer random opaque token with hashed storage.
- Audit-log sensitive actions:
  - invite created/revoked/accepted
  - member removed
  - role changed
  - workspace switched

## 8) Comprehensive Edge Case Matrix

### Membership and Access
- User has zero memberships after account creation.
- User removed from currently active workspace.
- User suspended in active workspace mid-session.
- User tries to switch to workspace where membership is not active.
- User has duplicate membership records due to historical bug.

### Invitation Lifecycle
- Invite token not found.
- Invite token expired.
- Invite token revoked.
- Invite token already accepted.
- Invite email restricted and does not match signed-in user.
- Invite accepted by already active member (idempotent behavior).
- Multiple pending invites for same user/workspace.
- Same user accepts invite concurrently from two tabs.

### Role/Ownership
- Last owner attempts to leave workspace.
- Owner demotion without ownership transfer.
- Member removal while they have active workspace set to that workspace.
- Admin attempts owner-only action.

### Data Isolation and Query Safety
- API receives valid `workspaceId` path for workspace user does not belong to.
- Background job uses stale `workspaceId` and writes cross-workspace data.
- Null/legacy `workspaceId` tasks leak into active workspace lists.
- SSE/domain events emitted without workspace context and rendered on wrong client.

### UX and Client State
- Workspace switched in one tab; other tabs keep stale active workspace.
- User deep-links to `/workspaces/<id>/board` for inaccessible workspace.
- Switch while unsaved UI form state exists.
- Workspace renamed while client cache uses old name.

### Migration/Operations
- Migration rerun after partial completion.
- Index creation races during deploy.
- Existing users missing `workspace.id`.
- Historical invites referencing deleted workspace.
- Workspace deleted/archived while invites remain pending.

## 9) Test Strategy

### 9.1 Unit Tests
- Role evaluation and authorization helpers.
- Active workspace resolver fallback behavior.
- Invite acceptance state transitions.

### 9.2 API Integration Tests
- Workspace list/switch/create endpoints.
- All `/api/workspaces/[workspaceId]/...` handlers reject unauthorized access.
- Invitation acceptance adds membership and handles idempotency.
- Member removal updates active workspace fallback behavior.

### 9.3 Migration Tests
- Run migration on:
  - clean DB
  - partially migrated DB
  - malformed legacy records
- Verify idempotency and no data loss.

### 9.4 End-to-End Tests
- Join second workspace via invite.
- Switch workspaces and verify page/data scope changes.
- Deep link protection.
- Role-based UI visibility and action restrictions.

### 9.5 Regression Tests
- Existing single-workspace users still function without manual action.
- Board/task/meeting ingestion flows continue writing to correct workspace.

## 10) Observability and Ops
- Metrics:
  - workspace switch success/failure count
  - unauthorized workspace access attempts
  - invite create/accept conversion and failure reasons
  - migration progress counters
- Logs:
  - structured logs include `userId`, `workspaceId`, `route`, `action`
- Alerts:
  - spike in 403 on workspace routes
  - spike in invite acceptance failures
  - migration error threshold breach

## 11) Delivery Stages

### Stage 0: Decision Lock and Contracts (1-2 days)
- Finalize role model and invite auto-switch policy.
- Finalize API contracts and error behavior.
- Add feature flags.

### Stage 1: Data Layer Foundation (2-4 days)
- Add new collections, indexes, models.
- Add authz/workspace-context helpers.
- Add migration script and dry-run mode.

### Stage 2: API and Auth Cut-In (3-5 days)
- Implement `GET /api/workspaces`, `POST /api/workspaces/switch`.
- Update workspace-scoped routes to use membership guard.
- Update invitation accept to membership semantics.

### Stage 3: UI Switcher and Membership UX (3-5 days)
- Add switcher component.
- Add member management and updated invite UX.
- Handle stale-tab refresh and active workspace changes.

### Stage 4: Hardening and Rollout (2-4 days)
- Full regression and load tests.
- Canary rollout with feature flags.
- Monitor metrics and errors.
- Complete cleanup tasks.

## 11.1) Estimated Execution Runs and Token Budget
Assumption: one "run" means one focused implementation session (code + tests + review) against a bounded scope.

- Estimated total runs: `12` (reasonable range `10-14`)
- Estimated total tokens: `260k-420k`
- Planning overhead: `20k-35k`
- Implementation and refactors: `170k-280k`
- Tests, fixes, and rollout hardening: `70k-105k`

Per-run rough token profile:
- Small run (single subsystem): `15k-25k`
- Medium run (API + UI + tests): `22k-40k`
- Large run (migration or cross-cutting hardening): `35k-55k`

Suggested 12-run split:
1. Contracts/flags/index design: `15k-25k`
2. New data models and collections: `18k-30k`
3. Membership/authz helpers: `18k-30k`
4. Workspace list/current/switch APIs: `20k-35k`
5. Invite flow conversion to membership semantics: `18k-30k`
6. Workspace-scoped route guard rollout (batch 1): `22k-40k`
7. Workspace-scoped route guard rollout (batch 2): `22k-40k`
8. Auth/session and `/api/users/me` compatibility updates: `15k-28k`
9. Switcher UI and client state sync: `22k-40k`
10. Settings member-management UX: `22k-40k`
11. Migration script + dry run + validation: `30k-50k`
12. E2E/regression/observability/rollout checks: `28k-52k`

## 12) File-Level Implementation Map
- New:
  - `src/lib/workspaces.ts`
  - `src/lib/workspace-memberships.ts`
  - `src/lib/workspace-context.ts`
  - `src/lib/workspace-authz.ts`
  - `src/app/api/workspaces/route.ts`
  - `src/app/api/workspaces/switch/route.ts`
  - `scripts/migrate-multi-workspace-phase1.js`

- Update:
  - `src/lib/db/users.ts`
  - `src/lib/workspace.ts`
  - `src/lib/auth.ts`
  - `src/app/api/users/me/route.ts`
  - `src/app/api/workspace-invitations/route.ts`
  - `src/app/api/workspace-invitations/[token]/accept/route.ts`
  - All routes under `src/app/api/workspaces/[workspaceId]/...`
  - `src/contexts/AuthContext.tsx`
  - `src/components/dashboard/SidebarNav.tsx`
  - `src/components/dashboard/settings/SettingsPageContent.tsx`
  - `src/app/invite/[token]/page.tsx`

## 13) Definition of Done Checklist
- Data model supports many-to-many user/workspace membership.
- Active workspace switch endpoint implemented and guarded.
- UI switcher implemented and stable.
- All workspace APIs enforce membership authz.
- Invite acceptance creates membership and handles all invitation states.
- Migration is idempotent and validated in staging.
- Tests cover positive and negative scenarios.
- Observability dashboards and alerts in place.
- Rollback plan tested.

## 14) Open Decisions to Resolve Before Build
- Invite acceptance default:
  - Auto-switch active workspace or keep current and prompt?
- Workspace deletion behavior:
  - Archive-only vs hard delete.
- Ownership model:
  - Single owner vs multiple owners.
- Invitation token storage:
  - Plain random token vs hashed token storage.
- Backfill for legacy `tasks.workspaceId = null`:
  - assign by heuristics or leave null and exclude by default.

## 15) Execution Task Checklist

### Run 1: Contracts, Feature Flags, and Guardrails
- [x] Finalize role model (`owner/admin/member`) and permission matrix.
- [x] Finalize invite acceptance behavior (auto-switch vs explicit switch).
- [x] Add feature flags for switcher UI, membership guards, and invite behavior.
- [x] Define standardized workspace auth error contract (`401/403/404/409`).

### Run 2: Data Model Foundations
- [x] Add `workspaces` model and repository helpers.
- [x] Add `workspaceMemberships` model and repository helpers.
- [x] Add `activeWorkspaceId` to user model/types.
- [x] Add/verify indexes for `workspaces`, `workspaceMemberships`, and invitations.

### Run 3: Workspace Context and AuthZ Core
- [x] Implement `getActiveWorkspaceForUser`.
- [x] Implement `setActiveWorkspaceForUser`.
- [x] Implement `listWorkspaceMembershipsForUser`.
- [x] Implement `assertWorkspaceAccess` with role checks.
- [x] Add unit tests for authz and role precedence.

### Run 4: Workspace APIs (Base)
- [x] Implement `GET /api/workspaces`.
- [x] Implement `GET /api/workspaces/current`.
- [x] Implement `POST /api/workspaces/switch`.
- [x] Implement `POST /api/workspaces` (create + owner membership + active switch).
- [x] Add API tests for successful and forbidden paths.

### Run 5: Invitation Semantics Migration
- [x] Update invitation schema for role and acceptance metadata.
- [x] Update invite create flow to target workspace membership creation.
- [x] Update invite accept flow to create/reactivate membership instead of overwriting workspace.
- [x] Make invite acceptance idempotent under concurrent requests.
- [x] Update invite page messaging for joined vs switched states.
- [x] Add tests for expired/revoked/already-accepted/wrong-email cases.

### Run 6: Workspace Route Guard Rollout (Batch 1)
- [x] Add centralized membership guard to board list/create routes.
- [x] Add centralized membership guard to board detail/update/delete routes.
- [x] Add centralized membership guard to status routes.
- [x] Add centralized membership guard to board-item routes.
- [x] Add regression tests for unauthorized `workspaceId` path access.

### Run 7: Workspace Route Guard Rollout (Batch 2)
- [x] Add centralized membership guard to move-task and by-task routes.
- [x] Audit non-workspace routes that consume workspace context (`meetings/tasks/sync/jobs`).
- [x] Replace legacy direct resolver calls where needed with active workspace resolver.
- [x] Validate no cross-workspace read/write paths remain.

### Run 8: Auth, Session, and Compatibility Layer
- [x] Add `activeWorkspaceId` to JWT/session payload.
- [x] Update `/api/users/me` response to include active workspace and memberships summary.
- [x] Keep legacy `user.workspace` mirror updated during transition.
- [x] Update `getWorkspaceIdForUser` fallback order (`activeWorkspaceId` then legacy).
- [x] Add compatibility tests for old single-workspace users.

### Run 9: Workspace Switcher UI
- [x] Add switcher component to dashboard shell.
- [x] Wire switch action to `POST /api/workspaces/switch`.
- [x] Refresh user/workspace context after switch.
- [x] Handle route remapping when switching from workspace-specific pages.
- [x] Handle stale tabs and optimistic state rollback on failed switch.

### Run 10: Settings and Membership Management UX
- [x] Add workspace members list with roles.
- [x] Add invite-by-email flow with role selection.
- [x] Add remove member and role update actions with guardrails.
- [x] Add owner-protection rules (no orphan workspace owner state).
- [x] Add UI tests/behavior tests for role-based visibility/actions.

### Run 11: Migration and Operational Readiness
- [x] Build `scripts/migrate-multi-workspace-phase1.js` with idempotency.
- [x] Add dry-run mode and migration summary output.
- [x] Execute migration in staging and validate counters.
- [x] Validate fallback behavior for malformed legacy user workspace data.
- [x] Prepare rollback toggles and operator runbook entries.

Staging execution log (2026-02-18):
- Pre-apply dry run: `usersScanned=8`, `workspacesCreated=8`, `membershipsCreated=8`, `usersSynced=8`, `errors=0`.
- Apply run: `usersScanned=8`, `workspacesCreated=7`, `membershipsCreated=8`, `usersSynced=8`, `errors=0`.
- Post-apply dry run: `usersScanned=8`, `workspacesCreated=0`, `membershipsCreated=0`, `usersSynced=0`, `errors=0`.

### Run 12: Hardening, Validation, and Rollout
- [x] Execute E2E flow: join second workspace, switch, deep-link protection.
- [x] Run regression suite for meetings, tasks, board, and ingestion workflows.
- [x] Validate metrics, logs, and alerts for workspace actions.
- [ ] Canary release with staged flag rollout.
- [x] Remove/track known temporary compatibility debt for cleanup.

Known compatibility debt tracked for cleanup release:
- Keep `users.workspace` compatibility mirror until canary completes and `activeWorkspaceId` adoption is stable.
- Keep legacy fallback in `src/lib/workspace.ts` until post-rollout metrics confirm no stale clients.
- Keep `WORKSPACE_MEMBERSHIP_GUARD_ENABLED` rollback path until staged rollout reaches 100%.
