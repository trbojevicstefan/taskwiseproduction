import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-route";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { publishDomainEvent } from "@/lib/domain-events";
import {
  type TaskStatus,
  cleanupChatTasksForSessions,
  updateChatTasks,
  updateLinkedChatSessions,
  updateMeetingTasks,
  updateTaskStatusInList,
} from "@/lib/services/session-task-sync";

export async function PATCH(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) {
    return apiError(401, "request_error", "Unauthorized");
  }

  const body = await request.json().catch(() => ({}));
  const { sourceSessionId, sourceSessionType, taskId, status } = body || {};

  if (!sourceSessionId || !sourceSessionType || !taskId || !status) {
    return apiError(400, "request_error", "Missing required fields.");
  }

  const normalizedStatus = status as TaskStatus;
  if (!["todo", "inprogress", "done", "recurring"].includes(normalizedStatus)) {
    return apiError(400, "request_error", "Invalid status value.");
  }

  const db = await getDb();

  if (sourceSessionType === "meeting") {
    const result = await updateMeetingTasks(
      db,
      userId,
      sourceSessionId,
      (tasks) => updateTaskStatusInList(tasks, taskId, normalizedStatus),
      { touch: false }
    );
    if (!result?.updated) {
      return apiError(404, "request_error", "Task not found.");
    }
    await db.collection("tasks").updateOne(
      {
        userId,
        sourceSessionType: "meeting",
        $or: [{ _id: taskId }, { sourceTaskId: taskId }],
      },
      { $set: { status: normalizedStatus, lastUpdated: new Date() } }
    );
    await publishDomainEvent(db, {
      type: "task.status.changed",
      userId,
      payload: {
        taskId,
        status: normalizedStatus,
        sourceSessionType: "meeting",
        sourceSessionId,
      },
    });
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
    const result = await updateChatTasks(db, userId, sourceSessionId, (tasks) =>
      updateTaskStatusInList(tasks, taskId, normalizedStatus)
    );
    if (!result?.updated) {
      return apiError(404, "request_error", "Task not found.");
    }
    await db.collection("tasks").updateOne(
      {
        userId,
        sourceSessionType: "chat",
        $or: [{ _id: taskId }, { sourceTaskId: taskId }],
      },
      { $set: { status: normalizedStatus, lastUpdated: new Date() } }
    );
    await publishDomainEvent(db, {
      type: "task.status.changed",
      userId,
      payload: {
        taskId,
        status: normalizedStatus,
        sourceSessionType: "chat",
        sourceSessionId,
      },
    });
    if (result.session?.sourceMeetingId) {
      const meetingId = String(result.session.sourceMeetingId);
      const meetingResult = await updateMeetingTasks(
        db,
        userId,
        meetingId,
        (tasks) => updateTaskStatusInList(tasks, taskId, normalizedStatus),
        { touch: false }
      );
      if (meetingResult?.updated) {
        await db.collection("tasks").updateOne(
          {
            userId,
            sourceSessionType: "meeting",
            $or: [{ _id: taskId }, { sourceTaskId: taskId }],
          },
          { $set: { status: normalizedStatus, lastUpdated: new Date() } }
        );
        await publishDomainEvent(db, {
          type: "task.status.changed",
          userId,
          payload: {
            taskId,
            status: normalizedStatus,
            sourceSessionType: "meeting",
            sourceSessionId: meetingId,
          },
        });
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

  return apiError(400, "request_error", "Unsupported sourceSessionType.");
}
