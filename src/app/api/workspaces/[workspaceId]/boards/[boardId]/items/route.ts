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

const serializeItem = (item: any) => ({
  ...item,
  id: item._id,
  _id: undefined,
  createdAt: item.createdAt?.toISOString?.() || item.createdAt,
  updatedAt: item.updatedAt?.toISOString?.() || item.updatedAt,
});

const getNextRank = async (
  db: any,
  filter: Record<string, any>
) => {
  const lastItem = await db
    .collection<any>("boardItems")
    .find(filter)
    .sort({ rank: -1 })
    .limit(1)
    .toArray();
  const lastRank = typeof lastItem[0]?.rank === "number" ? lastItem[0].rank : 0;
  return lastRank + 1000;
};

export async function GET(
  _request: Request,
  {
    params,
  }: {
    params:
      | { workspaceId: string; boardId: string }
      | Promise<{ workspaceId: string; boardId: string }>;
  }
) {
  const { workspaceId, boardId } = await Promise.resolve(params);
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!workspaceId || !boardId) {
    return NextResponse.json({ error: "Workspace ID and board ID are required." }, { status: 400 });
  }

  const db = await getDb();
  const userIdQuery = buildIdQuery(userId);
  const pipeline = [
    { $match: { userId: userIdQuery, workspaceId, boardId } },
    {
      $lookup: {
        from: "tasks",
        localField: "taskId",
        foreignField: "_id",
        as: "task",
      },
    },
    { $unwind: "$task" },
    { $match: { "task.taskState": { $ne: "archived" } } },
    { $sort: { statusId: 1, rank: 1, createdAt: 1 } },
  ];

  const items = await db.collection<any>("boardItems").aggregate(pipeline).toArray();

  const response = items.map((item) => ({
    ...serializeTask(item.task),
    boardItemId: item._id,
    boardStatusId: item.statusId,
    boardRank: item.rank,
    boardCreatedAt: item.createdAt,
    boardUpdatedAt: item.updatedAt,
  }));

  const toTime = (value: any) => {
    if (!value) return 0;
    if (value instanceof Date) return value.getTime();
    const time = new Date(value).getTime();
    return Number.isNaN(time) ? 0 : time;
  };
  const latestByTaskId = new Map<string, any>();
  response.forEach((item) => {
    const key = String(item.id);
    const existing = latestByTaskId.get(key);
    if (
      !existing ||
      toTime(item.boardUpdatedAt || item.boardCreatedAt) >
        toTime(existing.boardUpdatedAt || existing.boardCreatedAt)
    ) {
      latestByTaskId.set(key, item);
    }
  });
  const seen = new Set<string>();
  const deduped = response.filter((item) => {
    const key = String(item.id);
    if (seen.has(key)) return false;
    if (latestByTaskId.get(key) !== item) return false;
    seen.add(key);
    return true;
  });

  return NextResponse.json(deduped);
}

export async function POST(
  request: Request,
  {
    params,
  }: {
    params:
      | { workspaceId: string; boardId: string }
      | Promise<{ workspaceId: string; boardId: string }>;
  }
) {
  const { workspaceId, boardId } = await Promise.resolve(params);
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!workspaceId || !boardId) {
    return NextResponse.json({ error: "Workspace ID and board ID are required." }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const db = await getDb();
  const userIdQuery = buildIdQuery(userId);

  const statusIdQuery = buildIdQuery(body.statusId || "");
  let status = await db.collection<any>("boardStatuses").findOne({
    userId: userIdQuery,
    workspaceId,
    boardId,
    $or: [{ _id: statusIdQuery }, { id: body.statusId }],
  });

  if (!status) {
    const fallbackStatus = await db
      .collection<any>("boardStatuses")
      .find({ userId: userIdQuery, workspaceId, boardId })
      .sort({ order: 1 })
      .limit(1)
      .toArray();
    if (!fallbackStatus[0]) {
      return NextResponse.json({ error: "Board status not found." }, { status: 404 });
    }
    status = fallbackStatus[0];
  }

  const statusIdValue = status._id?.toString?.() || status._id || body.statusId;
  const now = new Date();
  let taskId = typeof body.taskId === "string" ? body.taskId : null;
  let task: any = null;

  if (taskId) {
    const taskIdQuery = buildIdQuery(taskId);
    const existingItem = await db.collection<any>("boardItems").findOne({
      userId: userIdQuery,
      workspaceId,
      boardId,
      taskId: taskIdQuery,
    });
    if (existingItem) {
      task = await db.collection<any>("tasks").findOne({
        userId: userIdQuery,
        $or: [{ _id: taskIdQuery }, { id: taskId }],
      });
      if (!task) {
        return NextResponse.json({ error: "Task not found." }, { status: 404 });
      }
      return NextResponse.json({
        ...serializeTask(task),
        boardItemId: existingItem._id,
        boardStatusId: existingItem.statusId,
        boardRank: existingItem.rank,
        boardCreatedAt: existingItem.createdAt,
        boardUpdatedAt: existingItem.updatedAt,
      });
    }
  }

  if (!taskId) {
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) {
      return NextResponse.json({ error: "Task title is required." }, { status: 400 });
    }

    taskId = randomUUID();
    task = {
      _id: taskId,
      userId,
      workspaceId,
      title,
      description: typeof body.description === "string" ? body.description : "",
      status: status.category || "todo",
      priority: body.priority || "medium",
      dueAt: body.dueAt ?? null,
      assignee: body.assignee ?? null,
      assigneeName: body.assigneeName ?? null,
      assigneeNameKey: body.assigneeNameKey ?? null,
      aiSuggested: body.aiSuggested ?? false,
      origin: body.origin || "manual",
      projectId: body.projectId || null,
      parentId: body.parentId ?? null,
      order: body.order ?? 0,
      subtaskCount: body.subtaskCount ?? 0,
      sourceSessionId: body.sourceSessionId ?? null,
      sourceSessionName: body.sourceSessionName ?? null,
      sourceSessionType: body.sourceSessionType ?? "task",
      sourceTaskId: body.sourceTaskId ?? null,
      taskState: "active",
      createdAt: now,
      lastUpdated: now,
    };
    await db.collection<any>("tasks").insertOne(task);
  } else {
    const taskIdQuery = buildIdQuery(taskId);
    task = await db.collection<any>("tasks").findOne({
      userId: userIdQuery,
      $or: [{ _id: taskIdQuery }, { id: taskId }],
    });
    if (!task) {
      return NextResponse.json({ error: "Task not found." }, { status: 404 });
    }
    await db.collection<any>("tasks").updateOne(
      { userId: userIdQuery, _id: task._id },
      {
        $set: {
          status: status.category || task.status || "todo",
          taskState: "active",
          workspaceId,
          lastUpdated: now,
        },
      }
    );
    task = await db.collection<any>("tasks").findOne({
      userId: userIdQuery,
      _id: task._id,
    });
  }

  const rank = await getNextRank(db, {
    userId: userIdQuery,
    workspaceId,
    boardId,
    statusId: statusIdValue,
  });

  const item = {
    _id: randomUUID(),
    userId,
    workspaceId,
    boardId,
    taskId: task._id?.toString?.() || task._id,
    statusId: statusIdValue,
    rank,
    createdAt: now,
    updatedAt: now,
  };

  await db.collection<any>("boardItems").insertOne(item);

  return NextResponse.json({
    ...serializeTask(task),
    boardItemId: item._id,
    boardStatusId: item.statusId,
    boardRank: item.rank,
    boardCreatedAt: item.createdAt,
    boardUpdatedAt: item.updatedAt,
  });
}
