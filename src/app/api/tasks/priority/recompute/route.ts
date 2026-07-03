// src/app/api/tasks/priority/recompute/route.ts
/**
 * Phase 9 — deterministic priority recompute over the workspace's open tasks.
 *
 * POST {} -> apiSuccess { updated, byLabel }
 *
 * Loads the open task window (status != 'done', taskState != 'archived',
 * newest 500), scores every task with the transparent additive scorer in
 * src/lib/task-priority.ts (no LLM), and bulk-writes ONLY the docs whose
 * priorityScore or priorityLabel actually changed, stamping
 * priorityUpdatedAt. Context enrichment:
 *  - clientAssigneeIds: people docs with personType 'client' (_id only),
 *  - assigneeOpenCounts: computed from the loaded open tasks themselves.
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
  computeTaskPriority,
  type TaskPriorityResult,
} from "@/lib/task-priority";
import type { TaskPriorityLabel } from "@/types/chat";
import { resolveWorkspaceScopeForUser } from "@/lib/workspace-scope";

const ROUTE = "/api/tasks/priority/recompute";

const MAX_RECOMPUTE_TASKS = 500;

const RECOMPUTE_TASK_PROJECTION = {
  _id: 1,
  title: 1,
  description: 1,
  status: 1,
  priority: 1,
  dueAt: 1,
  assignee: 1,
  assigneeName: 1,
  createdAt: 1,
  lastUpdated: 1,
  cleanupStatus: 1,
  priorityScore: 1,
  priorityLabel: 1,
} as const;

interface RecomputeScope {
  userId: string;
  workspaceId?: string | null;
  memberUserIds?: string[];
}

/**
 * Same fallback semantics the workspace-scoped list routes (and the cleanup
 * scan) use: docs tagged with the workspace id, plus legacy docs without a
 * workspaceId that belong to a workspace member.
 */
const buildScopeFilter = (scope: RecomputeScope): Record<string, any> => {
  const memberUserIds =
    Array.isArray(scope.memberUserIds) && scope.memberUserIds.length
      ? scope.memberUserIds
      : [scope.userId];
  if (scope.workspaceId) {
    return {
      $or: [
        { workspaceId: scope.workspaceId },
        {
          workspaceId: { $exists: false },
          userId: { $in: memberUserIds },
        },
      ],
    };
  }
  return { userId: { $in: memberUserIds } };
};

/**
 * Open-task counts keyed by every assignee identifier the scorer resolves
 * against (uid, email, and display name), computed from the loaded window.
 */
const buildAssigneeOpenCounts = (tasks: any[]): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const task of tasks) {
    const keys = new Set(
      [task?.assignee?.uid, task?.assignee?.email, task?.assigneeName]
        .filter(Boolean)
        .map((key: any) => String(key))
    );
    keys.forEach((key) => {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
  }
  return counts;
};

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
    const { workspaceId, workspaceMemberUserIds } =
      await resolveWorkspaceScopeForUser(db, userId, {
        minimumRole: "member",
        adminVisibilityKey: "tasks",
        includeMemberUserIds: true,
      });

    const scopeFilter = buildScopeFilter({
      userId,
      workspaceId,
      memberUserIds: workspaceMemberUserIds,
    });
    const tasksCollection = db.collection("tasks");

    const tasks: any[] = await tasksCollection
      .find(
        {
          ...scopeFilter,
          status: { $ne: "done" },
          taskState: { $ne: "archived" },
        },
        { projection: RECOMPUTE_TASK_PROJECTION }
      )
      .sort({ createdAt: -1, _id: -1 })
      .limit(MAX_RECOMPUTE_TASKS)
      .toArray();

    // Client-person ids (client-impact signal) — cheap _id-only fetch.
    const clientAssigneeIds = new Set<string>();
    try {
      const clientPeople: any[] = await db
        .collection("people")
        .find(
          { ...scopeFilter, personType: "client" },
          { projection: { _id: 1 } }
        )
        .toArray();
      clientPeople.forEach((person) =>
        clientAssigneeIds.add(String(person._id))
      );
    } catch (error) {
      logger.warn("tasks.priority.recompute.client_lookup_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const ctx = {
      now,
      clientAssigneeIds,
      assigneeOpenCounts: buildAssigneeOpenCounts(tasks),
    };

    const byLabel: Record<TaskPriorityLabel, number> = {
      low: 0,
      medium: 0,
      high: 0,
      urgent: 0,
    };
    const operations: any[] = [];

    for (const task of tasks) {
      const result: TaskPriorityResult = computeTaskPriority(task, ctx);
      byLabel[result.priorityLabel] += 1;

      // Only write docs whose score/label actually changed.
      if (
        task.priorityScore === result.priorityScore &&
        task.priorityLabel === result.priorityLabel
      ) {
        continue;
      }

      operations.push({
        updateOne: {
          filter: { _id: task._id },
          update: {
            $set: {
              priorityScore: result.priorityScore,
              priorityLabel: result.priorityLabel,
              priorityReason: result.priorityReason,
              priorityUpdatedAt: nowIso,
            },
          },
        },
      });
    }

    if (operations.length) {
      await tasksCollection.bulkWrite(operations, { ordered: false });
    }

    const updated = operations.length;
    logger.info("api.request.succeeded", {
      status: 200,
      durationMs: durationMs(),
      scanned: tasks.length,
      updated,
    });
    emitMetric(200, "success", {
      scanned: tasks.length,
      updated,
    });
    return apiSuccess(
      {
        updated,
        byLabel,
      },
      { correlationId }
    );
  } catch (error) {
    const statusCode = getApiErrorStatus(error);
    emitMetric(statusCode, "error");
    return mapApiError(error, "Failed to recompute task priorities.", {
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
