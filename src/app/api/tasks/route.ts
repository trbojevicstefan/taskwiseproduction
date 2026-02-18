import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  apiError,
  createRouteRequestContext,
  getApiErrorStatus,
  mapApiError,
  parseJsonBody,
} from "@/lib/api-route";
import { getDb } from "@/lib/db";
import { attachCorrelationIdHeader } from "@/lib/observability";
import { getSessionUserId } from "@/lib/server-auth";
import { normalizePersonNameKey } from "@/lib/transcript-utils";
import { getWorkspaceIdForUser } from "@/lib/workspace";
import { TASK_LIST_PROJECTION } from "@/lib/task-projections";
import { assertWorkspaceAccess, ensureWorkspaceBootstrapForUser } from "@/lib/workspace-context";
import { isWorkspaceMembershipGuardEnabled } from "@/lib/workspace-flags";

const ROUTE = "/api/tasks";

const createTaskSchema = z
  .object({
    title: z.string().optional(),
    description: z.string().optional(),
    status: z.string().optional(),
    priority: z.string().optional(),
    dueAt: z.any().optional(),
    assignee: z.any().optional(),
    assigneeName: z.string().nullable().optional(),
    aiSuggested: z.boolean().optional(),
    origin: z.string().optional(),
    projectId: z.string().nullable().optional(),
    workspaceId: z.string().optional(),
    parentId: z.string().nullable().optional(),
    order: z.number().optional(),
    subtaskCount: z.number().optional(),
    sourceSessionId: z.string().nullable().optional(),
    sourceSessionName: z.string().nullable().optional(),
    sourceSessionType: z.string().optional(),
    sourceTaskId: z.string().nullable().optional(),
    taskState: z.string().optional(),
    researchBrief: z.any().nullable().optional(),
    aiAssistanceText: z.any().nullable().optional(),
  })
  .passthrough();

const serializeTask = (task: any) => ({
  ...task,
  id: task._id,
  _id: undefined,
  createdAt: task.createdAt?.toISOString?.() || task.createdAt,
  lastUpdated: task.lastUpdated?.toISOString?.() || task.lastUpdated,
});

const MAX_TASKS_PAGE_SIZE = 200;
const MAX_TASKS_LEGACY_LIMIT = 1000;
const DEFAULT_TASKS_PAGE_LIMIT = 50;
const DEFAULT_TASKS_LEGACY_LIMIT = 500;

const parsePositiveInt = (
  value: string | null,
  fallback: number,
  max: number
) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.floor(parsed);
  if (rounded < 1) return fallback;
  return Math.min(max, rounded);
};

const encodeTaskCursor = (lastUpdated: unknown, id: string) => {
  const ts =
    lastUpdated instanceof Date
      ? lastUpdated.toISOString()
      : new Date(lastUpdated as any).toISOString();
  return Buffer.from(JSON.stringify({ ts, id }), "utf8").toString("base64url");
};

const decodeTaskCursor = (cursor: string | null) => {
  if (!cursor) return null;
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    const parsed = JSON.parse(decoded) as { ts?: string; id?: string };
    if (!parsed?.ts || !parsed?.id) return null;
    const date = new Date(parsed.ts);
    if (Number.isNaN(date.getTime())) return null;
    return { date, id: String(parsed.id) };
  } catch {
    return null;
  }
};

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
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId");
    const parentId = searchParams.get("parentId");
    const includeSuggested = searchParams.get("includeSuggested") === "true";
    const paginateRequested =
      searchParams.get("paginate") === "1" ||
      searchParams.get("paginate") === "true";
    const limit = parsePositiveInt(
      searchParams.get("limit"),
      paginateRequested ? DEFAULT_TASKS_PAGE_LIMIT : DEFAULT_TASKS_LEGACY_LIMIT,
      paginateRequested ? MAX_TASKS_PAGE_SIZE : MAX_TASKS_LEGACY_LIMIT
    );
    const cursor = decodeTaskCursor(searchParams.get("cursor"));
    const filters: Record<string, any> = { userId };
    if (workspaceId) {
      if (isWorkspaceMembershipGuardEnabled()) {
        await ensureWorkspaceBootstrapForUser(db, userId);
        await assertWorkspaceAccess(db, userId, workspaceId, "member");
      }
      filters.workspaceId = workspaceId;
    }
    if (parentId) {
      filters.parentId = parentId;
    }
    if (!includeSuggested) {
      filters.taskState = { $ne: "archived" };
    }
    if (paginateRequested && cursor) {
      filters.$or = [
        { lastUpdated: { $lt: cursor.date } },
        { lastUpdated: cursor.date, _id: { $lt: cursor.id } },
      ];
    }

    if (!paginateRequested) {
      const tasks = await db
        .collection("tasks")
        .find(filters)
        .project(TASK_LIST_PROJECTION)
        .sort({ projectId: 1, parentId: 1, order: 1, createdAt: 1 })
        .limit(limit)
        .toArray();

      const serialized = tasks.map(serializeTask);
      logger.info("api.request.succeeded", {
        status: 200,
        durationMs: durationMs(),
        paginateRequested: false,
        limit,
        resultCount: serialized.length,
      });
      emitMetric(200, "success", {
        paginateRequested: false,
        limit,
        resultCount: serialized.length,
      });
      return attachCorrelationIdHeader(NextResponse.json(serialized), correlationId);
    }

    const tasks = await db
      .collection("tasks")
      .find(filters)
      .project(TASK_LIST_PROJECTION)
      .sort({ lastUpdated: -1, _id: -1 })
      .limit(limit + 1)
      .toArray();

    const hasMore = tasks.length > limit;
    const pageTasks = tasks.slice(0, limit);
    const serialized = pageTasks.map(serializeTask);
    const lastTask = pageTasks[pageTasks.length - 1];
    const nextCursor =
      hasMore && lastTask
        ? encodeTaskCursor(lastTask.lastUpdated, String(lastTask._id))
        : null;

    logger.info("api.request.succeeded", {
      status: 200,
      durationMs: durationMs(),
      paginateRequested: true,
      limit,
      resultCount: serialized.length,
      hasMore,
    });
    emitMetric(200, "success", {
      paginateRequested: true,
      limit,
      resultCount: serialized.length,
      hasMore,
    });
    return attachCorrelationIdHeader(
      NextResponse.json({
        data: serialized,
        hasMore,
        nextCursor,
      }),
      correlationId
    );
  } catch (error) {
    const statusCode = getApiErrorStatus(error);
    emitMetric(statusCode, "error");
    return mapApiError(error, "Failed to fetch tasks.", {
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
      createTaskSchema,
      "Invalid task payload."
    );
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) {
      emitMetric(400, "error", { reason: "missing_title" });
      logger.warn("api.request.invalid", {
        reason: "missing_title",
        durationMs: durationMs(),
      });
      return apiError(400, "request_error", "Task title is required.", undefined, {
        correlationId,
      });
    }

    const now = new Date();
    const assigneeNameKey = body.assigneeName
      ? normalizePersonNameKey(body.assigneeName)
      : body.assignee?.name
      ? normalizePersonNameKey(body.assignee.name)
      : null;

    const db = await getDb();
    const workspaceId =
      typeof body.workspaceId === "string" && body.workspaceId
        ? body.workspaceId.trim()
        : await getWorkspaceIdForUser(db, userId);

    if (!workspaceId) {
      emitMetric(400, "error", { reason: "workspace_missing" });
      return apiError(400, "request_error", "Workspace is not configured.", undefined, {
        correlationId,
      });
    }
    if (isWorkspaceMembershipGuardEnabled()) {
      await ensureWorkspaceBootstrapForUser(db, userId);
      await assertWorkspaceAccess(db, userId, workspaceId, "member");
    }

    const task = {
      _id: randomUUID(),
      title,
      description: body.description || "",
      status: body.status || "todo",
      priority: body.priority || "medium",
      dueAt: body.dueAt ?? null,
      assignee: body.assignee ?? undefined,
      assigneeName: body.assigneeName ?? null,
      assigneeNameKey,
      aiSuggested: body.aiSuggested ?? false,
      origin: body.origin || "manual",
      projectId: body.projectId || null,
      workspaceId,
      userId,
      parentId: body.parentId ?? null,
      order: body.order ?? 0,
      subtaskCount: body.subtaskCount ?? 0,
      sourceSessionId: body.sourceSessionId ?? null,
      sourceSessionName: body.sourceSessionName ?? null,
      sourceSessionType: body.sourceSessionType ?? "task",
      sourceTaskId: body.sourceTaskId ?? null,
      taskState: body.taskState ?? "active",
      researchBrief: body.researchBrief ?? null,
      aiAssistanceText: body.aiAssistanceText ?? null,
      createdAt: now,
      lastUpdated: now,
    };

    await db.collection("tasks").insertOne(task);

    logger.info("api.request.succeeded", {
      status: 200,
      durationMs: durationMs(),
      taskId: task._id,
    });
    emitMetric(200, "success", { taskId: task._id });
    return attachCorrelationIdHeader(
      NextResponse.json(serializeTask(task)),
      correlationId
    );
  } catch (error) {
    const statusCode = getApiErrorStatus(error);
    emitMetric(statusCode, "error");
    return mapApiError(error, "Failed to create task.", {
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

