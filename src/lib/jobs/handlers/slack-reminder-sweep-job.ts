import { getDb } from "@/lib/db";
import {
  enqueueReminderSweepJob,
  runReminderSweep,
  REMINDER_SWEEP_INTERVAL_MS,
} from "@/lib/task-reminders";
import {
  createLogger,
  ensureCorrelationId,
  serializeError,
  type StructuredLogger,
} from "@/lib/observability";

/**
 * Periodic reminder sweep for one workspace scope: enrolls open due-dated
 * tasks into reminder instances, cancels stale ones, optionally sends the
 * daily digest, then re-enqueues itself (runAt now + 6h) while reminders stay
 * enabled — guarded against duplicate pending sweeps for the same workspace.
 */
export const runSlackReminderSweepJob = async ({
  userId,
  workspaceId,
  correlationId,
  logger: baseLogger,
}: {
  userId: string;
  workspaceId: string | null;
  correlationId?: string;
  logger?: StructuredLogger;
}) => {
  const resolvedCorrelationId = ensureCorrelationId(correlationId);
  const logger = (baseLogger || createLogger({ scope: "jobs.slack-reminder-sweep" })).child({
    correlationId: resolvedCorrelationId,
    userId,
    workspaceId: workspaceId ?? null,
  });
  const startedAtMs = Date.now();
  logger.info("jobs.slack-reminder-sweep.started");

  const db = await getDb();
  const result = await runReminderSweep(db as any, {
    workspaceId: workspaceId ?? null,
    userId,
    correlationId: resolvedCorrelationId,
  });

  let nextSweepScheduled = false;
  if (result.enabled) {
    try {
      const enqueueResult = await enqueueReminderSweepJob(db as any, {
        workspaceId: workspaceId ?? null,
        userId,
        correlationId: resolvedCorrelationId,
        runAt: new Date(Date.now() + REMINDER_SWEEP_INTERVAL_MS),
      });
      nextSweepScheduled = enqueueResult.enqueued;
    } catch (error) {
      logger.warn("jobs.slack-reminder-sweep.reschedule-failed", {
        error: serializeError(error),
      });
    }
  }

  logger.info("jobs.slack-reminder-sweep.finished", {
    durationMs: Date.now() - startedAtMs,
    enrolled: result.enrolled,
    canceledStale: result.canceledStale,
    skipped: result.skipped,
    enabled: result.enabled,
    digestSent: result.digestSent,
    nextSweepScheduled,
  });
  return {
    workspaceId: workspaceId ?? null,
    enrolled: result.enrolled,
    canceledStale: result.canceledStale,
    skipped: result.skipped,
    enabled: result.enabled,
    digestSent: result.digestSent,
    nextSweepScheduled,
  };
};
