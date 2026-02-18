# Multi-Workspace Rollout Runbook (2026-02-18)

## Scope
Operational steps for Run 11 and Run 12 rollout of multi-workspace membership, switching, and member-management APIs.

## Feature Flags
- `WORKSPACE_SWITCHER_ENABLED`
- `WORKSPACE_MEMBERSHIP_GUARD_ENABLED`
- `WORKSPACE_INVITE_MEMBERSHIP_MODE_ENABLED`

Recommended rollout order:
1. `WORKSPACE_INVITE_MEMBERSHIP_MODE_ENABLED=1`
2. `WORKSPACE_MEMBERSHIP_GUARD_ENABLED=1`
3. `WORKSPACE_SWITCHER_ENABLED=1`

Rollback order (reverse):
1. `WORKSPACE_SWITCHER_ENABLED=0`
2. `WORKSPACE_MEMBERSHIP_GUARD_ENABLED=0`
3. `WORKSPACE_INVITE_MEMBERSHIP_MODE_ENABLED=0`

## Migration Commands
Dry run:
```bash
npm run migrate:workspace:phase1:dry
```

Dry run (sample only):
```bash
npm run migrate:workspace:phase1:dry -- --limit=100
```

Apply:
```bash
npm run migrate:workspace:phase1:apply
```

The migration prints JSON counters:
- `usersScanned`
- `workspacesCreated`
- `membershipsCreated`
- `membershipsReactivated`
- `membershipsRoleAligned`
- `usersSynced`
- `conflictsRepaired`
- `errors`

## Staging Validation
1. Run dry-run first and record counters.
2. Run apply in staging.
3. Re-run dry-run; expected deltas:
   - `workspacesCreated = 0`
   - `membershipsCreated = 0`
   - `usersSynced = 0`
   - `errors = 0`
4. Validate role-sensitive flows in staging:
   - Admin invite creation succeeds.
   - Admin cannot remove owner.
   - Last owner cannot be removed/demoted.
   - Removed member cannot access `/api/workspaces/{id}/...`.

## Malformed Legacy Data Validation
Use staging fixtures where:
- `users.workspace.id` is missing or non-string.
- `users.activeWorkspaceId` is missing or points to inaccessible workspace.
- membership status is non-active from stale data.

Expected behavior:
- migration coerces malformed IDs when possible.
- migration repairs active workspace conflicts to accessible workspaces.
- no user gets owner role escalation unless they created the workspace.

## Workspace Action Metrics
Workspace actions are emitted into `observabilityMetrics` with `kind=workspace_action`:
- `workspace.switch`
- `workspace.invite.accept`
- `workspace.member.invite.create`
- `workspace.member.role.update`
- `workspace.member.remove`

Quick checks:
1. Error spike by action:
```js
db.observabilityMetrics.aggregate([
  { $match: { kind: "workspace_action", recordedAt: { $gte: new Date(Date.now() - 60*60*1000) } } },
  { $group: { _id: { action: "$action", outcome: "$outcome" }, count: { $sum: 1 } } }
])
```
2. Guard failure spike:
```js
db.observabilityMetrics.find({
  kind: "route",
  route: { $regex: "^/api/workspaces/" },
  statusCode: 403,
  recordedAt: { $gte: new Date(Date.now() - 15*60*1000) }
})
```

## Alert Thresholds
- `workspace.switch` error ratio > 2% for 15m.
- `workspace.member.*` error ratio > 2% for 15m.
- workspace-route `403` count > 3x baseline for 15m.
- invite accept failures > 3x baseline for 15m.

## Canary Sequence
1. Enable invite membership mode for internal users only.
2. Enable membership guards for canary workspace cohort.
3. Enable switcher UI for canary cohort.
4. Monitor metrics/alerts for 24h.
5. Expand to 25%, then 50%, then 100%.

## Exit Criteria
- No unresolved migration errors.
- No sustained workspace action error spikes.
- No unauthorized cross-workspace data access.
- Member-management operations stable under canary load.
