import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { buildIdQuery } from "@/lib/mongo-id";
import type { ExtractedTaskSchema } from "@/types/chat";

type TaskStatus = "todo" | "inprogress" | "done" | "recurring";

const updateTaskStatus = (
  tasks: ExtractedTaskSchema[],
  taskId: string,
  status: TaskStatus
) => {
  let updated = false;

  const walk = (items: ExtractedTaskSchema[]): ExtractedTaskSchema[] =>
    items.map((task) => {
      let nextTask = task;
      let childUpdated = false;

      if (task.subtasks && task.subtasks.length) {
        const updatedSubtasks = walk(task.subtasks);
        if (updatedSubtasks !== task.subtasks) {
          childUpdated = true;
          nextTask = { ...nextTask, subtasks: updatedSubtasks };
        }
      }

      if (task.id === taskId) {
        updated = true;
        return { ...nextTask, status };
      }

      if (childUpdated) {
        updated = true;
        return nextTask;
      }

      return task;
    });

  const next = walk(tasks);
  return { tasks: next, updated };
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

const updateLinkedChatSessions = async (
  db: any,
  userId: string,
  meeting: any,
  tasks: ExtractedTaskSchema[]
) => {
  const meetingIds = collectSessionIds(meeting);
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
  taskId: string,
  status: TaskStatus,
  options?: { touch?: boolean }
): Promise<SessionUpdateResult | null> => {
  const userIdQuery = buildIdQuery(userId);
  const sessionIdQuery = buildIdQuery(meetingId);
  const filter = {
    userId: userIdQuery,
    $or: [{ _id: sessionIdQuery }, { id: meetingId }],
  };
  const meeting = await db.collection<any>("meetings").findOne(filter);
  if (!meeting) return null;
  const { tasks, updated } = updateTaskStatus(
    meeting.extractedTasks || [],
    taskId,
    status
  );
  if (!updated) {
    return { updated: false, session: meeting, tasks: meeting.extractedTasks || [] };
  }
  const set: any = { extractedTasks: tasks };
  if (options?.touch !== false) {
    set.lastActivityAt = new Date();
  }
  await db.collection<any>("meetings").updateOne(filter, { $set: set });
  return { updated: true, session: meeting, tasks };
};

const updateChatTasks = async (
  db: any,
  userId: string,
  sessionId: string,
  taskId: string,
  status: TaskStatus,
  options?: { touch?: boolean }
): Promise<SessionUpdateResult | null> => {
  const userIdQuery = buildIdQuery(userId);
  const sessionIdQuery = buildIdQuery(sessionId);
  const filter = {
    userId: userIdQuery,
    $or: [{ _id: sessionIdQuery }, { id: sessionId }],
  };
  const session = await db.collection<any>("chatSessions").findOne(filter);
  if (!session) return null;
  const { tasks, updated } = updateTaskStatus(
    session.suggestedTasks || [],
    taskId,
    status
  );
  if (!updated) {
    return { updated: false, session, tasks: session.suggestedTasks || [] };
  }
  const set: any = { suggestedTasks: tasks };
  if (options?.touch !== false) {
    set.lastActivityAt = new Date();
  }
  await db.collection<any>("chatSessions").updateOne(filter, { $set: set });
  return { updated: true, session, tasks };
};

const syncBoardItemsToStatus = async (
  db: any,
  userId: string,
  taskRecord: any,
  nextStatus: TaskStatus
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

export async function PATCH(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const { sourceSessionId, sourceSessionType, taskId, status } = body || {};

  if (!sourceSessionId || !sourceSessionType || !taskId || !status) {
    return NextResponse.json(
      { error: "Missing required fields." },
      { status: 400 }
    );
  }

  const normalizedStatus = status as TaskStatus;
  if (!["todo", "inprogress", "done", "recurring"].includes(normalizedStatus)) {
    return NextResponse.json(
      { error: "Invalid status value." },
      { status: 400 }
    );
  }

  const db = await getDb();
  const userIdQuery = buildIdQuery(userId);

  if (sourceSessionType === "meeting") {
    const result = await updateMeetingTasks(
      db,
      userId,
      sourceSessionId,
      taskId,
      normalizedStatus,
      { touch: false }
    );
    if (!result?.updated) {
      return NextResponse.json({ error: "Task not found." }, { status: 404 });
    }
    await db.collection<any>("tasks").updateOne(
      {
        userId: userIdQuery,
        sourceSessionType: "meeting",
        $or: [{ _id: taskId }, { sourceTaskId: taskId }],
      },
      { $set: { status: normalizedStatus, lastUpdated: new Date() } }
    );
    const meetingTasks = await db
      .collection<any>("tasks")
      .find({
        userId: userIdQuery,
        sourceSessionType: "meeting",
        $or: [{ _id: buildIdQuery(taskId) }, { sourceTaskId: taskId }],
      })
      .toArray();
    await Promise.all(
      meetingTasks.map((task) =>
        syncBoardItemsToStatus(db, userId, task, normalizedStatus)
      )
    );
    const linkedSessions = await updateLinkedChatSessions(
      db,
      userId,
      result.session,
      result.tasks
    );
    await cleanupChatTasksForSessions(db, userId, linkedSessions);
    return NextResponse.json({ ok: true });
  }

  if (sourceSessionType === "chat") {
    const result = await updateChatTasks(
      db,
      userId,
      sourceSessionId,
      taskId,
      normalizedStatus
    );
    if (!result?.updated) {
      return NextResponse.json({ error: "Task not found." }, { status: 404 });
    }
    await db.collection<any>("tasks").updateOne(
      {
        userId: userIdQuery,
        sourceSessionType: "chat",
        $or: [{ _id: taskId }, { sourceTaskId: taskId }],
      },
      { $set: { status: normalizedStatus, lastUpdated: new Date() } }
    );
    const chatTasks = await db
      .collection<any>("tasks")
      .find({
        userId: userIdQuery,
        sourceSessionType: "chat",
        $or: [{ _id: buildIdQuery(taskId) }, { sourceTaskId: taskId }],
      })
      .toArray();
    await Promise.all(
      chatTasks.map((task) =>
        syncBoardItemsToStatus(db, userId, task, normalizedStatus)
      )
    );
    if (result.session?.sourceMeetingId) {
      const meetingId = String(result.session.sourceMeetingId);
      const meetingResult = await updateMeetingTasks(
        db,
        userId,
        meetingId,
        taskId,
        normalizedStatus,
        { touch: false }
      );
      if (meetingResult?.updated) {
        await db.collection<any>("tasks").updateOne(
          {
            userId: userIdQuery,
            sourceSessionType: "meeting",
            $or: [{ _id: taskId }, { sourceTaskId: taskId }],
          },
          { $set: { status: normalizedStatus, lastUpdated: new Date() } }
        );
        const meetingTasks = await db
          .collection<any>("tasks")
          .find({
            userId: userIdQuery,
            sourceSessionType: "meeting",
            $or: [{ _id: buildIdQuery(taskId) }, { sourceTaskId: taskId }],
          })
          .toArray();
        await Promise.all(
          meetingTasks.map((task) =>
            syncBoardItemsToStatus(db, userId, task, normalizedStatus)
          )
        );
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
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unsupported sourceSessionType." }, { status: 400 });
}
