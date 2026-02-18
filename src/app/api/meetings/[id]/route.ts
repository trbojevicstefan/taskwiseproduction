import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-route";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { normalizeTask } from "@/lib/data";
import { syncTasksForSource } from "@/lib/task-sync";
import { ensureBoardItemsForTasks } from "@/lib/board-items";
import { ensureDefaultBoard } from "@/lib/boards";
import {
  cleanupChatTasksForSessions,
  updateLinkedChatSessions,
} from "@/lib/services/session-task-sync";
import { getWorkspaceIdForUser } from "@/lib/workspace";
import {
  assertWorkspaceAccess,
  ensureWorkspaceBootstrapForUser,
} from "@/lib/workspace-context";
import type { ExtractedTaskSchema } from "@/types/chat";

const serializeMeeting = (meeting: any) => {
  const rest = { ...meeting };
  delete rest.recordingId;
  delete rest.recordingIdHash;
  return {
    ...rest,
    id: meeting._id,
    _id: undefined,
    createdAt: meeting.createdAt?.toISOString?.() || meeting.createdAt,
    lastActivityAt: meeting.lastActivityAt?.toISOString?.() || meeting.lastActivityAt,
  };
};

const ACTIVITY_KEYS = new Set([
  "artifacts",
  "recordingId",
  "recordingIdHash",
  "originalTranscript",
  "summary",
  "meetingMetadata",
  "startTime",
  "endTime",
  "duration",
  "state",
  "tags",
]);

const shouldRefreshLastActivity = (payload: Record<string, any> | null) => {
  if (!payload) return false;
  // Only consider explicit meeting-level activity keys for touching lastActivityAt.
  return Array.from(ACTIVITY_KEYS).some((key: any) =>
    Object.prototype.hasOwnProperty.call(payload, key)
  );
};

const collectDescendantTaskIds = async (
  db: any,
  userId: string,
  parentIds: string[]
) => {
  const allIds = new Set<string>(parentIds);
  const queue = [...parentIds];

  while (queue.length > 0) {
    const batch = queue.splice(0, 200);
    const children = await db
      .collection("tasks")
      .find({
        userId,
        parentId: { $in: batch },
      })
      .project({ _id: 1 })
      .toArray();

    children.forEach((child: any) => {
      const childId = String(child._id);
      if (!allIds.has(childId)) {
        allIds.add(childId);
        queue.push(childId);
      }
    });
  }

  return Array.from(allIds);
};

const resolveMeetingAccess = async (db: any, userId: string, id: string) => {
  const lookupFilter = {
    $or: [{ _id: id }, { id }],
  };

  const meeting = await db.collection("meetings").findOne(lookupFilter);
  if (!meeting) {
    return null;
  }

  const workspaceId =
    typeof meeting.workspaceId === "string" ? meeting.workspaceId.trim() : "";
  if (workspaceId) {
    await ensureWorkspaceBootstrapForUser(db as any, userId);
    try {
      await assertWorkspaceAccess(db as any, userId, workspaceId, "member");
    } catch {
      return null;
    }
  } else if (meeting.userId !== userId) {
    return null;
  }

  const ownerUserId =
    typeof meeting.userId === "string" && meeting.userId.trim()
      ? meeting.userId.trim()
      : userId;

  return {
    meeting,
    workspaceId,
    ownerUserId,
    filter: meeting?._id ? { _id: meeting._id } : lookupFilter,
  };
};

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const userId = await getSessionUserId();
  if (!userId) {
    return apiError(401, "request_error", "Unauthorized");
  }

  const body = await request.json().catch(() => ({}));
  const safeBody: Record<string, any> =
    body && typeof body === "object"
      ? Object.fromEntries(
          Object.entries(body).filter(
            ([key]) => key !== "recordingId" && key !== "recordingIdHash"
          )
        )
      : {};
  const update: Record<string, any> = { ...safeBody };
  let extractedTasks: ExtractedTaskSchema[] | null = null;
  if (Array.isArray(safeBody.extractedTasks)) {
    extractedTasks = safeBody.extractedTasks.map((task: ExtractedTaskSchema) =>
      normalizeTask(task)
    );
    update.extractedTasks = extractedTasks;
  }
  if (shouldRefreshLastActivity(safeBody)) {
    update.lastActivityAt = new Date();
  }

  const db = await getDb();
  const access = await resolveMeetingAccess(db, userId, id);
  if (!access || access.meeting.isHidden) {
    return apiError(404, "request_error", "Meeting not found");
  }
  const { meeting, filter, workspaceId: scopedWorkspaceId, ownerUserId } = access;

  if (extractedTasks) {
    try {
      const workspaceId =
        scopedWorkspaceId || (await getWorkspaceIdForUser(db, ownerUserId));
      const syncResult = await syncTasksForSource(db, extractedTasks, {
        userId: ownerUserId,
        workspaceId,
        sourceSessionId: String(meeting._id ?? id),
        sourceSessionType: "meeting",
        sourceSessionName: meeting.title || body.title || "Meeting",
        origin: "meeting",
        taskState: "active",
      });

      // Convert to references
      const referencedTasks = extractedTasks.map((task: any) => {
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
      update.extractedTasks = referencedTasks;

      // Update the meeting with references
      await db.collection("meetings").updateOne(filter, { $set: update });

      if (meeting) {
        // We pass the FULL objects (extractedTasks) to updateLinkedChatSessions if it expects full objects.
        // But if we want chat sessions to be references too, updateLinkedChatSessions should handle it?
        // Let's assume updateLinkedChatSessions copies. If we pass references, it copies references.
        // If we want chat to have references, we should pass referencedTasks.
        const linkedSessions = await updateLinkedChatSessions(
          db,
          ownerUserId,
          meeting,
          referencedTasks as any // Ensure compatibility
        );
        await cleanupChatTasksForSessions(db, ownerUserId, linkedSessions);
      }
      if (workspaceId) {
        const defaultBoard = await ensureDefaultBoard(db, ownerUserId, workspaceId);
        await ensureBoardItemsForTasks(db, {
          userId: ownerUserId,
          workspaceId,
          boardId: String(defaultBoard._id),
          tasks: extractedTasks, // Board likely needs full info? Or syncTasksForSource handled it?
          // syncTasksForSource handled updating tasks collection.
          // ensureBoardItemsForTasks likely reads tasks? Or uses the array passed?
          // It likely uses array passed. So pass FULL extractedTasks.
        });
      }
    } catch (error) {
      console.error("Failed to sync meeting tasks after update:", error);
      // Fallback update if sync failed
      await db.collection("meetings").updateOne(filter, { $set: update });
    }
  } else {
    await db.collection("meetings").updateOne(filter, { $set: update });
  }

  // Re-fetch to return the definitive updated document? OR just patch local object
  const updatedMeeting = await db.collection("meetings").findOne(filter);
  return NextResponse.json(serializeMeeting(updatedMeeting || meeting));
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const userId = await getSessionUserId();
  if (!userId) {
    return apiError(401, "request_error", "Unauthorized");
  }

  const db = await getDb();
  const access = await resolveMeetingAccess(db, userId, id);
  if (!access || access.meeting.isHidden) {
    return apiError(404, "request_error", "Meeting not found.");
  }
  const { meeting, workspaceId } = access;

  // Hydrate tasks from canonical collection
  if (meeting.extractedTasks && Array.isArray(meeting.extractedTasks)) {
    try {
      const { hydrateTaskReferenceLists } = await import("@/lib/task-hydration");
      const taskLists = [
        Array.isArray(meeting.extractedTasks) ? meeting.extractedTasks : [],
        Array.isArray(meeting.allTaskLevels?.light)
          ? meeting.allTaskLevels.light
          : [],
        Array.isArray(meeting.allTaskLevels?.medium)
          ? meeting.allTaskLevels.medium
          : [],
        Array.isArray(meeting.allTaskLevels?.detailed)
          ? meeting.allTaskLevels.detailed
          : [],
      ];
      const [
        hydratedExtracted,
        hydratedLight,
        hydratedMedium,
        hydratedDetailed,
      ] = await hydrateTaskReferenceLists(
        userId,
        taskLists,
        workspaceId ? { workspaceId } : undefined
      );

      meeting.extractedTasks = hydratedExtracted || [];
      if (meeting.allTaskLevels) {
        meeting.allTaskLevels.light = hydratedLight || [];
        meeting.allTaskLevels.medium = hydratedMedium || [];
        meeting.allTaskLevels.detailed = hydratedDetailed || [];
      }
    } catch (error) {
      console.error("Failed to hydrate meeting tasks:", error);
      // Fallback to existing data if hydration fails
    }
  }

  return NextResponse.json(serializeMeeting(meeting));
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
  const access = await resolveMeetingAccess(db, userId, id);
  if (!access || access.meeting.isHidden) {
    return apiError(404, "request_error", "Meeting not found.");
  }
  const { meeting, filter, ownerUserId } = access;
  const now = new Date();
  const sessionIds = new Set<string>();
  if (meeting?._id) sessionIds.add(String(meeting._id));
  if (meeting?.id) sessionIds.add(String(meeting.id));
  sessionIds.add(String(id));
  const chatSessionIds = new Set<string>();
  if (meeting?.chatSessionId) {
    chatSessionIds.add(String(meeting.chatSessionId));
  }

  await db.collection("meetings").updateOne(filter, {
    $set: {
      isHidden: true,
      hiddenAt: now,
      lastActivityAt: now,
      extractedTasks: [],
    },
  });

  if (sessionIds.size > 0) {
    const sessionIdList = Array.from(sessionIds);
    const tasksToRemove = await db
      .collection("tasks")
      .find({
        userId: ownerUserId,
        sourceSessionType: "meeting",
        sourceSessionId: { $in: sessionIdList },
      })
      .project({ _id: 1 })
      .toArray();
    const rootTaskIds = tasksToRemove.map((task: any) => String(task._id));
    const taskIds = await collectDescendantTaskIds(db, ownerUserId, rootTaskIds);

    await db.collection("tasks").deleteMany({
      userId: ownerUserId,
      _id: { $in: taskIds },
    });

    if (taskIds.length) {
      await db.collection("boardItems").deleteMany({
        userId: ownerUserId,
        taskId: { $in: taskIds },
      });
    }
  }

  const chatMeetingIds = Array.from(sessionIds);
  const chatIds = Array.from(chatSessionIds);
  if (chatMeetingIds.length || chatIds.length) {
    await db.collection("chatSessions").deleteMany({
      userId: ownerUserId,
      $or: [
        chatMeetingIds.length
          ? { sourceMeetingId: { $in: chatMeetingIds } }
          : undefined,
        chatIds.length ? { _id: { $in: chatIds } } : undefined,
        chatIds.length ? { id: { $in: chatIds } } : undefined,
      ].filter(Boolean),
    });
  }

  return NextResponse.json({ ok: true });
}
