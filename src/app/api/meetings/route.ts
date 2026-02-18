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
import { runMeetingIngestionCommand } from "@/lib/services/meeting-ingestion-command";
import { getWorkspaceIdForUser } from "@/lib/workspace";
import {
  assertWorkspaceAccess,
  ensureWorkspaceBootstrapForUser,
} from "@/lib/workspace-context";
import { postMeetingAutomationToSlack } from "@/lib/slack-automation";
import type { ExtractedTaskSchema } from "@/types/chat";
import {
  applyCompletionTargets,
  buildCompletionSuggestions,
  mergeCompletionSuggestions,
} from "@/lib/task-completion";

const ROUTE = "/api/meetings";

const createMeetingSchema = z
  .object({
    title: z.string().optional(),
    originalTranscript: z.string().optional(),
    summary: z.string().optional(),
    attendees: z.array(z.any()).optional(),
    extractedTasks: z.array(z.any()).optional(),
    originalAiTasks: z.array(z.any()).optional(),
    originalAllTaskLevels: z.any().nullable().optional(),
    taskRevisions: z.array(z.any()).optional(),
    chatSessionId: z.string().nullable().optional(),
    planningSessionId: z.string().nullable().optional(),
    allTaskLevels: z.any().nullable().optional(),
  })
  .passthrough();

const resolveCompletionMatchThreshold = (user: any) => {
  const value = user?.completionMatchThreshold;
  if (typeof value !== "number" || !Number.isFinite(value)) return 0.6;
  return Math.min(0.95, Math.max(0.4, value));
};

const shouldAutoApproveSuggestion = (
  task: ExtractedTaskSchema,
  minMatchRatio: number
) => {
  if (!task.completionSuggested) return false;
  const confidence =
    typeof task.completionConfidence === "number" &&
      Number.isFinite(task.completionConfidence)
      ? task.completionConfidence
      : null;
  if (confidence === null) return false;
  return confidence >= minMatchRatio;
};

const applyAutoApprovalFlags = (
  tasks: ExtractedTaskSchema[],
  minMatchRatio: number
) => {
  const walk = (items: ExtractedTaskSchema[]): ExtractedTaskSchema[] =>
    items.map((task: any) => {
      const nextTask = {
        ...task,
        subtasks: task.subtasks ? walk(task.subtasks) : task.subtasks,
      };
      if (shouldAutoApproveSuggestion(nextTask, minMatchRatio)) {
        return { ...nextTask, status: "done", completionSuggested: false };
      }
      return nextTask;
    });
  return walk(tasks);
};

const serializeMeeting = (meeting: any) => {
  const { recordingId, recordingIdHash, ...rest } = meeting;
  return {
    ...rest,
    id: meeting._id,
    _id: undefined,
    createdAt: meeting.createdAt?.toISOString?.() || meeting.createdAt,
    lastActivityAt: meeting.lastActivityAt?.toISOString?.() || meeting.lastActivityAt,
  };
};

const MEETING_LIST_PROJECTION = {
  _id: 1,
  id: 1,
  userId: 1,
  workspaceId: 1,
  title: 1,
  summary: 1,
  attendees: 1,
  extractedTasks: 1,
  chatSessionId: 1,
  planningSessionId: 1,
  createdAt: 1,
  lastActivityAt: 1,
  conferenceId: 1,
  calendarEventId: 1,
  recordingUrl: 1,
  shareUrl: 1,
  organizerEmail: 1,
  startTime: 1,
  endTime: 1,
  state: 1,
  ingestSource: 1,
  fathomNotificationReadAt: 1,
  artifacts: 1,
  tags: 1,
  duration: 1,
  overallSentiment: 1,
  speakerActivity: 1,
  meetingMetadata: 1,
} as const;

const MAX_MEETINGS_PAGE_SIZE = 200;
const MAX_MEETINGS_LEGACY_LIMIT = 1000;
const DEFAULT_MEETINGS_PAGE_LIMIT = 50;
const DEFAULT_MEETINGS_LEGACY_LIMIT = 500;

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

const encodeMeetingCursor = (lastActivityAt: unknown, id: string) => {
  const ts = lastActivityAt instanceof Date
    ? lastActivityAt.toISOString()
    : new Date(lastActivityAt as any).toISOString();
  return Buffer.from(JSON.stringify({ ts, id }), "utf8").toString("base64url");
};

const decodeMeetingCursor = (cursor: string | null) => {
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
        ? DEFAULT_MEETINGS_PAGE_LIMIT
        : DEFAULT_MEETINGS_LEGACY_LIMIT,
      paginateRequested ? MAX_MEETINGS_PAGE_SIZE : MAX_MEETINGS_LEGACY_LIMIT
    );
    const cursor = decodeMeetingCursor(searchParams?.get("cursor") || null);

    const db = await getDb();
    await ensureWorkspaceBootstrapForUser(db as any, userId);
    const workspaceId =
      searchParams?.get("workspaceId")?.trim() ||
      (await getWorkspaceIdForUser(db, userId));
    if (!workspaceId) {
      emitMetric(400, "error", { reason: "workspace_missing" });
      return apiError(400, "request_error", "Workspace is not configured.", undefined, {
        correlationId,
      });
    }
    await assertWorkspaceAccess(db as any, userId, workspaceId, "member");

    const baseFilter: Record<string, any> = {
      workspaceId,
      isHidden: { $ne: true },
    };
    if (paginateRequested && cursor) {
      baseFilter.$or = [
        { lastActivityAt: { $lt: cursor.date } },
        { lastActivityAt: cursor.date, _id: { $lt: cursor.id } },
      ];
    }

    const meetings = await db
      .collection("meetings")
      .find(baseFilter, { projection: MEETING_LIST_PROJECTION })
      .sort({ lastActivityAt: -1, _id: -1 })
      .limit(paginateRequested ? limit + 1 : limit)
      .toArray();

    const hasMore = paginateRequested && meetings.length > limit;
    const pageMeetings = paginateRequested ? meetings.slice(0, limit) : meetings;

    if (pageMeetings.length > 0) {
      try {
        const { hydrateTaskReferenceLists } = await import("@/lib/task-hydration");
        const hydratedTaskLists = await hydrateTaskReferenceLists(
          userId,
          pageMeetings.map((meeting: any) =>
            Array.isArray(meeting.extractedTasks) ? meeting.extractedTasks : []
          ),
          { workspaceId }
        );
        pageMeetings.forEach((meeting: any, index: number) => {
          meeting.extractedTasks = hydratedTaskLists[index] || [];
        });
      } catch (error) {
        logger.warn("api.request.partial_hydration_failed", {
          reason: "meeting_task_hydration_failed",
          error: serializeError(error),
          durationMs: durationMs(),
        });
      }
    }

    const serialized = pageMeetings.map(serializeMeeting);
    if (!paginateRequested) {
      logger.info("api.request.succeeded", {
        status: 200,
        durationMs: durationMs(),
        paginateRequested: false,
        limit,
        resultCount: serialized.length,
        workspaceId,
      });
      emitMetric(200, "success", {
        paginateRequested: false,
        limit,
        resultCount: serialized.length,
        workspaceId,
      });
      return attachCorrelationIdHeader(NextResponse.json(serialized), correlationId);
    }

    const lastMeeting = pageMeetings[pageMeetings.length - 1];
    const nextCursor =
      hasMore && lastMeeting
        ? encodeMeetingCursor(lastMeeting.lastActivityAt, String(lastMeeting._id))
        : null;
    logger.info("api.request.succeeded", {
      status: 200,
      durationMs: durationMs(),
      paginateRequested: true,
      limit,
      resultCount: serialized.length,
      hasMore,
      workspaceId,
    });
    emitMetric(200, "success", {
      paginateRequested: true,
      limit,
      resultCount: serialized.length,
      hasMore,
      workspaceId,
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
    return mapApiError(error, "Failed to fetch meetings.", {
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
      createMeetingSchema,
      "Invalid meeting payload."
    );
    const { recordingId, recordingIdHash, ...safeBody } = body || {};
    const now = new Date();
    const db = await getDb();
    const user = await db.collection("users").findOne({
      $or: [{ _id: userId }, { id: userId }],
    });
    const workspaceId = await getWorkspaceIdForUser(db, userId);
    const originalAiTasks = safeBody.originalAiTasks || safeBody.extractedTasks || [];
    const meeting = {
      _id: randomUUID(),
      userId,
      workspaceId,
      title: safeBody.title || "Meeting",
      originalTranscript: safeBody.originalTranscript || "",
      summary: safeBody.summary || "",
      attendees: safeBody.attendees || [],
      extractedTasks: safeBody.extractedTasks || [],
      originalAiTasks,
      originalAllTaskLevels:
        safeBody.originalAllTaskLevels || safeBody.allTaskLevels || null,
      taskRevisions: safeBody.taskRevisions || [],
      chatSessionId: safeBody.chatSessionId ?? null,
      planningSessionId: safeBody.planningSessionId ?? null,
      allTaskLevels: safeBody.allTaskLevels ?? null,
      createdAt: now,
      lastActivityAt: now,
    };

    const transcript =
      typeof meeting.originalTranscript === "string"
        ? meeting.originalTranscript.trim()
        : "";
    if (user && transcript) {
      const completionMatchThreshold = resolveCompletionMatchThreshold(user);
      const completionSuggestions = await buildCompletionSuggestions({
        userId,
        transcript,
        summary: meeting.summary,
        attendees: Array.isArray(meeting.attendees) ? meeting.attendees : [],
        workspaceId,
        requireAttendeeMatch: false,
        minMatchRatio: completionMatchThreshold,
      });
      if (completionSuggestions.length) {
        const mergedTasks = mergeCompletionSuggestions(
          meeting.extractedTasks as ExtractedTaskSchema[],
          completionSuggestions
        );
        const shouldAutoApprove = Boolean(user.autoApproveCompletedTasks);
        meeting.extractedTasks = shouldAutoApprove
          ? applyAutoApprovalFlags(mergedTasks, completionMatchThreshold)
          : mergedTasks;
        if (shouldAutoApprove) {
          const autoApproveSuggestions = completionSuggestions.filter((task: any) =>
            shouldAutoApproveSuggestion(task, completionMatchThreshold)
          );
          if (autoApproveSuggestions.length) {
            await applyCompletionTargets(db, userId, autoApproveSuggestions);
          }
        }
      }
    }

    await db.collection("meetings").insertOne(meeting);

    try {
      await runMeetingIngestionCommand(db, {
        mode: "always-event",
        userId,
        payload: {
          meetingId: String(meeting._id),
          workspaceId,
          title: meeting.title,
          attendees: Array.isArray(meeting.attendees) ? meeting.attendees : [],
          extractedTasks: Array.isArray(meeting.extractedTasks)
            ? (meeting.extractedTasks as ExtractedTaskSchema[])
            : [],
        },
      });
    } catch (error) {
      logger.warn("api.request.side_effect_failed", {
        sideEffect: "meeting_ingestion_command",
        error: serializeError(error),
        durationMs: durationMs(),
      });
    }

    if (user) {
      await postMeetingAutomationToSlack({
        user,
        meetingTitle: meeting.title || "Meeting",
        meetingSummary: meeting.summary || "",
        tasks: (meeting.extractedTasks || []) as ExtractedTaskSchema[],
      });
    }

    logger.info("api.request.succeeded", {
      status: 200,
      durationMs: durationMs(),
      meetingId: meeting._id,
      workspaceId,
    });
    emitMetric(200, "success", {
      meetingId: meeting._id,
      workspaceId,
    });
    return attachCorrelationIdHeader(
      NextResponse.json(serializeMeeting(meeting)),
      correlationId
    );
  } catch (error) {
    const statusCode = getApiErrorStatus(error);
    emitMetric(statusCode, "error");
    return mapApiError(error, "Failed to create meeting.", {
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
