import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { buildIdQuery, matchesId } from "@/lib/mongo-id";
import { normalizePersonNameKey } from "@/lib/transcript-utils";
import { syncTasksForSource } from "@/lib/task-sync";
import type { ExtractedTaskSchema } from "@/types/chat";

const serializeTask = (task: any) => ({
  ...task,
  id: task._id,
  _id: undefined,
  createdAt: task.createdAt?.toISOString?.() || task.createdAt,
  lastUpdated: task.lastUpdated?.toISOString?.() || task.lastUpdated,
});

const applyTaskUpdate = (existing: ExtractedTaskSchema, source: any) => {
  const next: ExtractedTaskSchema = { ...existing };
  const setIfDefined = (key: keyof ExtractedTaskSchema, value: any) => {
    if (value !== undefined) {
      (next as any)[key] = value;
    }
  };

  setIfDefined("title", source.title);
  setIfDefined("description", source.description);
  setIfDefined("status", source.status);
  setIfDefined("priority", source.priority);
  setIfDefined("dueAt", source.dueAt ?? null);
  setIfDefined("assignee", source.assignee ?? null);
  setIfDefined("assigneeName", source.assigneeName ?? null);
  setIfDefined("taskType", source.taskType ?? null);
  setIfDefined("sourceEvidence", source.sourceEvidence ?? null);
  setIfDefined("aiProvider", source.aiProvider ?? null);
  setIfDefined("comments", source.comments ?? null);
  setIfDefined("researchBrief", source.researchBrief ?? null);
  setIfDefined("aiAssistanceText", source.aiAssistanceText ?? null);
  setIfDefined("completionSuggested", source.completionSuggested);
  setIfDefined("completionConfidence", source.completionConfidence ?? null);
  setIfDefined("completionEvidence", source.completionEvidence ?? null);
  setIfDefined("completionTargets", source.completionTargets ?? null);
  setIfDefined("sourceSessionId", source.sourceSessionId);
  setIfDefined("sourceSessionName", source.sourceSessionName ?? null);

  return next;
};

const updateTaskInList = (
  tasks: ExtractedTaskSchema[],
  taskRecord: any
) => {
  let updated = false;
  const taskId =
    taskRecord?._id?.toString?.() || taskRecord?.id || taskRecord?.sourceTaskId;

  const nextTasks = tasks.map((task) => {
    let nextTask = task;
    let changed = false;

    if (taskId && task.id === taskId) {
      nextTask = applyTaskUpdate(task, taskRecord);
      changed = true;
      updated = true;
    }

    if (task.subtasks && task.subtasks.length > 0) {
      const result = updateTaskInList(task.subtasks, taskRecord);
      if (result.updated) {
        nextTask = {
          ...nextTask,
          subtasks: result.tasks,
        };
        changed = true;
        updated = true;
      }
    }

    return changed ? nextTask : task;
  });

  return { tasks: nextTasks, updated };
};

const removeTasksFromList = (
  tasks: ExtractedTaskSchema[],
  idsToRemove: Set<string>
) => {
  let updated = false;
  const nextTasks: ExtractedTaskSchema[] = [];

  tasks.forEach((task) => {
    if (idsToRemove.has(task.id)) {
      updated = true;
      return;
    }
    let nextTask = task;
    if (task.subtasks && task.subtasks.length > 0) {
      const result = removeTasksFromList(task.subtasks, idsToRemove);
      if (result.updated) {
        updated = true;
        nextTask = {
          ...task,
          subtasks: result.tasks.length ? result.tasks : null,
        };
      }
    }
    nextTasks.push(nextTask);
  });

  return { tasks: nextTasks, updated };
};

type SessionUpdateResult = {
  updated: boolean;
  session: any;
  tasks: ExtractedTaskSchema[];
};

const collectSessionIds = (session: any, fallbackId?: string | null) => {
  const ids = new Set<string>();
  if (session?._id) ids.add(String(session._id));
  if (session?.id) ids.add(String(session.id));
  if (fallbackId) ids.add(String(fallbackId));
  return Array.from(ids);
};

const collectMeetingIds = (meeting: any, fallbackId?: string | null) =>
  collectSessionIds(meeting, fallbackId);

const updateLinkedChatSessions = async (
  db: any,
  userId: string,
  meeting: any,
  tasks: ExtractedTaskSchema[]
) => {
  const meetingIds = collectMeetingIds(meeting);
  const chatFilters: any[] = [];
  if (meeting?.chatSessionId) {
    const chatId = String(meeting.chatSessionId);
    chatFilters.push({ _id: buildIdQuery(chatId) }, { id: chatId });
  }
  if (meetingIds.length > 0) {
    chatFilters.push({ sourceMeetingId: { $in: meetingIds } });
  }
  if (!chatFilters.length) return [];

  const userIdQuery = buildIdQuery(userId);
  const filter = { userId: userIdQuery, $or: chatFilters };
  const sessions = await db.collection<any>("chatSessions").find(filter).toArray();
  if (!sessions.length) return [];

  await db.collection<any>("chatSessions").updateMany(filter, {
    $set: { suggestedTasks: tasks, lastActivityAt: new Date() },
  });
  return sessions;
};

const cleanupChatTasksForSessions = async (
  db: any,
  userId: string,
  sessions: any[]
) => {
  if (!sessions.length) return;
  const sessionIds = new Set<string>();
  sessions.forEach((session) => {
    if (session?._id) sessionIds.add(String(session._id));
    if (session?.id) sessionIds.add(String(session.id));
  });
  if (!sessionIds.size) return;
  const userIdQuery = buildIdQuery(userId);
  await db.collection<any>("tasks").deleteMany({
    userId: userIdQuery,
    sourceSessionType: "chat",
    sourceSessionId: { $in: Array.from(sessionIds) },
  });
};

const updateMeetingTasks = async (
  db: any,
  userId: string,
  meetingId: string,
  updater: (tasks: ExtractedTaskSchema[]) => { tasks: ExtractedTaskSchema[]; updated: boolean }
) => {
  const userIdQuery = buildIdQuery(userId);
  const sessionIdQuery = buildIdQuery(meetingId);
  const filter = {
    userId: userIdQuery,
    $or: [{ _id: sessionIdQuery }, { id: meetingId }],
  };
  const meeting = await db.collection<any>("meetings").findOne(filter);
  if (!meeting) return null;
  const currentTasks = Array.isArray(meeting.extractedTasks)
    ? meeting.extractedTasks
    : [];
  const result = updater(currentTasks as ExtractedTaskSchema[]);
  if (!result.updated) {
    return { updated: false, session: meeting, tasks: currentTasks as ExtractedTaskSchema[] };
  }
  await db.collection<any>("meetings").updateOne(filter, {
    $set: { extractedTasks: result.tasks, lastActivityAt: new Date() },
  });
  return { updated: true, session: meeting, tasks: result.tasks };
};

const updateChatTasks = async (
  db: any,
  userId: string,
  sessionId: string,
  updater: (tasks: ExtractedTaskSchema[]) => { tasks: ExtractedTaskSchema[]; updated: boolean }
) => {
  const userIdQuery = buildIdQuery(userId);
  const sessionIdQuery = buildIdQuery(sessionId);
  const filter = {
    userId: userIdQuery,
    $or: [{ _id: sessionIdQuery }, { id: sessionId }],
  };
  const session = await db.collection<any>("chatSessions").findOne(filter);
  if (!session) return null;
  const currentTasks = Array.isArray(session.suggestedTasks)
    ? session.suggestedTasks
    : [];
  const result = updater(currentTasks as ExtractedTaskSchema[]);
  if (!result.updated) {
    return { updated: false, session, tasks: currentTasks as ExtractedTaskSchema[] };
  }
  await db.collection<any>("chatSessions").updateOne(filter, {
    $set: { suggestedTasks: result.tasks, lastActivityAt: new Date() },
  });
  return { updated: true, session, tasks: result.tasks };
};

const syncTaskUpdateToSource = async (db: any, userId: string, taskRecord: any) => {
  const sessionId = taskRecord?.sourceSessionId;
  const sessionType = taskRecord?.sourceSessionType;
  if (!sessionId || (sessionType !== "meeting" && sessionType !== "chat")) {
    return;
  }

  if (sessionType === "meeting") {
    const result = await updateMeetingTasks(db, userId, sessionId, (tasks) =>
      updateTaskInList(tasks, taskRecord)
    );
    if (result?.updated) {
      const linkedSessions = await updateLinkedChatSessions(
        db,
        userId,
        result.session,
        result.tasks
      );
      await cleanupChatTasksForSessions(db, userId, linkedSessions);
    }
    return;
  }

  const result = await updateChatTasks(db, userId, sessionId, (tasks) =>
    updateTaskInList(tasks, taskRecord)
  );
  if (result?.updated && result.session?.sourceMeetingId) {
    const meetingId = String(result.session.sourceMeetingId);
    const meetingResult = await updateMeetingTasks(db, userId, meetingId, () => ({
      tasks: result.tasks,
      updated: true,
    }));
    if (meetingResult?.updated) {
      try {
        await syncTasksForSource(db, meetingResult.tasks, {
          userId,
          sourceSessionId: String(
            meetingResult.session?._id ?? meetingResult.session?.id ?? meetingId
          ),
          sourceSessionType: "meeting",
          sourceSessionName:
            meetingResult.session?.title || taskRecord?.sourceSessionName || "Meeting",
          origin: "meeting",
        });
      } catch (error) {
        console.error("Failed to sync meeting tasks after chat update:", error);
      }
      const linkedSessions = await updateLinkedChatSessions(
        db,
        userId,
        meetingResult.session,
        meetingResult.tasks
      );
      await cleanupChatTasksForSessions(db, userId, linkedSessions);
    }
    await cleanupChatTasksForSessions(db, userId, [result.session]);
  }
};

const syncBoardItemsToStatus = async (
  db: any,
  userId: string,
  taskRecord: any,
  nextStatus: string
) => {
  if (!taskRecord?._id || !nextStatus) return;
  const userIdQuery = buildIdQuery(userId);
  const taskId = taskRecord._id?.toString?.() || taskRecord._id;
  const items = await db
    .collection<any>("boardItems")
    .find({ userId: userIdQuery, taskId })
    .toArray();
  if (!items.length) return;

  const boardIds = Array.from(new Set(items.map((item) => String(item.boardId))));
  const statuses = await db
    .collection<any>("boardStatuses")
    .find({
      userId: userIdQuery,
      boardId: { $in: boardIds },
      category: nextStatus,
    })
    .toArray();

  if (!statuses.length) return;

  const statusByBoard = new Map<string, string>();
  statuses.forEach((status) => {
    const boardId = String(status.boardId);
    const statusId = status._id?.toString?.() || status._id;
    statusByBoard.set(boardId, statusId);
  });

  const now = new Date();
  const rankByStatus = new Map<string, number>();
  for (const status of statuses) {
    const boardId = String(status.boardId);
    const statusId = status._id?.toString?.() || status._id;
    const key = `${boardId}:${statusId}`;
    const lastItem = await db
      .collection<any>("boardItems")
      .find({ userId: userIdQuery, boardId, statusId })
      .sort({ rank: -1 })
      .limit(1)
      .toArray();
    const baseRank = typeof lastItem[0]?.rank === "number" ? lastItem[0].rank : 0;
    rankByStatus.set(key, baseRank);
  }

  const operations = items
    .map((item) => {
      const boardId = String(item.boardId);
      const targetStatusId = statusByBoard.get(boardId);
      if (!targetStatusId) return null;
      const key = `${boardId}:${targetStatusId}`;
      const nextRank = (rankByStatus.get(key) || 0) + 1000;
      rankByStatus.set(key, nextRank);
      return {
        updateOne: {
          filter: { _id: item._id },
          update: {
            $set: {
              statusId: targetStatusId,
              rank: nextRank,
              updatedAt: now,
            },
          },
        },
      };
    })
    .filter(Boolean);

  if (operations.length) {
    await db.collection<any>("boardItems").bulkWrite(operations as any[], {
      ordered: false,
    });
  }
};

const syncTaskDeletesToSource = async (
  db: any,
  userId: string,
  taskRecords: any[]
) => {
  const sessions = new Map<
    string,
    { type: "meeting" | "chat"; id: string; ids: Set<string> }
  >();

  taskRecords.forEach((task) => {
    const sessionId = task?.sourceSessionId;
    const sessionType = task?.sourceSessionType;
    if (!sessionId || (sessionType !== "meeting" && sessionType !== "chat")) {
      return;
    }
    const key = `${sessionType}:${sessionId}`;
    if (!sessions.has(key)) {
      sessions.set(key, { type: sessionType, id: sessionId, ids: new Set() });
    }
    const taskId = task?._id?.toString?.() || task?.id || task?.sourceTaskId;
    if (taskId) {
      sessions.get(key)?.ids.add(taskId);
    }
  });

  await Promise.all(
    Array.from(sessions.values()).map(async (session) => {
      const updater = (tasks: ExtractedTaskSchema[]) =>
        removeTasksFromList(tasks, session.ids);
      if (session.type === "meeting") {
        const result = await updateMeetingTasks(db, userId, session.id, updater);
        if (result?.updated) {
          const linkedSessions = await updateLinkedChatSessions(
            db,
            userId,
            result.session,
            result.tasks
          );
          await cleanupChatTasksForSessions(db, userId, linkedSessions);
        }
        return result;
      }

      const result = await updateChatTasks(db, userId, session.id, updater);
      if (result?.updated && result.session?.sourceMeetingId) {
        const meetingId = String(result.session.sourceMeetingId);
        const meetingResult = await updateMeetingTasks(db, userId, meetingId, () => ({
          tasks: result.tasks,
          updated: true,
        }));
        if (meetingResult?.updated) {
          const linkedSessions = await updateLinkedChatSessions(
            db,
            userId,
            meetingResult.session,
            meetingResult.tasks
          );
          await cleanupChatTasksForSessions(db, userId, linkedSessions);
        }
        await cleanupChatTasksForSessions(db, userId, [result.session]);
      }
      return result;
    })
  );
};

const removeTaskFromSession = async (
  db: any,
  userId: string,
  sessionType: "meeting" | "chat" | null,
  sessionId: string | null,
  taskId: string | null
) => {
  if (!sessionType || !sessionId || !taskId) return false;
  const ids = new Set<string>([taskId]);
  if (sessionType === "meeting") {
    const result = await updateMeetingTasks(db, userId, sessionId, (tasks) =>
      removeTasksFromList(tasks, ids)
    );
    if (result?.updated) {
      const linkedSessions = await updateLinkedChatSessions(
        db,
        userId,
        result.session,
        result.tasks
      );
      await cleanupChatTasksForSessions(db, userId, linkedSessions);
      return true;
    }
    return false;
  }
  const result = await updateChatTasks(db, userId, sessionId, (tasks) =>
    removeTasksFromList(tasks, ids)
  );
  if (result?.updated && result.session?.sourceMeetingId) {
    const meetingId = String(result.session.sourceMeetingId);
    const meetingResult = await updateMeetingTasks(db, userId, meetingId, () => ({
      tasks: result.tasks,
      updated: true,
    }));
    if (meetingResult?.updated) {
      const linkedSessions = await updateLinkedChatSessions(
        db,
        userId,
        meetingResult.session,
        meetingResult.tasks
      );
      await cleanupChatTasksForSessions(db, userId, linkedSessions);
    }
    await cleanupChatTasksForSessions(db, userId, [result.session]);
  }
  return Boolean(result?.updated);
};

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const update = { ...body, lastUpdated: new Date() };
  const hasAssigneeName = Object.prototype.hasOwnProperty.call(body, "assigneeName");
  const hasAssignee = Object.prototype.hasOwnProperty.call(body, "assignee");
  if (hasAssigneeName || hasAssignee) {
    const rawName = body.assigneeName || body.assignee?.name || null;
    update.assigneeNameKey = rawName ? normalizePersonNameKey(rawName) : null;
  }
  if (Object.prototype.hasOwnProperty.call(body, "taskState")) {
    update.taskState = body.taskState;
  }

  const db = await getDb();
  const idQuery = buildIdQuery(params.id);
  const userIdQuery = buildIdQuery(userId);
  const filter = {
    userId: userIdQuery,
    $or: [{ _id: idQuery }, { id: params.id }],
  };
  await db.collection<any>("tasks").updateOne(filter, { $set: update });

  const task = await db.collection<any>("tasks").findOne(filter);
  if (!task) {
    return NextResponse.json({ error: "Task not found." }, { status: 404 });
  }
  const nextStatus =
    Object.prototype.hasOwnProperty.call(body, "status") && typeof body.status === "string"
      ? body.status
      : null;
  if (
    nextStatus === "todo" ||
    nextStatus === "inprogress" ||
    nextStatus === "done" ||
    nextStatus === "recurring"
  ) {
    await syncBoardItemsToStatus(db, userId, task, nextStatus);
  }
  await syncTaskUpdateToSource(db, userId, task);
  return NextResponse.json(serializeTask(task));
}

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const sourceSessionId = url.searchParams.get("sourceSessionId");
  const sourceSessionTypeParam = url.searchParams.get("sourceSessionType");
  const sourceTaskId = url.searchParams.get("sourceTaskId");

  const db = await getDb();
  const userIdQuery = buildIdQuery(userId);
  const tasks = await db
    .collection<any>("tasks")
    .find({ userId: userIdQuery })
    .toArray();

  const normalizeTaskId = (value: string) => {
    if (!value) return value;
    if (value.includes(":")) {
      const parts = value.split(":").filter(Boolean);
      return parts.length ? parts[parts.length - 1] : value;
    }
    return value;
  };

  const targetId = normalizeTaskId(params.id);
  const toDelete = new Set<string>();
  toDelete.add(params.id);
  if (targetId && targetId !== params.id) {
    toDelete.add(targetId);
  }
  if (sourceTaskId) {
    toDelete.add(sourceTaskId);
  }

  const normalizeId = (value: any) => {
    if (value?.toString) {
      return value.toString();
    }
    return String(value);
  };

  const findChildren = (parentId: string) => {
    tasks.forEach((task) => {
      if (matchesId(task.parentId, parentId)) {
        const taskId = normalizeId(task._id);
        toDelete.add(taskId);
        findChildren(taskId);
      }
    });
  };

  findChildren(targetId);

  const matchesDeleteSet = (value: any) => {
    if (!value) return false;
    const raw = normalizeId(value);
    const normalized = normalizeTaskId(raw);
    return toDelete.has(raw) || toDelete.has(normalized);
  };

  const tasksToRemove = tasks.filter((task) => matchesDeleteSet(task._id));

  const deleteIds: Array<string | ObjectId> = [];
  toDelete.forEach((id) => {
    deleteIds.push(id);
    if (ObjectId.isValid(id)) {
      try {
        deleteIds.push(new ObjectId(id));
      } catch {
        // Ignore invalid ObjectId conversions.
      }
    }
  });

  const result = await db
    .collection<any>("tasks")
    .deleteMany({ userId: userIdQuery, _id: { $in: deleteIds } });
  if (!result.deletedCount) {
    const fallbackFilter = {
      userId: userIdQuery,
      $or: [
        { _id: buildIdQuery(params.id) },
        { _id: buildIdQuery(targetId) },
        { id: params.id },
        { id: targetId },
        { sourceTaskId: params.id },
        { sourceTaskId: targetId },
        ...(sourceTaskId ? [{ sourceTaskId }] : []),
      ],
    };
    const fallbackTask = await db.collection<any>("tasks").findOne(fallbackFilter);
    if (fallbackTask) {
      await db.collection<any>("tasks").deleteOne({
        userId: userIdQuery,
        _id: buildIdQuery(fallbackTask._id?.toString?.() || fallbackTask._id),
      });
      await syncTaskDeletesToSource(db, userId, [fallbackTask]);
      return NextResponse.json({ ok: true });
    }
  }

  let removedFromSession = false;
  const derivedParts = params.id.split(":");
  const derivedSessionId = derivedParts.length > 1 ? derivedParts[0] : null;
  const derivedTaskId = derivedParts.length > 1 ? derivedParts.slice(1).join(":") : null;
  const sessionType =
    sourceSessionTypeParam === "meeting" || sourceSessionTypeParam === "chat"
      ? (sourceSessionTypeParam as "meeting" | "chat")
      : null;
  const sessionId = sourceSessionId || derivedSessionId;
  const sessionTaskId = sourceTaskId || derivedTaskId || targetId || params.id;

  if (sessionId) {
    if (sessionType) {
      removedFromSession = await removeTaskFromSession(
        db,
        userId,
        sessionType,
        sessionId,
        sessionTaskId
      );
    } else {
      removedFromSession =
        (await removeTaskFromSession(db, userId, "meeting", sessionId, sessionTaskId)) ||
        (await removeTaskFromSession(db, userId, "chat", sessionId, sessionTaskId));
    }
  }

  if (!result.deletedCount && !removedFromSession) {
    return NextResponse.json({ error: "Task not found." }, { status: 404 });
  }

  if (tasksToRemove.length) {
    await syncTaskDeletesToSource(db, userId, tasksToRemove);
  }

  if (toDelete.size) {
    await db.collection<any>("boardItems").deleteMany({
      userId: userIdQuery,
      taskId: { $in: Array.from(toDelete) },
    });
  }
  return NextResponse.json({ ok: true });
}
