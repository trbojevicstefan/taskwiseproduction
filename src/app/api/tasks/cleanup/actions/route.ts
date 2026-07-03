import { z } from "zod";
import {
  apiError,
  apiSuccess,
  createRouteRequestContext,
  getApiErrorStatus,
  mapApiError,
  parseJsonBody,
} from "@/lib/api-route";
import { getDb } from "@/lib/db";
import { publishDomainEvent } from "@/lib/domain-events";
import { getSessionUserId } from "@/lib/server-auth";
import { resolveWorkspaceScopeForUser } from "@/lib/workspace-scope";

const ROUTE = "/api/tasks/cleanup/actions";

const cleanupActionSchema = z.object({
  action: z.enum([
    "expire",
    "mark_duplicate",
    "mark_completed",
    "dismiss",
    "restore",
  ]),
  taskIds: z.array(z.string().min(1)).min(1).max(100),
});

/**
 * Same fallback semantics the workspace-scoped list routes use, so any
 * workspace member can review cleanup suggestions (not just the creator).
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

    const body = await parseJsonBody(
      request,
      cleanupActionSchema,
      "Invalid cleanup action payload."
    );

    const db = await getDb();
    const { workspaceId, workspaceMemberUserIds } =
      await resolveWorkspaceScopeForUser(db, userId, {
        minimumRole: "member",
        adminVisibilityKey: "tasks",
        includeMemberUserIds: true,
      });

    const scopeFilter = buildScopeFilter(workspaceId, workspaceMemberUserIds);
    const tasksCollection = db.collection("tasks");
    const now = new Date();
    const nowIso = now.toISOString();

    const filter = {
      ...scopeFilter,
      _id: { $in: body.taskIds },
    };

    const reviewFields = {
      cleanupReviewedAt: nowIso,
      cleanupReviewedBy: userId,
      lastUpdated: now,
    };

    let updated = 0;

    switch (body.action) {
      case "expire": {
        const result = await tasksCollection.updateMany(filter, {
          $set: {
            cleanupStatus: "expired",
            ...reviewFields,
          },
        });
        updated = result?.modifiedCount || 0;
        break;
      }
      case "mark_duplicate": {
        // duplicateOfTaskId is intentionally left untouched.
        const result = await tasksCollection.updateMany(filter, {
          $set: {
            cleanupStatus: "expired",
            cleanupCategory: "duplicate",
            ...reviewFields,
          },
        });
        updated = result?.modifiedCount || 0;
        break;
      }
      case "mark_completed": {
        // Fetch the in-scope tasks first so a task.status.changed domain
        // event can be published per task (this keeps board columns in
        // sync). Embedded source-session status mirroring is left to the
        // event pipeline — the /api/tasks/status inline mirroring is not a
        // reusable helper.
        const tasksToComplete = await tasksCollection
          .find(filter, {
            projection: { _id: 1, sourceSessionId: 1, sourceSessionType: 1 },
          })
          .toArray();
        const taskIds = tasksToComplete.map((task: any) => String(task._id));
        if (taskIds.length) {
          const result = await tasksCollection.updateMany(
            { ...scopeFilter, _id: { $in: taskIds } },
            {
              $set: {
                status: "done",
                cleanupStatus: "dismissed",
                ...reviewFields,
              },
            }
          );
          updated = result?.modifiedCount || 0;
          for (const task of tasksToComplete) {
            const sourceSessionType =
              task.sourceSessionType === "meeting" ||
              task.sourceSessionType === "chat"
                ? task.sourceSessionType
                : undefined;
            await publishDomainEvent(db, {
              type: "task.status.changed",
              userId,
              payload: {
                taskId: String(task._id),
                status: "done",
                ...(sourceSessionType
                  ? {
                      sourceSessionType,
                      sourceSessionId: task.sourceSessionId
                        ? String(task.sourceSessionId)
                        : undefined,
                    }
                  : {}),
              },
            });
          }
        }
        break;
      }
      case "dismiss": {
        const result = await tasksCollection.updateMany(filter, {
          $set: {
            cleanupStatus: "dismissed",
            ...reviewFields,
          },
        });
        updated = result?.modifiedCount || 0;
        break;
      }
      case "restore": {
        const result = await tasksCollection.updateMany(filter, {
          $set: {
            cleanupStatus: "active",
            expiresAt: null,
            ...reviewFields,
          },
        });
        updated = result?.modifiedCount || 0;
        break;
      }
    }

    logger.info("api.request.succeeded", {
      status: 200,
      durationMs: durationMs(),
      action: body.action,
      requestedCount: body.taskIds.length,
      updated,
    });
    emitMetric(200, "success", {
      action: body.action,
      requestedCount: body.taskIds.length,
      updated,
    });
    return apiSuccess({ updated }, { correlationId });
  } catch (error) {
    const statusCode = getApiErrorStatus(error);
    emitMetric(statusCode, "error");
    return mapApiError(error, "Failed to apply cleanup action.", {
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
