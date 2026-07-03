/**
 * Phase 10 — Slack scheduled reminders listing.
 *
 * GET /api/slack/reminders?taskId=<id>&status=<optional>
 * -> apiSuccess { reminders: serialized taskReminders docs }
 *
 * Member+ workspace scope. With taskId, returns that task's reminders
 * (optionally filtered by status). Without taskId, returns the workspace's
 * upcoming scheduled reminders (status defaults to 'scheduled'; every
 * 'scheduled' doc is upcoming by definition — sent/failed/canceled docs flip
 * status), sorted by runAt ascending and capped at 100.
 */

import {
  apiError,
  apiSuccess,
  createRouteRequestContext,
  getApiErrorStatus,
  mapApiError,
} from "@/lib/api-route";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import {
  serializeTaskReminder,
  TASK_REMINDERS_COLLECTION,
} from "@/lib/task-reminders";
import { resolveWorkspaceScopeForUser } from "@/lib/workspace-scope";

const ROUTE = "/api/slack/reminders";

const MAX_REMINDERS = 100;

const VALID_STATUSES = ["scheduled", "sent", "failed", "canceled"] as const;

export async function GET(request: Request) {
  const routeContext = createRouteRequestContext({
    request,
    route: ROUTE,
    method: "GET",
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

    const searchParams = new URL(request.url).searchParams;
    const taskId = (searchParams.get("taskId") || "").trim() || null;
    const statusParam = (searchParams.get("status") || "").trim() || null;
    if (
      statusParam &&
      !VALID_STATUSES.includes(statusParam as (typeof VALID_STATUSES)[number])
    ) {
      emitMetric(400, "error", { reason: "invalid_status" });
      return apiError(
        400,
        "request_error",
        `Invalid status. Expected one of: ${VALID_STATUSES.join(", ")}.`,
        undefined,
        { correlationId }
      );
    }

    const db = await getDb();
    const { workspaceId } = await resolveWorkspaceScopeForUser(db, userId, {
      minimumRole: "member",
      adminVisibilityKey: "tasks",
    });

    const filter: Record<string, unknown> = { workspaceId };
    if (taskId) {
      filter.taskId = taskId;
      if (statusParam) {
        filter.status = statusParam;
      }
    } else {
      // Without a taskId this is the workspace's upcoming-scheduled feed.
      filter.status = statusParam || "scheduled";
    }

    const reminderDocs = await db
      .collection(TASK_REMINDERS_COLLECTION)
      .find(filter)
      .sort({ runAt: 1, _id: 1 })
      .limit(MAX_REMINDERS)
      .toArray();

    const reminders = reminderDocs.map((doc: any) => serializeTaskReminder(doc));

    logger.info("api.request.succeeded", {
      status: 200,
      durationMs: durationMs(),
      reminderCount: reminders.length,
      taskId,
      workspaceId,
    });
    emitMetric(200, "success", { reminderCount: reminders.length });
    return apiSuccess({ reminders }, { correlationId });
  } catch (error) {
    const statusCode = getApiErrorStatus(error);
    emitMetric(statusCode, "error");
    return mapApiError(error, "Failed to fetch Slack reminders.", {
      correlationId,
      logger,
      context: {
        route: ROUTE,
        method: "GET",
        durationMs: durationMs(),
      },
    });
  }
}
