/**
 * Phase 10 — on-demand Slack reminder sweep.
 *
 * POST /api/slack/reminders/sweep {} -> apiSuccess { enrolled, canceledStale,
 * skipped } (plus additive enabled/digestSent).
 *
 * Member+ workspace scope. Runs the sweep inline (enroll open due-dated
 * tasks, cancel stale reminders, maybe send the daily digest) and — while
 * reminders stay enabled — enqueues/refreshes the self-perpetuating sweep job
 * (duplicate-pending guarded inside enqueueReminderSweepJob). Kicks the job
 * worker so any immediately-due send jobs process on request traffic.
 */

import {
  apiError,
  apiSuccess,
  createRouteRequestContext,
  getApiErrorStatus,
  mapApiError,
} from "@/lib/api-route";
import { getDb } from "@/lib/db";
import { kickJobWorker } from "@/lib/jobs/worker";
import { getSessionUserId } from "@/lib/server-auth";
import {
  enqueueReminderSweepJob,
  REMINDER_SWEEP_INTERVAL_MS,
  runReminderSweep,
} from "@/lib/task-reminders";
import { resolveWorkspaceScopeForUser } from "@/lib/workspace-scope";

const ROUTE = "/api/slack/reminders/sweep";

export async function POST(request: Request) {
  const routeContext = createRouteRequestContext({
    request,
    route: ROUTE,
    method: "POST",
  });
  const { correlationId, logger, durationMs, setMetricUserId, emitMetric } =
    routeContext;

  try {
    const userId = await getSessionUserId();
    if (!userId) {
      emitMetric(401, "error", { reason: "unauthorized" });
      logger.warn("api.request.unauthorized", {
        durationMs: durationMs(),
      });
      return apiError(401, "request_error", "Unauthorized", undefined, {
        correlationId,
      });
    }
    setMetricUserId(userId);

    const db = await getDb();
    const { workspaceId } = await resolveWorkspaceScopeForUser(db, userId, {
      minimumRole: "member",
      adminVisibilityKey: "tasks",
    });

    const result = await runReminderSweep(db, {
      workspaceId,
      userId,
      correlationId,
    });

    if (result.enabled) {
      // Keep the periodic loop alive: next sweep in 6h unless one is already
      // pending for this workspace.
      await enqueueReminderSweepJob(db, {
        workspaceId,
        userId,
        correlationId,
        runAt: new Date(Date.now() + REMINDER_SWEEP_INTERVAL_MS),
      });
    }
    void kickJobWorker();

    logger.info("api.request.succeeded", {
      status: 200,
      durationMs: durationMs(),
      enrolled: result.enrolled,
      canceledStale: result.canceledStale,
      skipped: result.skipped,
      enabled: result.enabled,
      digestSent: result.digestSent,
      workspaceId,
    });
    emitMetric(200, "success", {
      enrolled: result.enrolled,
      canceledStale: result.canceledStale,
      skipped: result.skipped,
    });
    return apiSuccess(
      {
        enrolled: result.enrolled,
        canceledStale: result.canceledStale,
        skipped: result.skipped,
        enabled: result.enabled,
        digestSent: result.digestSent,
      },
      { correlationId }
    );
  } catch (error) {
    const statusCode = getApiErrorStatus(error);
    emitMetric(statusCode, "error");
    return mapApiError(error, "Failed to run Slack reminder sweep.", {
      correlationId,
      logger,
      context: {
        route: ROUTE,
        method: "POST",
        durationMs: durationMs(),
      },
    });
  }
}
