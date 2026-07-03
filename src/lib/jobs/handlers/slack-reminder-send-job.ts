import { getDb } from "@/lib/db";
import { sendTaskReminder } from "@/lib/task-reminders";
import {
  createLogger,
  ensureCorrelationId,
  type StructuredLogger,
} from "@/lib/observability";

/**
 * Delivers one scheduled task reminder to Slack. The reminder doc is the
 * source of truth: sendTaskReminder no-ops ('skipped') when the doc is no
 * longer scheduled, so canceled/rescheduled reminders make this job harmless.
 */
export const runSlackReminderSendJob = async ({
  userId,
  reminderId,
  correlationId,
  logger: baseLogger,
}: {
  userId: string;
  reminderId: string;
  correlationId?: string;
  logger?: StructuredLogger;
}) => {
  const resolvedCorrelationId = ensureCorrelationId(correlationId);
  const logger = (baseLogger || createLogger({ scope: "jobs.slack-reminder-send" })).child({
    correlationId: resolvedCorrelationId,
    userId,
    reminderId,
  });
  const startedAtMs = Date.now();
  logger.info("jobs.slack-reminder-send.started");

  const db = await getDb();
  const outcome = await sendTaskReminder(db as any, reminderId);

  logger.info("jobs.slack-reminder-send.finished", {
    outcome,
    durationMs: Date.now() - startedAtMs,
  });
  return { reminderId, outcome };
};
