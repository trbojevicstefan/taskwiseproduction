import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-route";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { normalizePersonNameKey } from "@/lib/transcript-utils";
import { syncTasksForSource } from "@/lib/task-sync";
import { publishDomainEvent } from "@/lib/domain-events";
import {
  cleanupChatTasksForSessions,
  updateChatTasks,
  updateLinkedChatSessions,
  updateMeetingTasks,
} from "@/lib/services/session-task-sync";
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

  const nextTasks = tasks.map((task: any) => {
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

  tasks.forEach((task: any) => {
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

const syncTaskUpdateToSource = async (db: any, userId: string, taskRecord: any) => {
  const sessionId = taskRecord?.sourceSessionId;
  const sessionType = taskRecord?.sourceSessionType;
  if (!sessionId || (sessionType !== "meeting" && sessionType !== "chat")) {
    return;
  }

  if (sessionType === "meeting") {
    const result = await updateMeetingTasks(
      db,
      userId,
      sessionId,
      (tasks) => updateTaskInList(tasks, taskRecord),
      { touch: false }
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
    const meetingResult = await updateMeetingTasks(
      db,
      userId,
      meetingId,
      () => ({ tasks: result.tasks, updated: true }),
      { touch: false }
    );
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

const syncTaskDeletesToSource = async (
  db: any,
  userId: string,
  taskRecords: any[]
) => {
  const sessions = new Map<
    string,
    { type: "meeting" | "chat"; id: string; ids: Set<string> }
  >();

  taskRecords.forEach((task: any) => {
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
        const result = await updateMeetingTasks(db, userId, session.id, updater, { touch: false });
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
        const meetingResult = await updateMeetingTasks(
          db,
          userId,
          meetingId,
          () => ({ tasks: result.tasks, updated: true }),
          { touch: false }
        );
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
    const result = await updateMeetingTasks(
      db,
      userId,
      sessionId,
      (tasks) => removeTasksFromList(tasks, ids),
      { touch: false }
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
    const meetingResult = await updateMeetingTasks(
      db,
      userId,
      meetingId,
      () => ({ tasks: result.tasks, updated: true }),
      { touch: false }
    );
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
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const userId = await getSessionUserId();
  if (!userId) {
    return apiError(401, "request_error", "Unauthorized");
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
  const filter = {
    userId,
    $or: [{ _id: id }, { id }],
  };
  await db.collection("tasks").updateOne(filter, { $set: update });

  const task = await db.collection("tasks").findOne(filter);
  if (!task) {
    return apiError(404, "request_error", "Task not found.");
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
    await publishDomainEvent(db, {
      type: "task.status.changed",
      userId,
      payload: {
        taskId: String(task._id ?? id),
        status: nextStatus,
        sourceSessionType:
          task.sourceSessionType === "meeting" || task.sourceSessionType === "chat"
            ? task.sourceSessionType
            : undefined,
        sourceSessionId: task.sourceSessionId
          ? String(task.sourceSessionId)
          : undefined,
      },
    });
  }
  await syncTaskUpdateToSource(db, userId, task);
  return NextResponse.json(serializeTask(task));
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const userId = await getSessionUserId();
  if (!userId) {
    return apiError(401, "request_error", "Unauthorized");
  }

  const url = new URL(request.url);
  const sourceSessionId = url.searchParams.get("sourceSessionId");
  const sourceSessionTypeParam = url.searchParams.get("sourceSessionType");
  const sourceTaskId = url.searchParams.get("sourceTaskId");

  const db = await getDb();
  const tasks = await db
    .collection("tasks")
    .find({ userId })
    .toArray();

  const normalizeTaskId = (value: string) => {
    if (!value) return value;
    if (value.includes(":")) {
      const parts = value.split(":").filter(Boolean);
      return parts.length ? parts[parts.length - 1] : value;
    }
    return value;
  };

  const targetId = normalizeTaskId(id);
  const toDelete = new Set<string>();
  toDelete.add(id);
  if (targetId && targetId !== id) {
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
    tasks.forEach((task: any) => {
      const taskParentId = task.parentId ? normalizeId(task.parentId) : "";
      if (taskParentId === parentId) {
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

  const tasksToRemove = tasks.filter((task: any) => matchesDeleteSet(task._id));

  const deleteIds = Array.from(toDelete);

  const result = await db
    .collection("tasks")
    .deleteMany({ userId, _id: { $in: deleteIds } });
  if (!result.deletedCount) {
    const fallbackFilter = {
      userId,
      $or: [
        { _id: id },
        { _id: targetId },
        { id },
        { id: targetId },
        { sourceTaskId: id },
        { sourceTaskId: targetId },
        ...(sourceTaskId ? [{ sourceTaskId }] : []),
      ],
    };
    const fallbackTask = await db.collection("tasks").findOne(fallbackFilter);
    if (fallbackTask) {
      await db.collection("tasks").deleteOne({
        userId,
        _id: String(fallbackTask._id),
      });
      await syncTaskDeletesToSource(db, userId, [fallbackTask]);
      return NextResponse.json({ ok: true });
    }
  }

  let removedFromSession = false;
  const derivedParts = id.split(":");
  const derivedSessionId = derivedParts.length > 1 ? derivedParts[0] : null;
  const derivedTaskId = derivedParts.length > 1 ? derivedParts.slice(1).join(":") : null;
  const sessionType =
    sourceSessionTypeParam === "meeting" || sourceSessionTypeParam === "chat"
      ? (sourceSessionTypeParam as "meeting" | "chat")
      : null;
  const sessionId = sourceSessionId || derivedSessionId;
  const sessionTaskId = sourceTaskId || derivedTaskId || targetId || id;

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
    return apiError(404, "request_error", "Task not found.");
  }

  if (tasksToRemove.length) {
    await syncTaskDeletesToSource(db, userId, tasksToRemove);
  }

  if (toDelete.size) {
    await db.collection("boardItems").deleteMany({
      userId,
      taskId: { $in: Array.from(toDelete) },
    });
  }
  return NextResponse.json({ ok: true });
}
