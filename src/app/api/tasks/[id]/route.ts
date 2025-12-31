import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { buildIdQuery, matchesId } from "@/lib/mongo-id";
import { normalizePersonNameKey } from "@/lib/transcript-utils";
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
  if (!meeting) return;
  const currentTasks = Array.isArray(meeting.extractedTasks)
    ? meeting.extractedTasks
    : [];
  const result = updater(currentTasks as ExtractedTaskSchema[]);
  if (!result.updated) return;
  await db.collection<any>("meetings").updateOne(filter, {
    $set: { extractedTasks: result.tasks, lastActivityAt: new Date() },
  });
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
  if (!session) return;
  const currentTasks = Array.isArray(session.suggestedTasks)
    ? session.suggestedTasks
    : [];
  const result = updater(currentTasks as ExtractedTaskSchema[]);
  if (!result.updated) return;
  await db.collection<any>("chatSessions").updateOne(filter, {
    $set: { suggestedTasks: result.tasks, lastActivityAt: new Date() },
  });
};

const syncTaskUpdateToSource = async (db: any, userId: string, taskRecord: any) => {
  const sessionId = taskRecord?.sourceSessionId;
  const sessionType = taskRecord?.sourceSessionType;
  if (!sessionId || (sessionType !== "meeting" && sessionType !== "chat")) {
    return;
  }

  if (sessionType === "meeting") {
    await updateMeetingTasks(db, userId, sessionId, (tasks) =>
      updateTaskInList(tasks, taskRecord)
    );
    return;
  }

  await updateChatTasks(db, userId, sessionId, (tasks) =>
    updateTaskInList(tasks, taskRecord)
  );
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
    Array.from(sessions.values()).map((session) => {
      const updater = (tasks: ExtractedTaskSchema[]) =>
        removeTasksFromList(tasks, session.ids);
      if (session.type === "meeting") {
        return updateMeetingTasks(db, userId, session.id, updater);
      }
      return updateChatTasks(db, userId, session.id, updater);
    })
  );
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
  if (body.assigneeName || body.assignee?.name) {
    update.assigneeNameKey = normalizePersonNameKey(
      body.assigneeName || body.assignee?.name
    );
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
  await syncTaskUpdateToSource(db, userId, task);
  return NextResponse.json(serializeTask(task));
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
    return NextResponse.json({ error: "Task not found." }, { status: 404 });
  }

  if (tasksToRemove.length) {
    await syncTaskDeletesToSource(db, userId, tasksToRemove);
  }
  return NextResponse.json({ ok: true });
}
