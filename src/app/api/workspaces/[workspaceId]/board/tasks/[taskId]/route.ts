import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { buildIdQuery } from "@/lib/mongo-id";

const serializeTask = (task: any) => ({
  ...task,
  id: task._id,
  _id: undefined,
  createdAt: task.createdAt?.toISOString?.() || task.createdAt,
  updatedAt: task.updatedAt?.toISOString?.() || task.updatedAt,
});

export async function PATCH(
  request: Request,
  {
    params,
  }: {
    params:
      | { workspaceId: string; taskId: string }
      | Promise<{ workspaceId: string; taskId: string }>;
  }
) {
  const { workspaceId, taskId } = await Promise.resolve(params);
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!workspaceId || !taskId) {
    return NextResponse.json({ error: "Workspace ID and task ID are required." }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const update: Record<string, any> = { updatedAt: new Date() };

  if (typeof body.title === "string") {
    const title = body.title.trim();
    if (!title) {
      return NextResponse.json({ error: "Task title is required." }, { status: 400 });
    }
    update.title = title;
  }

  if (typeof body.description === "string") {
    update.description = body.description;
  }

  if (typeof body.statusId === "string") {
    update.statusId = body.statusId;
  }

  if (typeof body.priority === "string") {
    update.priority = body.priority;
  }

  if (typeof body.assigneeId === "string" || body.assigneeId === null) {
    update.assigneeId = body.assigneeId;
  }

  if (typeof body.assigneeName === "string" || body.assigneeName === null) {
    update.assigneeName = body.assigneeName;
  }

  if (typeof body.dueAt === "string" || body.dueAt === null) {
    update.dueAt = body.dueAt;
  }

  if (typeof body.order === "number" && Number.isFinite(body.order)) {
    update.order = body.order;
  }

  if (Object.keys(update).length === 1) {
    return NextResponse.json({ error: "No updates provided." }, { status: 400 });
  }

  const db = await getDb();
  const userIdQuery = buildIdQuery(userId);
  const taskIdQuery = buildIdQuery(taskId);
  const filter = {
    userId: userIdQuery,
    workspaceId,
    $or: [{ _id: taskIdQuery }, { id: taskId }],
  };

  const existing = await db.collection<any>("boardTasks").findOne(filter);
  if (!existing) {
    return NextResponse.json({ error: "Task not found." }, { status: 404 });
  }

  if (
    typeof body.statusId === "string" &&
    body.statusId !== existing.statusId &&
    typeof body.order !== "number"
  ) {
    const lastTask = await db
      .collection<any>("boardTasks")
      .find({ userId: userIdQuery, workspaceId, statusId: body.statusId })
      .sort({ order: -1 })
      .limit(1)
      .toArray();
    update.order = (lastTask[0]?.order ?? -1) + 1;
  }

  await db.collection<any>("boardTasks").updateOne(filter, { $set: update });
  const task = await db.collection<any>("boardTasks").findOne(filter);

  return NextResponse.json(serializeTask(task));
}

export async function DELETE(
  _request: Request,
  {
    params,
  }: {
    params:
      | { workspaceId: string; taskId: string }
      | Promise<{ workspaceId: string; taskId: string }>;
  }
) {
  const { workspaceId, taskId } = await Promise.resolve(params);
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!workspaceId || !taskId) {
    return NextResponse.json({ error: "Workspace ID and task ID are required." }, { status: 400 });
  }

  const db = await getDb();
  const userIdQuery = buildIdQuery(userId);
  const taskIdQuery = buildIdQuery(taskId);
  const filter = {
    userId: userIdQuery,
    workspaceId,
    $or: [{ _id: taskIdQuery }, { id: taskId }],
  };

  const result = await db.collection<any>("boardTasks").deleteOne(filter);
  if (!result.deletedCount) {
    return NextResponse.json({ error: "Task not found." }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
