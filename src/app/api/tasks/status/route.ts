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
  const sessionIdQuery = buildIdQuery(sourceSessionId);
  const filter = {
    userId: userIdQuery,
    $or: [{ _id: sessionIdQuery }, { id: sourceSessionId }],
  };

  if (sourceSessionType === "meeting") {
    const meeting = await db.collection<any>("meetings").findOne(filter);
    if (!meeting) {
      return NextResponse.json({ error: "Meeting not found." }, { status: 404 });
    }
    const { tasks, updated } = updateTaskStatus(
      meeting.extractedTasks || [],
      taskId,
      normalizedStatus
    );
    if (!updated) {
      return NextResponse.json({ error: "Task not found." }, { status: 404 });
    }
    await db
      .collection<any>("meetings")
      .updateOne(filter, { $set: { extractedTasks: tasks, lastActivityAt: new Date() } });
    await db.collection<any>("tasks").updateOne(
      {
        userId: userIdQuery,
        sourceSessionType: "meeting",
        $or: [{ _id: taskId }, { sourceTaskId: taskId }],
      },
      { $set: { status: normalizedStatus, lastUpdated: new Date() } }
    );
    return NextResponse.json({ ok: true });
  }

  if (sourceSessionType === "chat") {
    const session = await db.collection<any>("chatSessions").findOne(filter);
    if (!session) {
      return NextResponse.json({ error: "Chat session not found." }, { status: 404 });
    }
    const { tasks, updated } = updateTaskStatus(
      session.suggestedTasks || [],
      taskId,
      normalizedStatus
    );
    if (!updated) {
      return NextResponse.json({ error: "Task not found." }, { status: 404 });
    }
    await db
      .collection<any>("chatSessions")
      .updateOne(filter, { $set: { suggestedTasks: tasks, lastActivityAt: new Date() } });
    await db.collection<any>("tasks").updateOne(
      {
        userId: userIdQuery,
        sourceSessionType: "chat",
        $or: [{ _id: taskId }, { sourceTaskId: taskId }],
      },
      { $set: { status: normalizedStatus, lastUpdated: new Date() } }
    );
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unsupported sourceSessionType." }, { status: 400 });
}
