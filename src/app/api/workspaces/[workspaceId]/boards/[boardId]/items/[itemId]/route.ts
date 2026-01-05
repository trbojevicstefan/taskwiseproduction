import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { buildIdQuery } from "@/lib/mongo-id";
import { normalizePersonNameKey } from "@/lib/transcript-utils";

const serializeTask = (task: any) => ({
  ...task,
  id: task._id,
  _id: undefined,
  createdAt: task.createdAt?.toISOString?.() || task.createdAt,
  lastUpdated: task.lastUpdated?.toISOString?.() || task.lastUpdated,
});

export async function PATCH(
  request: Request,
  {
    params,
  }: {
    params:
      | { workspaceId: string; boardId: string; itemId: string }
      | Promise<{ workspaceId: string; boardId: string; itemId: string }>;
  }
) {
  const { workspaceId, boardId, itemId } = await Promise.resolve(params);
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!workspaceId || !boardId || !itemId) {
    return NextResponse.json(
      { error: "Workspace ID, board ID, and item ID are required." },
      { status: 400 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const db = await getDb();
  const userIdQuery = buildIdQuery(userId);
  const itemIdQuery = buildIdQuery(itemId);
  const filter = {
    userId: userIdQuery,
    workspaceId,
    boardId,
    $or: [{ _id: itemIdQuery }, { id: itemId }],
  };

  const item = await db.collection<any>("boardItems").findOne(filter);
  if (!item) {
    return NextResponse.json({ error: "Board item not found." }, { status: 404 });
  }

  const itemUpdate: Record<string, any> = { updatedAt: new Date() };
  let statusCategory: string | null = null;

  if (typeof body.statusId === "string") {
    const statusIdQuery = buildIdQuery(body.statusId);
    const status = await db.collection<any>("boardStatuses").findOne({
      userId: userIdQuery,
      workspaceId,
      boardId,
      $or: [{ _id: statusIdQuery }, { id: body.statusId }],
    });
    if (!status) {
      return NextResponse.json({ error: "Status not found." }, { status: 404 });
    }
    itemUpdate.statusId = status._id?.toString?.() || status._id || body.statusId;
    statusCategory = status.category;
  }

  if (typeof body.rank === "number" && Number.isFinite(body.rank)) {
    itemUpdate.rank = body.rank;
  }

  if (Object.keys(itemUpdate).length > 1) {
    await db.collection<any>("boardItems").updateOne(filter, { $set: itemUpdate });
  }

  const taskIdQuery = buildIdQuery(item.taskId);
  const taskFilter = {
    userId: userIdQuery,
    $or: [{ _id: taskIdQuery }, { id: item.taskId }],
  };
  const taskUpdate: Record<string, any> = {};
  const taskUpdates = body.taskUpdates || {};

  if (typeof taskUpdates.title === "string") {
    const title = taskUpdates.title.trim();
    if (!title) {
      return NextResponse.json({ error: "Task title is required." }, { status: 400 });
    }
    taskUpdate.title = title;
  }

  if (typeof taskUpdates.description === "string") {
    taskUpdate.description = taskUpdates.description;
  }

  if (typeof taskUpdates.priority === "string") {
    taskUpdate.priority = taskUpdates.priority;
  }

  if (typeof taskUpdates.dueAt === "string" || taskUpdates.dueAt === null) {
    taskUpdate.dueAt = taskUpdates.dueAt;
  }

  if (typeof taskUpdates.assignee === "object" || taskUpdates.assignee === null) {
    taskUpdate.assignee = taskUpdates.assignee;
  }

  if (typeof taskUpdates.assigneeName === "string" || taskUpdates.assigneeName === null) {
    taskUpdate.assigneeName = taskUpdates.assigneeName;
    const rawName =
      taskUpdates.assigneeName ||
      taskUpdates.assignee?.name ||
      null;
    taskUpdate.assigneeNameKey = rawName ? normalizePersonNameKey(rawName) : null;
  }

  if (
    taskUpdates.status === "todo" ||
    taskUpdates.status === "inprogress" ||
    taskUpdates.status === "done" ||
    taskUpdates.status === "recurring"
  ) {
    taskUpdate.status = taskUpdates.status;
  } else if (statusCategory) {
    taskUpdate.status = statusCategory;
  }

  if (Object.keys(taskUpdate).length) {
    taskUpdate.lastUpdated = new Date();
    await db.collection<any>("tasks").updateOne(taskFilter, { $set: taskUpdate });
  }

  const task = await db.collection<any>("tasks").findOne(taskFilter);
  if (!task) {
    return NextResponse.json({ error: "Task not found." }, { status: 404 });
  }

  const updatedItem = await db.collection<any>("boardItems").findOne(filter);

  return NextResponse.json({
    ...serializeTask(task),
    boardItemId: updatedItem?._id || item._id,
    boardStatusId: updatedItem?.statusId || item.statusId,
    boardRank: typeof updatedItem?.rank === "number" ? updatedItem.rank : item.rank,
    boardCreatedAt: updatedItem?.createdAt || item.createdAt,
    boardUpdatedAt: updatedItem?.updatedAt || item.updatedAt,
  });
}

export async function DELETE(
  _request: Request,
  {
    params,
  }: {
    params:
      | { workspaceId: string; boardId: string; itemId: string }
      | Promise<{ workspaceId: string; boardId: string; itemId: string }>;
  }
) {
  const { workspaceId, boardId, itemId } = await Promise.resolve(params);
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!workspaceId || !boardId || !itemId) {
    return NextResponse.json(
      { error: "Workspace ID, board ID, and item ID are required." },
      { status: 400 }
    );
  }

  const db = await getDb();
  const userIdQuery = buildIdQuery(userId);
  const itemIdQuery = buildIdQuery(itemId);
  const filter = {
    userId: userIdQuery,
    workspaceId,
    boardId,
    $or: [{ _id: itemIdQuery }, { id: itemId }],
  };

  const result = await db.collection<any>("boardItems").deleteOne(filter);
  if (!result.deletedCount) {
    return NextResponse.json({ error: "Board item not found." }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
