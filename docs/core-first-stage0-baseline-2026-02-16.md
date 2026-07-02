# Core-First Stage 0 Baseline Snapshot (2026-02-16)

## Scope
- Freeze architecture target and baseline measurement contract for the Core-First rollout.
- Record baseline values for:
  - webhook latency p50/p95
  - job success/retry/failure rates
  - SSE connection count + query cost proxy
  - top 10 slow API routes

## Architecture Target (Frozen)
- Architecture analysis source: `docs/architecture-analysis-2026-02-12.md`
- Delivery/checklist source: `docs/core-first-optimization-plan-2026-02-13.md`

## Baseline Snapshot Artifact
- Generated artifact: `docs/core-first-baseline-snapshot-2026-02-16.json`
- Command:
  - `npm run metrics:core-first:baseline`
- Window:
  - 24 hours ending at snapshot generation time.

## Baseline Results
- Webhook latency (`POST /api/fathom/webhook`):
  - sample size: `0`
  - p50: `0ms`
  - p95: `0ms`
- Job outcomes:
  - total jobs: `0`
  - success rate: `0`
  - failure rate: `0`
  - retry rate: `0`
- SSE (`GET /api/realtime/stream`):
  - connection sample size: `0`
  - query cost proxy (duration p95): `0ms`
- Top 10 slow API routes:
  - no route metric samples in the selected window.

## Guardrails (Rollout Controls)
- Feature flags:
  - `CORE_FIRST_QUEUE_FIRST_WEBHOOK_INGESTION`
  - `CORE_FIRST_UNIFIED_MEETING_INGESTION_COMMAND`
  - `CORE_FIRST_ASYNC_DOMAIN_EVENT_PROCESSING`
- Flag implementation:
  - `src/lib/core-first-flags.ts`
- Metrics/dashboard commands:
  - `npm run metrics:core-first:baseline`
  - `npm run metrics:core-first:check`
  - `npm run metrics:sse`
  - `npm run jobs:backlog`
- Failure alert checks:
  - backlog critical exit: `npm run jobs:backlog` (non-zero on critical)
  - core-first baseline check mode: `npm run metrics:core-first:check` (non-zero on critical thresholds)

## Rollback Switch Verification
- Queue-first webhook switch verified via tests:
  - `src/app/api/fathom/webhook/route.test.ts`
- Unified meeting ingestion switch verified via tests:
  - `src/lib/services/meeting-ingestion-command.test.ts`
- Async domain event processing switch verified via tests:
  - `src/lib/domain-events.test.ts`
- Verification command:
  - `npm test -- --runInBand src/app/api/fathom/webhook/route.test.ts src/lib/services/meeting-ingestion-command.test.ts src/lib/domain-events.test.ts`

## Notes
- Snapshot is valid and reproducible, but current window has no production-like traffic in metrics collections.
- This is a no-data baseline (`overall: no_data`) and should be refreshed after canary traffic to establish operational p50/p95 references.
