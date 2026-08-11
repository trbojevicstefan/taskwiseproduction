import { NextResponse } from "next/server";
import { z } from "zod";
import {
  apiError,
  createRouteRequestContext,
  getApiErrorStatus,
  mapApiError,
} from "@/lib/api-route";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { normalizeTask } from "@/lib/data";
import { syncTasksForSource } from "@/lib/task-sync";
import {
  assertChatScopeAccess,
  buildChatSessionVisibilityFilter,
  resolveSessionChatScope,
} from "@/lib/chat-scope";
import { resolveWorkspaceScopeForUser } from "@/lib/workspace-scope";
import { ChatScopeSchema, type ChatScope } from "@/types/general-chat";
import { attachCorrelationIdHeader } from "@/lib/observability";

const ROUTE = "/api/chat-sessions/[id]";

const optionalNullableIdentifierSchema = z
  .string()
  .trim()
  .max(200)
  .transform((value) => value || null)
  .nullable()
  .optional();

const patchScopeFieldsSchema = z
  .object({
    sourceMeetingId: optionalNullableIdentifierSchema,
    scope: ChatScopeSchema.optional(),
  })
  .passthrough();

const serializeSession = (session: any) => ({
  ...session,
  id: session._id,
  _id: undefined,
  createdAt: session.createdAt?.toISOString?.() || session.createdAt,
  lastActivityAt: session.lastActivityAt?.toISOString?.() || session.lastActivityAt,
  memoryUpdatedAt:
    session.memoryUpdatedAt?.toISOString?.() || session.memoryUpdatedAt || null,
});

const collectSessionIds = (session: any, fallbackId?: string | null) => {
  const ids = new Set<string>();
  if (session?._id) ids.add(String(session._id));
  if (session?.id) ids.add(String(session.id));
  if (fallbackId) ids.add(String(fallbackId));
  return Array.from(ids);
};

const cleanupChatTasksForSession = async (db: any, userId: string, session: any) => {
  if (!session) return;
  const sessionIds = collectSessionIds(session);
  if (!sessionIds.length) return;
  await db.collection("tasks").deleteMany({
    userId,
    sourceSessionType: "chat",
    sourceSessionId: { $in: sessionIds },
  });
};

async function patchChatSession(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const userId = await getSessionUserId();
  if (!userId) {
    return apiError(401, "request_error", "Unauthorized");
  }

  const body = await request.json().catch(() => ({}));
  const parsedScopeFields = patchScopeFieldsSchema.safeParse(body);
  if (!parsedScopeFields.success) {
    return apiError(
      400,
      "invalid_payload",
      "Invalid chat session payload.",
      parsedScopeFields.error.flatten()
    );
  }
  const avoidTimestampUpdate = Boolean(body.avoidTimestampUpdate);
  const update = { ...body };
  if (parsedScopeFields.data.sourceMeetingId !== undefined) {
    update.sourceMeetingId = parsedScopeFields.data.sourceMeetingId;
  }
  if (parsedScopeFields.data.scope !== undefined) {
    update.scope = parsedScopeFields.data.scope;
  }
  delete update.avoidTimestampUpdate;
  delete update._id;
  delete update.id;
  delete update.userId;
  delete update.workspaceId;
  delete update.createdAt;
  delete update.memorySummary;
  delete update.memorySummarizedThroughMessageId;
  delete update.memoryUpdatedAt;
  let normalizedTasks: any[] | null = null;
  if (Array.isArray(update.suggestedTasks)) {
    normalizedTasks = update.suggestedTasks.map((task: any) =>
      normalizeTask(task)
    );
    update.suggestedTasks = normalizedTasks;
  }

  if (!avoidTimestampUpdate) {
    update.lastActivityAt = new Date();
  }

  const db = await getDb();
  const { workspaceId, workspaceMemberUserIds } =
    await resolveWorkspaceScopeForUser(db, userId, {
      minimumRole: "member",
      adminVisibilityKey: "chatSessions",
      includeMemberUserIds: true,
    });
  const visibilityFilter = buildChatSessionVisibilityFilter({
    workspaceId,
    userId,
    memberUserIds: workspaceMemberUserIds,
  });
  const filter = {
    $and: [{ $or: [{ _id: id }, { id }] }, visibilityFilter],
  };
  // Fetch session first to get context for sync
  const getCurrent = await db.collection("chatSessions").findOne(filter);
  if (!getCurrent) {
    return apiError(404, "request_error", "Chat session not found.");
  }
  const effectiveSourceMeetingId =
    update.sourceMeetingId !== undefined
      ? update.sourceMeetingId
      : getCurrent.sourceMeetingId;
  const requestedScope = resolveSessionChatScope(
    (update.scope as ChatScope | undefined) ?? getCurrent.scope,
    effectiveSourceMeetingId
  );
  const scope = await assertChatScopeAccess({
    db,
    userId,
    workspaceId,
    memberUserIds: workspaceMemberUserIds,
    scope: requestedScope,
  });
  update.scope = scope;
  update.sourceMeetingId =
    scope.type === "meeting" ? scope.meetingId : effectiveSourceMeetingId ?? null;
  const sessionTitle = getCurrent?.title || body.title || "Chat Session";
  const sourceMeetingId = update.sourceMeetingId;
  const sessionOwnerUserId = String(getCurrent.userId || userId);

  if (normalizedTasks) {
    try {
      const isLinkedToMeeting = !!sourceMeetingId;
      const targetSessionId = isLinkedToMeeting ? String(sourceMeetingId) : id;
      const targetSessionType = isLinkedToMeeting ? "meeting" : "chat";
      // If linked, we effectively treat these as meeting tasks (origin: meeting/chat mixed, but context is meeting tasks)
      // Actually 'origin' tracks creation source. If created in chat, origin should be 'chat'.
      // But 'sourceSessionId' is meeting. 

      const syncResult = await syncTasksForSource(db, normalizedTasks, {
        userId: sessionOwnerUserId,
        sourceSessionId: targetSessionId,
        sourceSessionType: targetSessionType,
        sourceSessionName: isLinkedToMeeting ? "Meeting" : sessionTitle, // Fetch meeting title? 
        // Logic: if we are updating meeting tasks, label them as such for consistency, or keep 'chat' to know they came from chat?
        // Let's keep 'origin' as 'chat' to know they were modified/created via Chat.
        origin: "chat",
        taskState: "active",
      });

      // Convert to references
      const referencedTasks = normalizedTasks.map((task: any) => {
        const canonicalId = syncResult.taskMap.get(task.id);
        return canonicalId
          ? {
            taskId: canonicalId,
            sourceTaskId: task.id,
            title: task.title,
            // Status is dynamic
          }
          : task;
      });
      update.suggestedTasks = referencedTasks;

      // Update meeting if linked
      if (sourceMeetingId) {
        const meetingId = String(sourceMeetingId);
        const meetingFilter = {
          userId: sessionOwnerUserId,
          $or: [{ _id: meetingId }, { id: meetingId }],
        };
        // Update meeting with the SAME references (since they share the task list in this context)
        await db.collection("meetings").updateOne(meetingFilter, {
          $set: { extractedTasks: referencedTasks }, // Update lastActivity? Maybe not to avoid noise
        });

        // We do NOT sync tasks for meeting again, because we just synced them for chat. 
        // Syncing them for meeting would change 'origin' to meeting?
        // If we want them to show up as 'meeting' tasks, we should maybe sync for meeting?
        // But the user is editing the CHAT. So 'chat' origin is correct for the edit.
        // The meeting view will reference the canonical tasks.
      }
    } catch {
      console.error("Failed to sync chat tasks after updating a session.");
    }
  }

  // Update the chat session with references
  await db.collection("chatSessions").updateOne(filter, { $set: update });

  const session = await db.collection("chatSessions").findOne(filter);

  if (session?.sourceMeetingId) {
    await cleanupChatTasksForSession(db, sessionOwnerUserId, session);
  }
  return NextResponse.json(serializeSession(session));
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const routeContext = createRouteRequestContext({
    request,
    route: ROUTE,
    method: "PATCH",
  });
  const { correlationId, logger, durationMs, emitMetric } = routeContext;

  try {
    const response = await patchChatSession(request, context);
    emitMetric(response.status, response.ok ? "success" : "error");
    return attachCorrelationIdHeader(response, correlationId);
  } catch (error) {
    const statusCode = getApiErrorStatus(error);
    emitMetric(statusCode, "error");
    return mapApiError(error, "Failed to update chat session.", {
      correlationId,
      logger,
      context: {
        route: ROUTE,
        method: "PATCH",
        durationMs: durationMs(),
      },
    });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const userId = await getSessionUserId();
  if (!userId) {
    return apiError(401, "request_error", "Unauthorized");
  }

  const db = await getDb();
  const { workspaceId, workspaceMemberUserIds } =
    await resolveWorkspaceScopeForUser(db, userId, {
      minimumRole: "member",
      adminVisibilityKey: "chatSessions",
      includeMemberUserIds: true,
    });
  const visibilityFilter = buildChatSessionVisibilityFilter({
    workspaceId,
    userId,
    memberUserIds: workspaceMemberUserIds,
  });
  const filter = {
    $and: [{ $or: [{ _id: id }, { id }] }, visibilityFilter],
  };
  const result = await db
    .collection("chatSessions")
    .deleteOne(filter);
  if (!result.deletedCount) {
    return apiError(404, "request_error", "Chat session not found.");
  }

  return NextResponse.json({ ok: true });
}
