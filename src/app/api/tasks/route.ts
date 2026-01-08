import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { buildIdQuery } from "@/lib/mongo-id";
import { normalizePersonNameKey } from "@/lib/transcript-utils";
import { getWorkspaceIdForUser } from "@/lib/workspace";

const serializeTask = (task: any) => ({
  ...task,
  id: task._id,
  _id: undefined,
  createdAt: task.createdAt?.toISOString?.() || task.createdAt,
  lastUpdated: task.lastUpdated?.toISOString?.() || task.lastUpdated,
});

export async function GET(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await getDb();
  const userIdQuery = buildIdQuery(userId);
  const { searchParams } = new URL(request.url);
  const workspaceId = searchParams.get("workspaceId");
  const parentId = searchParams.get("parentId");
  const includeSuggested = searchParams.get("includeSuggested") === "true";
  const filters: Record<string, any> = { userId: userIdQuery };
  if (workspaceId) {
    filters.workspaceId = workspaceId;
  }
  if (parentId) {
    filters.parentId = buildIdQuery(parentId);
  }
  if (!includeSuggested) {
    filters.taskState = { $ne: "archived" };
  }
  const tasks = await db
    .collection<any>("tasks")
    .find(filters)
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
  const assigneeNameKey = body.assigneeName
    ? normalizePersonNameKey(body.assigneeName)
    : body.assignee?.name
    ? normalizePersonNameKey(body.assignee.name)
    : null;

  const db = await getDb();
  const workspaceId =
    typeof body.workspaceId === "string" && body.workspaceId
      ? body.workspaceId
      : await getWorkspaceIdForUser(db, userId);

  const task = {
    _id: randomUUID(),
    title: body.title,
    description: body.description || "",
    status: body.status || "todo",
    priority: body.priority || "medium",
    dueAt: body.dueAt ?? null,
    assignee: body.assignee ?? undefined,
    assigneeName: body.assigneeName ?? null,
    assigneeNameKey,
    aiSuggested: body.aiSuggested ?? false,
    origin: body.origin || "manual",
    projectId: body.projectId || null,
    workspaceId,
    userId,
    parentId: body.parentId ?? null,
    order: body.order ?? 0,
    subtaskCount: body.subtaskCount ?? 0,
    sourceSessionId: body.sourceSessionId ?? null,
    sourceSessionName: body.sourceSessionName ?? null,
    sourceSessionType: body.sourceSessionType ?? "task",
    sourceTaskId: body.sourceTaskId ?? null,
    taskState: body.taskState ?? "active",
    researchBrief: body.researchBrief ?? null,
    aiAssistanceText: body.aiAssistanceText ?? null,
    createdAt: now,
    lastUpdated: now,
  };

  await db.collection<any>("tasks").insertOne(task);

  return NextResponse.json(serializeTask(task));
}

