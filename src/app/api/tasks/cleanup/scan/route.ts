import {
  apiError,
  apiSuccess,
  createRouteRequestContext,
  getApiErrorStatus,
  mapApiError,
} from "@/lib/api-route";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { runTaskCleanupScan } from "@/lib/task-cleanup";
import { resolveTaskCleanupSettings } from "@/lib/workspace-settings";
import { resolveWorkspaceScopeForUser } from "@/lib/workspace-scope";

const ROUTE = "/api/tasks/cleanup/scan";

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
    const { workspaceId, workspace, workspaceMemberUserIds } =
      await resolveWorkspaceScopeForUser(db, userId, {
        minimumRole: "member",
        adminVisibilityKey: "tasks",
        includeMemberUserIds: true,
      });

    const settings = resolveTaskCleanupSettings(workspace);
    const result = await runTaskCleanupScan(
      db,
      {
        userId,
        workspaceId,
        memberUserIds: workspaceMemberUserIds,
      },
      settings
    );

    logger.info("api.request.succeeded", {
      status: 200,
      durationMs: durationMs(),
      scanned: result.scanned,
      flagged: result.flagged,
      expired: result.expired,
    });
    emitMetric(200, "success", {
      scanned: result.scanned,
      flagged: result.flagged,
      expired: result.expired,
    });
    return apiSuccess(
      {
        scanned: result.scanned,
        flagged: result.flagged,
        expired: result.expired,
        byCategory: result.byCategory,
      },
      { correlationId }
    );
  } catch (error) {
    const statusCode = getApiErrorStatus(error);
    emitMetric(statusCode, "error");
    return mapApiError(error, "Failed to run task cleanup scan.", {
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
