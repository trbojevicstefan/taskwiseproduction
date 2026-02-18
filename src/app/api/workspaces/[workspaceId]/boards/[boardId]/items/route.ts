import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-route";
import { randomUUID } from "crypto";
import { TASK_LIST_PROJECTION } from "@/lib/task-projections";
import { requireWorkspaceRouteAccess } from "@/lib/workspace-route-access";

const serializeTask = (task: any) => ({
  ...task,
  id: task._id,
  _id: undefined,
  createdAt: task.createdAt?.toISOString?.() || task.createdAt,
  lastUpdated: task.lastUpdated?.toISOString?.() || task.lastUpdated,
});

const isDuplicateKeyError = (error: any) => {
  if (!error) return false;
  if (error.code === 11000) return true;
  const message = String(error.message || "");
  return message.includes("E11000 duplicate key error");
};

const getNextRank = async (
  db: any,
  filter: Record<string, any>
) => {
  const lastItem = await db
    .collection("boardItems")
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
  if (!boardId) {
    return apiError(400, "request_error", "Board ID is required.");
  }
  const access = await requireWorkspaceRouteAccess(workspaceId, "member");
  if (!access.ok) {
    return access.response;
  }
  const { db, userId } = access;

  const userIdQuery = userId;
  const pipeline = [
    { $match: { userId: userIdQuery, workspaceId, boardId } },
    {
      $lookup: {
        from: "tasks",
        let: { lookupTaskId: "$taskId" },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ["$_id", "$$lookupTaskId"] },
              userId: userIdQuery,
              taskState: { $ne: "archived" },
            },
          },
          { $project: TASK_LIST_PROJECTION },
        ],
        as: "task",
      },
    },
    { $unwind: "$task" },
    { $sort: { statusId: 1, rank: 1, createdAt: 1 } },
  ];

  const items = await db.collection("boardItems").aggregate(pipeline).toArray();

  const response = items.map((item: any) => ({
    ...serializeTask(item.task),
    boardItemId: item._id,
    boardStatusId: item.statusId,
    boardRank: item.rank,
    boardCreatedAt: item.createdAt,
    boardUpdatedAt: item.updatedAt,
  }));
  return NextResponse.json(response);
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
  if (!boardId) {
    return apiError(400, "request_error", "Board ID is required.");
  }
  const access = await requireWorkspaceRouteAccess(workspaceId, "member");
  if (!access.ok) {
    return access.response;
  }
  const { db, userId } = access;

  const body = await request.json().catch(() => ({}));
  const userIdQuery = userId;

  const statusIdQuery = body.statusId || "";
  let status = await db.collection("boardStatuses").findOne({
    userId: userIdQuery,
    workspaceId,
    boardId,
    $or: [{ _id: statusIdQuery }, { id: body.statusId }],
  });

  if (!status) {
    const fallbackStatus = await db
      .collection("boardStatuses")
      .find({ userId: userIdQuery, workspaceId, boardId })
      .sort({ order: 1 })
      .limit(1)
      .toArray();
    if (!fallbackStatus[0]) {
      return apiError(404, "request_error", "Board status not found.");
    }
    status = fallbackStatus[0];
  }

  const statusIdValue = status._id?.toString?.() || status._id || body.statusId;
  const now = new Date();
  let taskId = typeof body.taskId === "string" ? body.taskId : null;
  let task: any = null;

  if (taskId) {
    const taskIdQuery = taskId;
    const normalizedTaskId = taskId && taskId.includes(":") ? taskId.split(":").slice(1).join(":") : null;
    const normalizedTaskIdQuery = normalizedTaskId || null;
    const orConds: any[] = [{ taskId: taskIdQuery }];
    if (normalizedTaskIdQuery) orConds.push({ taskId: normalizedTaskIdQuery });
    orConds.push({ taskCanonicalId: taskIdQuery });
    if (normalizedTaskIdQuery) orConds.push({ taskCanonicalId: normalizedTaskIdQuery });
    const existingItem = await db.collection("boardItems").findOne({
      userId: userIdQuery,
      workspaceId,
      boardId,
      $or: orConds,
    });
    if (existingItem) {
      task = await db.collection("tasks").findOne({
        userId: userIdQuery,
        $or: [{ _id: taskIdQuery }, { id: taskId }],
      });
      if (!task) {
        return apiError(404, "request_error", "Task not found.");
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
      return apiError(400, "request_error", "Task title is required.");
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
    await db.collection("tasks").insertOne(task);
  } else {
    const taskIdQuery = taskId;
    task = await db.collection("tasks").findOne({
      userId: userIdQuery,
      $or: [{ _id: taskIdQuery }, { id: taskId }],
    });
    if (!task) {
      return apiError(404, "request_error", "Task not found.");
    }
    await db.collection("tasks").updateOne(
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
    task = await db.collection("tasks").findOne({
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
  const taskProjectionId = task._id?.toString?.() || task._id || taskId;

  const item = {
    _id: randomUUID(),
    userId,
    workspaceId,
    boardId,
    taskId: taskProjectionId,
    taskCanonicalId: taskProjectionId,
    statusId: statusIdValue,
    rank,
    createdAt: now,
    updatedAt: now,
  };

  try {
    await db.collection("boardItems").insertOne(item);
  } catch (error: any) {
    if (!isDuplicateKeyError(error)) {
      throw error;
    }
    const existingItem = await db.collection("boardItems").findOne({
      userId: userIdQuery,
      workspaceId,
      boardId,
      taskId: taskProjectionId,
    });
    if (!existingItem) {
      throw error;
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

  return NextResponse.json({
    ...serializeTask(task),
    boardItemId: item._id,
    boardStatusId: item.statusId,
    boardRank: item.rank,
    boardCreatedAt: item.createdAt,
    boardUpdatedAt: item.updatedAt,
  });
}
