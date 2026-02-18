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
import { attachCorrelationIdHeader, serializeError } from "@/lib/observability";
import { getSessionUserId } from "@/lib/server-auth";
import { resolveWorkspaceScopeForUser } from "@/lib/workspace-scope";

const ROUTE = "/api/chat-sessions";

const createChatSessionSchema = z
  .object({
    title: z.string().optional(),
    messages: z.array(z.any()).optional(),
    suggestedTasks: z.array(z.any()).optional(),
    originalAiTasks: z.array(z.any()).optional(),
    originalAllTaskLevels: z.any().nullable().optional(),
    taskRevisions: z.array(z.any()).optional(),
    people: z.array(z.any()).optional(),
    folderId: z.string().nullable().optional(),
    sourceMeetingId: z.string().nullable().optional(),
    allTaskLevels: z.any().nullable().optional(),
  })
  .passthrough();

const serializeSession = (session: any) => ({
  ...session,
  id: session._id,
  _id: undefined,
  createdAt: session.createdAt?.toISOString?.() || session.createdAt,
  lastActivityAt: session.lastActivityAt?.toISOString?.() || session.lastActivityAt,
});

const MAX_CHAT_SESSIONS_PAGE_SIZE = 200;
const MAX_CHAT_SESSIONS_LEGACY_LIMIT = 1000;
const DEFAULT_CHAT_SESSIONS_PAGE_LIMIT = 50;
const DEFAULT_CHAT_SESSIONS_LEGACY_LIMIT = 500;

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

const encodeChatSessionCursor = (lastActivityAt: unknown, id: string) => {
  const ts =
    lastActivityAt instanceof Date
      ? lastActivityAt.toISOString()
      : new Date(lastActivityAt as any).toISOString();
  return Buffer.from(JSON.stringify({ ts, id }), "utf8").toString("base64url");
};

const decodeChatSessionCursor = (cursor: string | null) => {
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

export async function GET(request?: Request) {
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

    const searchParams = request ? new URL(request.url).searchParams : null;
    const paginateRequested =
      searchParams?.get("paginate") === "1" ||
      searchParams?.get("paginate") === "true";
    const limit = parsePositiveInt(
      searchParams?.get("limit") || null,
      paginateRequested
        ? DEFAULT_CHAT_SESSIONS_PAGE_LIMIT
        : DEFAULT_CHAT_SESSIONS_LEGACY_LIMIT,
      paginateRequested ? MAX_CHAT_SESSIONS_PAGE_SIZE : MAX_CHAT_SESSIONS_LEGACY_LIMIT
    );
    const cursor = decodeChatSessionCursor(searchParams?.get("cursor") || null);

    const db = await getDb();
    const { workspaceId, workspaceMemberUserIds } = await resolveWorkspaceScopeForUser(db, userId, {
      minimumRole: "member",
      adminVisibilityKey: "chatSessions",
      includeMemberUserIds: true,
    });
    const filters: Record<string, any> = {
      $or: [
        { workspaceId },
        {
          workspaceId: { $exists: false },
          userId: { $in: workspaceMemberUserIds },
        },
      ],
    };
    if (paginateRequested && cursor) {
      filters.$and = [
        {
          $or: [
            { lastActivityAt: { $lt: cursor.date } },
            { lastActivityAt: cursor.date, _id: { $lt: cursor.id } },
          ],
        },
      ];
    }

    const sessions = await db
      .collection("chatSessions")
      .find(filters)
      .sort({ lastActivityAt: -1, _id: -1 })
      .limit(paginateRequested ? limit + 1 : limit)
      .toArray();
    const hasMore = paginateRequested && sessions.length > limit;
    const pageSessions = paginateRequested ? sessions.slice(0, limit) : sessions;

    if (pageSessions.length > 0) {
      try {
        const { hydrateTaskReferenceLists } = await import("@/lib/task-hydration");
        const hydratedTaskLists = await hydrateTaskReferenceLists(
          userId,
          pageSessions.map((session: any) =>
            Array.isArray(session.suggestedTasks) ? session.suggestedTasks : []
          ),
          { workspaceId }
        );
        pageSessions.forEach((session: any, index: number) => {
          session.suggestedTasks = hydratedTaskLists[index] || [];
        });
      } catch (error) {
        logger.warn("api.request.partial_hydration_failed", {
          reason: "chat_session_task_hydration_failed",
          error: serializeError(error),
          durationMs: durationMs(),
        });
      }
    }

    const serialized = pageSessions.map(serializeSession);
    if (!paginateRequested) {
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

    const lastSession = pageSessions[pageSessions.length - 1];
    const nextCursor =
      hasMore && lastSession
        ? encodeChatSessionCursor(lastSession.lastActivityAt, String(lastSession._id))
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
    return mapApiError(error, "Failed to fetch chat sessions.", {
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
      createChatSessionSchema,
      "Invalid chat session payload."
    );
    const now = new Date();
    const db = await getDb();
    const { workspaceId } = await resolveWorkspaceScopeForUser(db, userId, {
      minimumRole: "member",
    });
    const session = {
      _id: randomUUID(),
      userId,
      workspaceId,
      title: body.title || "New Chat",
      messages: body.messages || [],
      suggestedTasks: body.suggestedTasks || [],
      originalAiTasks: body.originalAiTasks || body.suggestedTasks || [],
      originalAllTaskLevels: body.originalAllTaskLevels || body.allTaskLevels || null,
      taskRevisions: body.taskRevisions || [],
      people: body.people || [],
      folderId: body.folderId ?? null,
      sourceMeetingId: body.sourceMeetingId ?? null,
      allTaskLevels: body.allTaskLevels ?? null,
      createdAt: now,
      lastActivityAt: now,
    };

    await db.collection("chatSessions").insertOne(session);

    // Attach canonical task ids to suggestedTasks when possible
    if (Array.isArray(session.suggestedTasks) && session.suggestedTasks.length) {
      try {
        const normalized = session.suggestedTasks
          .map((task: any) => task.id || task._id || task.sourceTaskId || null)
          .filter(Boolean);
        if (normalized.length) {
          const matches = await db
            .collection("tasks")
            .find({ userId, sourceTaskId: { $in: normalized } })
            .project({ _id: 1, sourceTaskId: 1 })
            .toArray();
          const map = new Map(
            matches.map((result: any) => [String(result.sourceTaskId), String(result._id)])
          );
          const augmented = session.suggestedTasks.map((task: any) => ({
            ...task,
            taskCanonicalId: map.get(task.id) || undefined,
          }));
          await db
            .collection("chatSessions")
            .updateOne({ _id: session._id }, { $set: { suggestedTasks: augmented } });
          session.suggestedTasks = augmented;
        }
      } catch (error) {
        logger.warn("api.request.side_effect_failed", {
          sideEffect: "attach_chat_session_canonical_task_ids",
          error: serializeError(error),
          durationMs: durationMs(),
        });
      }
    }

    logger.info("api.request.succeeded", {
      status: 200,
      durationMs: durationMs(),
      chatSessionId: session._id,
      workspaceId,
    });
    emitMetric(200, "success", {
      chatSessionId: session._id,
      workspaceId,
    });
    return attachCorrelationIdHeader(
      NextResponse.json(serializeSession(session)),
      correlationId
    );
  } catch (error) {
    const statusCode = getApiErrorStatus(error);
    emitMetric(statusCode, "error");
    return mapApiError(error, "Failed to create chat session.", {
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

