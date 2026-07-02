import { getDb } from "@/lib/db";
import { processJob } from "@/lib/jobs/processor";
import {
  claimNextJob,
  ensureJobIndexes,
  getJobQueueSnapshot,
  markJobFailed,
  markJobSucceeded,
} from "@/lib/jobs/store";
import { recordJobMetric } from "@/lib/observability-metrics";
import {
  createLogger,
  ensureCorrelationId,
  serializeError,
} from "@/lib/observability";

let indexesEnsured = false;
let kickInFlight = false;
let backlogLastLoggedAt = 0;
const workerLogger = createLogger({ scope: "jobs.worker" });
const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const BACKLOG_LOG_INTERVAL_MS = Math.max(
  5_000,
  Number(process.env.JOB_WORKER_BACKLOG_LOG_INTERVAL_MS || 60_000)
);
const BACKLOG_WARN_THRESHOLD = Math.max(
  1,
  Number(process.env.JOB_BACKLOG_WARN_THRESHOLD || 100)
);
const BACKLOG_CRITICAL_THRESHOLD = Math.max(
  BACKLOG_WARN_THRESHOLD,
  Number(process.env.JOB_BACKLOG_CRITICAL_THRESHOLD || 500)
);
const isKickDisabled = () =>
  TRUE_VALUES.has(String(process.env.JOB_WORKER_DISABLE_KICK || "").trim().toLowerCase());

const ensureIndexesReady = async () => {
  if (indexesEnsured) return;
  const db = await getDb();
  await ensureJobIndexes(db);
  indexesEnsured = true;
  workerLogger.info("jobs.worker.indexes.ready");
};

export const processNextQueuedJob = async () => {
  await ensureIndexesReady();
  const db = await getDb();
  const job = await claimNextJob(db);
  if (!job) {
    return null;
  }

  const correlationId = ensureCorrelationId(job.correlationId || job._id);
  const logger = workerLogger.child({
    correlationId,
    jobId: job._id,
    jobType: job.type,
    userId: job.userId,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
  });
  const startedAtMs = Date.now();
  logger.info("jobs.worker.job.claimed");

  try {
    const result = await processJob(job, {
      correlationId,
      logger,
    });
    await markJobSucceeded(db, job._id, (result || null) as Record<string, unknown> | null);
    void recordJobMetric({
      correlationId,
      userId: job.userId,
      jobId: job._id,
      jobType: job.type,
      jobStatus: "succeeded",
      durationMs: Date.now() - startedAtMs,
      outcome: "success",
      metadata: {
        attempts: job.attempts,
        maxAttempts: job.maxAttempts,
      },
    });
    logger.info("jobs.worker.job.succeeded", {
      durationMs: Date.now() - startedAtMs,
    });
  } catch (error) {
    const willRetry = job.attempts < job.maxAttempts;
    void recordJobMetric({
      correlationId,
      userId: job.userId,
      jobId: job._id,
      jobType: job.type,
      jobStatus: willRetry ? "retrying" : "failed",
      durationMs: Date.now() - startedAtMs,
      outcome: "error",
      metadata: {
        attempts: job.attempts,
        maxAttempts: job.maxAttempts,
        willRetry,
        error: serializeError(error),
      },
    });
    logger.error("jobs.worker.job.failed", {
      durationMs: Date.now() - startedAtMs,
      willRetry,
      error: serializeError(error),
    });
    await markJobFailed(db, job, error);
  }

  return job._id;
};

export const processQueuedJobs = async (maxJobs = 10) => {
  let processed = 0;
  for (let i = 0; i < maxJobs; i += 1) {
    const jobId = await processNextQueuedJob();
    if (!jobId) {
      break;
    }
    processed += 1;
  }

  const now = Date.now();
  if (now - backlogLastLoggedAt >= BACKLOG_LOG_INTERVAL_MS) {
    backlogLastLoggedAt = now;
    const db = await getDb();
    const snapshot = await getJobQueueSnapshot(db);
    const queuedTotal = snapshot.queuedReady + snapshot.queuedDelayed;
    if (queuedTotal >= BACKLOG_CRITICAL_THRESHOLD) {
      workerLogger.error("jobs.worker.backlog.critical", {
        queuedTotal,
        thresholds: {
          warn: BACKLOG_WARN_THRESHOLD,
          critical: BACKLOG_CRITICAL_THRESHOLD,
        },
        snapshot,
      });
    } else if (queuedTotal >= BACKLOG_WARN_THRESHOLD) {
      workerLogger.warn("jobs.worker.backlog.warn", {
        queuedTotal,
        thresholds: {
          warn: BACKLOG_WARN_THRESHOLD,
          critical: BACKLOG_CRITICAL_THRESHOLD,
        },
        snapshot,
      });
    } else {
      workerLogger.info("jobs.worker.backlog.ok", {
        queuedTotal,
        thresholds: {
          warn: BACKLOG_WARN_THRESHOLD,
          critical: BACKLOG_CRITICAL_THRESHOLD,
        },
        snapshot,
      });
    }
  }

  return processed;
};

export const kickJobWorker = async () => {
  if (isKickDisabled()) {
    return;
  }
  if (kickInFlight) return;
  kickInFlight = true;
  try {
    await processQueuedJobs(1);
  } catch (error) {
    workerLogger.error("jobs.worker.kick.failed", {
      error: serializeError(error),
    });
  } finally {
    kickInFlight = false;
  }
};
