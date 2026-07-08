import {
  apiError,
  apiSuccess,
  createRouteRequestContext,
  getApiErrorStatus,
  mapApiError,
} from "@/lib/api-route";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { TASK_LIST_PROJECTION } from "@/lib/task-projections";
import { resolveWorkspaceScopeForUser } from "@/lib/workspace-scope";

const ROUTE = "/api/tasks/cleanup/suggestions";

const MAX_BUCKET_SIZE = 100;

const SUGGESTED_CLEANUP_STATUSES = [
  "suggested_expire",
  "duplicate_suggested",
  "completed_suggested",
] as const;

const serializeTask = (task: any) => ({
  ...task,
  id: task._id,
  _id: undefined,
  createdAt: task.createdAt?.toISOString?.() || task.createdAt,
  lastUpdated: task.lastUpdated?.toISOString?.() || task.lastUpdated,
});

/**
 * Same fallback semantics the workspace-scoped list routes use: docs tagged
 * with the workspace id, plus legacy docs without a workspaceId that belong
 * to a workspace member.
 */
const buildScopeFilter = (
  workspaceId: string,
  memberUserIds: string[]
): Record<string, any> => ({
  $or: [
    { workspaceId },
    {
      workspaceId: { $exists: false },
      userId: { $in: memberUserIds },
    },
  ],
});

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

    const db = await getDb();
    const { workspaceId, workspaceMemberUserIds } =
      await resolveWorkspaceScopeForUser(db, userId, {
        minimumRole: "member",
        adminVisibilityKey: "tasks",
        includeMemberUserIds: true,
      });

    const scopeFilter = buildScopeFilter(workspaceId, workspaceMemberUserIds);
    const tasksCollection = db.collection("tasks");

    const suggestionDocs = await tasksCollection
      .find({
        ...scopeFilter,
        cleanupStatus: { $in: [...SUGGESTED_CLEANUP_STATUSES] },
      })
      .project(TASK_LIST_PROJECTION)
      .sort({ lastUpdated: -1, _id: -1 })
      .limit(MAX_BUCKET_SIZE)
      .toArray();

    const expiredDocs = await tasksCollection
      .find({
        ...scopeFilter,
        cleanupStatus: "expired",
      })
      .project(TASK_LIST_PROJECTION)
      .sort({ lastUpdated: -1, _id: -1 })
      .limit(MAX_BUCKET_SIZE)
      .toArray();

    const suggestions = suggestionDocs.map(serializeTask);
    const expired = expiredDocs.map(serializeTask);

    logger.info("api.request.succeeded", {
      status: 200,
      durationMs: durationMs(),
      suggestionCount: suggestions.length,
      expiredCount: expired.length,
    });
    emitMetric(200, "success", {
      suggestionCount: suggestions.length,
      expiredCount: expired.length,
    });
    return apiSuccess({ suggestions, expired }, { correlationId });
  } catch (error) {
    const statusCode = getApiErrorStatus(error);
    emitMetric(statusCode, "error");
    return mapApiError(error, "Failed to fetch cleanup suggestions.", {
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
