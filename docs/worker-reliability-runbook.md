# Worker Reliability Runbook

## Deployment Model
- Dedicated worker process: run `npm run jobs:worker` as a separate service/process from API nodes.
- Queue persistence: jobs are stored in MongoDB (`jobs` collection), so queued jobs survive API restarts.
- Processing contract: worker claims one queued job at a time and updates status (`queued` -> `running` -> `succeeded|failed`).

## Health Checks
- Process health:
  - Worker process should be up and continuously polling.
  - Check logs for `jobs.worker.runner.started` and recurring `jobs.worker.backlog.*` entries.
- Queue health:
  - Run `npm run jobs:backlog` to print a queue snapshot and backlog status (`ok|warn|critical`).
  - Backlog exits non-zero when `critical`, suitable for monitoring/alerts.

## Retry and Dead-Letter Behavior
- Retry policy:
  - Jobs retry until `maxAttempts` is reached.
  - Retry delay backoff is `10_000ms * attempts`.
- Dead-letter equivalent:
  - Jobs that exhaust retries are moved to `status: failed`.
  - `failed` jobs are retained for inspection and incident response.

## Backlog Thresholds
- Env knobs:
  - `JOB_BACKLOG_WARN_THRESHOLD` (default `100`)
  - `JOB_BACKLOG_CRITICAL_THRESHOLD` (default `500`)
  - `JOB_WORKER_BACKLOG_LOG_INTERVAL_MS` (default `60000`)
- Runtime behavior:
  - Worker logs `jobs.worker.backlog.ok|warn|critical` periodically.
  - Use these events for alerting and autoscaling signals.

## Recovery Test Procedure
- Goal: validate no job loss across worker interruption.
- Steps:
  1. Enqueue representative load (mixed job types).
  2. Start worker and confirm active processing.
  3. Terminate worker process during active load.
  4. Restart worker process.
  5. Verify all pre-existing queued/running jobs end in `succeeded` or `failed` (no stuck jobs).
