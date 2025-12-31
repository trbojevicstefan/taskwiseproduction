import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
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

export async function GET(
  _request: Request,
  {
    params,
  }: { params: { workspaceId: string } | Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await Promise.resolve(params);
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!workspaceId) {
    return NextResponse.json({ error: "Workspace ID is required." }, { status: 400 });
  }

  const db = await getDb();
  const userIdQuery = buildIdQuery(userId);
  const tasks = await db
    .collection<any>("boardTasks")
    .find({ userId: userIdQuery, workspaceId })
    .sort({ statusId: 1, order: 1, createdAt: 1 })
    .toArray();

  return NextResponse.json(tasks.map(serializeTask));
}

export async function POST(
  request: Request,
  {
    params,
  }: { params: { workspaceId: string } | Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await Promise.resolve(params);
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!workspaceId) {
    return NextResponse.json({ error: "Workspace ID is required." }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const statusId = typeof body.statusId === "string" ? body.statusId : "";

  if (!title) {
    return NextResponse.json({ error: "Task title is required." }, { status: 400 });
  }

  if (!statusId) {
    return NextResponse.json({ error: "Status ID is required." }, { status: 400 });
  }

  const db = await getDb();
  const userIdQuery = buildIdQuery(userId);
  const statusIdQuery = buildIdQuery(statusId);
  const status = await db.collection<any>("boardStatuses").findOne({
    userId: userIdQuery,
    workspaceId,
    $or: [{ _id: statusIdQuery }, { id: statusId }],
  });

  if (!status) {
    return NextResponse.json({ error: "Status not found." }, { status: 404 });
  }

  const statusIdValue = status._id?.toString?.() || status._id || statusId;
  const lastTask = await db
    .collection<any>("boardTasks")
    .find({ userId: userIdQuery, workspaceId, statusId: statusIdValue })
    .sort({ order: -1 })
    .limit(1)
    .toArray();
  const nextOrder = (lastTask[0]?.order ?? -1) + 1;
  const now = new Date();

  const task = {
    _id: randomUUID(),
    userId,
    workspaceId,
    title,
    description: typeof body.description === "string" ? body.description : "",
    statusId: statusIdValue,
    priority: body.priority || "medium",
    assigneeId: body.assigneeId ?? null,
    assigneeName: body.assigneeName ?? null,
    dueAt: body.dueAt ?? null,
    order: typeof body.order === "number" ? body.order : nextOrder,
    createdAt: now,
    updatedAt: now,
  };

  await db.collection<any>("boardTasks").insertOne(task);

  return NextResponse.json(serializeTask(task));
}
