# Core-First Remaining Validation Report (2026-02-16)

## Scope
- Finalize remaining checklist validations in `docs/core-first-optimization-plan-2026-02-13.md`:
  - webhook latency stability
  - webhook burst timeout behavior
  - worker restart/recovery reliability
  - SSE poll query latency under concurrency

## Validation Artifacts
- Webhook burst: `docs/core-first-webhook-burst-validation-2026-02-16.json`
- Worker recovery: `docs/core-first-worker-recovery-validation-2026-02-16.json`
- SSE poll latency: `docs/core-first-sse-latency-validation-2026-02-16.json`

## Commands Used
- `npx tsx scripts/validate-webhook-burst.ts`
- `npx tsx scripts/validate-worker-recovery.ts`
- `npx tsx scripts/validate-sse-poll-latency.ts`
- Aggregate runner:
  - `npm run validate:core-first:remaining`

## Results
1. Queue-first webhook latency and burst behavior
- Profile: `2` rounds, `80` requests/round, `20` concurrency (`160` total requests).
- Acceptance statuses: `160/160` returned `202`.
- Timeout failures (`>3000ms`): `0`.
- Latency:
  - p50: `859.16ms`
  - p95: `1122.91ms`
  - p99: `1804.64ms`
- Stability:
  - per-round p95: `[1126.34ms, 951.95ms]`
  - spread ratio: `1.183` (within configured limit `1.35`).
- Outcome: pass.

2. Worker recovery and restart continuity
- Seeded `300` queued `domain-event-dispatch` jobs.
- Interrupted worker during active processing, then restarted worker.
- Final state:
  - queued: `0`
  - running: `0`
  - succeeded: `300`
  - failed: `0`
- Outcome: pass.

3. SSE poll query latency under expected concurrency
- Profile: `5000` seeded events, `50` concurrency, `40` iterations (`2000` poll queries), limit `200`.
- Latency:
  - avg: `565.91ms`
  - p50: `373.57ms`
  - p95: `1002.28ms`
  - p99: `1059.69ms`
- Query planner:
  - winning stages: `LIMIT -> PROJECTION_SIMPLE -> FETCH -> IXSCAN`
  - expected cursor index found: `domain_events_user_status_created_cursor`.
- Outcome: pass under configured targets (p95 `<=1100ms`, p99 `<=1300ms`).

## Notes
- Validation thresholds are codified in scripts and can be overridden with env vars for stricter/future tuning.
- These validations are synthetic but production-shaped (real DB operations and real route/worker code paths).

## Rerun Snapshot (2026-02-16)
- Fresh artifact refresh completed with exact target profiles from the stage notes.
- Execution wrapper used: `npm.cmd exec -- tsx <script>` (PowerShell `npx` command parsing was unreliable in this shell session).

1. Queue-first webhook latency and burst behavior (`2026-02-16T15:27:47.234Z`)
- Artifact: `docs/core-first-webhook-burst-validation-2026-02-16.json`
- Profile: `2` rounds, `80` requests/round, `20` concurrency (`160` total requests).
- Result:
  - accepted (`202`): `160/160`
  - timeout failures (`>3000ms`): `0`
  - p50: `931.99ms`
  - p95: `1895.33ms`
  - p99: `2033.84ms`
  - p95 spread: `1.063`
- Outcome: fail (`p95` exceeded configured target `<=1500ms`).

2. Worker recovery and restart continuity (`2026-02-16T15:28:38.330Z`)
- Artifact: `docs/core-first-worker-recovery-validation-2026-02-16.json`
- Profile: `300` queued jobs, worker interrupted and restarted.
- Final state:
  - queued: `0`
  - running: `0`
  - succeeded: `300`
  - failed: `0`
- Outcome: pass.

3. SSE poll query latency (`2026-02-16T15:30:00.180Z`)
- Artifact: `docs/core-first-sse-latency-validation-2026-02-16.json`
- Profile: `5000` seeded events, `50` concurrency, `2000` total queries.
- Result:
  - avg: `647.70ms`
  - p95: `1009.42ms`
  - p99: `1167.59ms`
- Outcome: pass.
