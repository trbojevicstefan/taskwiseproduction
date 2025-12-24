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
  lastUpdated: task.lastUpdated?.toISOString?.() || task.lastUpdated,
});

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await getDb();
  const userIdQuery = buildIdQuery(userId);
  const tasks = await db
    .collection<any>("tasks")
    .find({ userId: userIdQuery })
    .sort({ projectId: 1, parentId: 1, order: 1, createdAt: 1 })
    .toArray();

  return NextResponse.json(tasks.map(serializeTask));
}

export async function POST(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));

  if (!body?.title) {
    return NextResponse.json({ error: "Task title is required." }, { status: 400 });
  }

  const now = new Date();
  const task = {
    _id: randomUUID(),
    title: body.title,
    description: body.description || "",
    status: body.status || "todo",
    priority: body.priority || "medium",
    dueAt: body.dueAt ?? null,
    assignee: body.assignee ?? undefined,
    aiSuggested: body.aiSuggested ?? false,
    projectId: body.projectId || null,
    userId,
    parentId: body.parentId ?? null,
    order: body.order ?? 0,
    subtaskCount: body.subtaskCount ?? 0,
    sourceSessionId: body.sourceSessionId ?? null,
    sourceSessionName: body.sourceSessionName ?? null,
    createdAt: now,
    lastUpdated: now,
  };

  const db = await getDb();
  await db.collection<any>("tasks").insertOne(task);

  return NextResponse.json(serializeTask(task));
}

