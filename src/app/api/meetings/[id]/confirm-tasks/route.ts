import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-route";
import { ensureBoardItemsForTasks } from "@/lib/board-items";
import { ensureDefaultBoard } from "@/lib/boards";
import { getDb } from "@/lib/db";
import { normalizeTask } from "@/lib/data";
import { buildTaskReferenceTree } from "@/lib/meeting-task-references";
import { getSessionUserId } from "@/lib/server-auth";
import {
  cleanupChatTasksForSessions,
  updateLinkedChatSessions,
} from "@/lib/services/session-task-sync";
import { syncTasksForSource } from "@/lib/task-sync";
import { hydrateTaskReferenceLists } from "@/lib/task-hydration";
import { getWorkspaceIdForUser } from "@/lib/workspace";
import {
  assertWorkspaceAccess,
  ensureWorkspaceBootstrapForUser,
} from "@/lib/workspace-context";
import type { ExtractedTaskSchema } from "@/types/chat";

const serializeMeeting = (meeting: any) => ({
  ...meeting,
  id: meeting._id,
  _id: undefined,
  createdAt: meeting.createdAt?.toISOString?.() || meeting.createdAt,
  lastActivityAt: meeting.lastActivityAt?.toISOString?.() || meeting.lastActivityAt,
});

const resolveMeetingAccess = async (db: any, userId: string, id: string) => {
  const lookupFilter = {
    $or: [{ _id: id }, { id }],
  };
  const meeting = await db.collection("meetings").findOne(lookupFilter);
  if (!meeting) return null;

  const workspaceId =
    typeof meeting.workspaceId === "string" ? meeting.workspaceId.trim() : "";
  if (workspaceId) {
    await ensureWorkspaceBootstrapForUser(db as any, userId);
    try {
      await assertWorkspaceAccess(db as any, userId, workspaceId, "member");
    } catch {
      return { accessDenied: true as const };
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
    accessDenied: false as const,
  };
};

const collectSelectedTasks = (
  tasks: ExtractedTaskSchema[],
  selectedIds: Set<string>
) => {
  const selected: ExtractedTaskSchema[] = [];
  const walk = (items: ExtractedTaskSchema[]) => {
    items.forEach((task) => {
      if (selectedIds.has(task.id)) {
        selected.push({ ...task, subtasks: null });
      }
      if (task.subtasks?.length) {
        walk(task.subtasks);
      }
    });
  };
  walk(tasks);
  return selected;
};

const markSelectedTasksConfirmed = (
  tasks: ExtractedTaskSchema[],
  selectedIds: Set<string>,
  reviewedAt: string
) => {
  let confirmed = 0;
  const walk = (items: ExtractedTaskSchema[]): ExtractedTaskSchema[] =>
    items.map((task) => {
      const nextSubtasks = task.subtasks?.length
        ? walk(task.subtasks)
        : task.subtasks;
      if (!selectedIds.has(task.id)) {
        return {
          ...task,
          subtasks: nextSubtasks,
        };
      }
      confirmed += 1;
      return {
        ...task,
        reviewStatus: "confirmed",
        reviewedAt,
        taskState: "active",
        subtasks: nextSubtasks,
      };
    });

  return {
    tasks: walk(tasks),
    confirmed,
  };
};

const hydrateMeetingForResponse = async (
  ownerUserId: string,
  meeting: any,
  workspaceId: string
) => {
  if (!Array.isArray(meeting?.extractedTasks)) return meeting;
  const [hydratedTasks] = await hydrateTaskReferenceLists(
    ownerUserId,
    [meeting.extractedTasks],
    { workspaceId }
  );
  return {
    ...meeting,
    extractedTasks: hydratedTasks || [],
  };
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const userId = await getSessionUserId();
  if (!userId) {
    return apiError(401, "request_error", "Unauthorized");
  }

  const body = await request.json().catch(() => ({}));
  const taskIds = Array.isArray(body?.taskIds)
    ? Array.from(
        new Set<string>(
          body.taskIds
            .map((taskId: unknown) => String(taskId || "").trim())
            .filter((taskId: string) => Boolean(taskId))
        )
      )
    : [];
  const requestedBoardId =
    typeof body?.boardId === "string" && body.boardId.trim()
      ? body.boardId.trim()
      : null;

  if (!taskIds.length) {
    return apiError(400, "request_error", "Select at least one task to approve.");
  }

  const db = await getDb();
  const access = await resolveMeetingAccess(db, userId, id);
  if (!access) {
    return apiError(404, "request_error", "Meeting not found.");
  }
  if (access.accessDenied) {
    return apiError(403, "forbidden", "Forbidden");
  }
  if (access.meeting.isHidden) {
    return apiError(404, "request_error", "Meeting not found.");
  }

  const { meeting, filter, ownerUserId, workspaceId: scopedWorkspaceId } = access;
  const workspaceId =
    scopedWorkspaceId || (await getWorkspaceIdForUser(db, ownerUserId));
  if (!workspaceId) {
    return apiError(400, "request_error", "Workspace is not configured.");
  }

  const [hydratedTasks] = await hydrateTaskReferenceLists(
    ownerUserId,
    [Array.isArray(meeting.extractedTasks) ? meeting.extractedTasks : []],
    { workspaceId }
  );
  const currentTasks = (hydratedTasks || []).map((task) => normalizeTask(task));
  const selectedIds = new Set(taskIds);
  const selectedTasks = collectSelectedTasks(currentTasks, selectedIds);
  if (!selectedTasks.length) {
    return apiError(404, "request_error", "Selected tasks were not found.");
  }

  const now = new Date();
  const reviewedAt = now.toISOString();
  const { tasks: confirmedTasks, confirmed } = markSelectedTasksConfirmed(
    currentTasks,
    selectedIds,
    reviewedAt
  );

  const syncResult = await syncTasksForSource(db, confirmedTasks, {
    userId: ownerUserId,
    workspaceId,
    sourceSessionId: String(meeting._id ?? id),
    sourceSessionType: "meeting",
    sourceSessionName: meeting.title || "Meeting",
    origin: "meeting",
    taskState: "suggested",
  });

  const board = requestedBoardId
    ? { _id: requestedBoardId }
    : await ensureDefaultBoard(db, ownerUserId, workspaceId);
  const boardId = String(board._id);
  const boardResult = await ensureBoardItemsForTasks(db, {
    userId: ownerUserId,
    workspaceId,
    boardId,
    tasks: selectedTasks,
  });

  const referencedTasks = buildTaskReferenceTree(
    confirmedTasks,
    syncResult.taskMap
  );
  await db.collection("meetings").updateOne(filter, {
    $set: {
      extractedTasks: referencedTasks,
      lastActivityAt: now,
    },
  });

  const linkedSessions = await updateLinkedChatSessions(
    db,
    ownerUserId,
    meeting,
    referencedTasks as any
  );
  await cleanupChatTasksForSessions(db, ownerUserId, linkedSessions);

  const updatedMeeting = await db.collection("meetings").findOne(filter);
  const hydratedMeeting = await hydrateMeetingForResponse(
    ownerUserId,
    updatedMeeting || meeting,
    workspaceId
  );

  return NextResponse.json({
    confirmed,
    boardItemsCreated: boardResult.created || 0,
    boardId,
    meeting: serializeMeeting(hydratedMeeting),
  });
}
