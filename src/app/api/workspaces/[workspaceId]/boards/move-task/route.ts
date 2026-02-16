import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-route";
import { randomUUID } from "crypto";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";

const serializeTask = (task: any) => ({
  ...task,
  id: task._id,
  _id: undefined,
  createdAt: task.createdAt?.toISOString?.() || task.createdAt,
  lastUpdated: task.lastUpdated?.toISOString?.() || task.lastUpdated,
});

const getNextRank = async (db: any, filter: Record<string, any>) => {
  const lastItem = await db
    .collection("boardItems")
    .find(filter)
    .sort({ rank: -1 })
    .limit(1)
    .toArray();
  const lastRank = typeof lastItem[0]?.rank === "number" ? lastItem[0].rank : 0;
  return lastRank + 1000;
};

const isDuplicateKeyError = (error: any) => {
  if (!error) return false;
  if (error.code === 11000) return true;
  const message = String(error.message || "");
  return message.includes("E11000 duplicate key error");
};

export async function POST(
  request: Request,
  {
    params,
  }: {
    params:
      | { workspaceId: string }
      | Promise<{ workspaceId: string }>;
  }
) {
  const { workspaceId } = await Promise.resolve(params);
  const userId = await getSessionUserId();
  if (!userId) {
    return apiError(401, "request_error", "Unauthorized");
  }

  const body = await request.json().catch(() => ({}));
  const boardId = typeof body.boardId === "string" ? body.boardId : "";
  const taskId = typeof body.taskId === "string" ? body.taskId : "";
  const statusId = typeof body.statusId === "string" ? body.statusId : null;

  if (!workspaceId || !boardId || !taskId) {
    return apiError(400, "request_error", "Workspace ID, board ID, and task ID are required.");
  }

  const db = await getDb();
  const userIdQuery = userId;
  const taskIdQuery = taskId;

  const normalizedTaskId = taskId && taskId.includes(":") ? taskId.split(":").slice(1).join(":") : null;
  const normalizedTaskIdQuery = normalizedTaskId || null;

  const task = await db.collection("tasks").findOne({
    userId: userIdQuery,
    $or: [{ _id: taskIdQuery }, { id: taskId }],
  });
  if (!task) {
    return apiError(404, "request_error", "Task not found.");
  }

  const statuses = await db
    .collection("boardStatuses")
    .find({ userId: userIdQuery, workspaceId, boardId })
    .sort({ order: 1 })
    .toArray();
  if (!statuses.length) {
    return apiError(404, "request_error", "Board status not found.");
  }

  let status =
    statusId &&
    statuses.find((item: any) => {
      const id = item._id?.toString?.() || item._id;
      return id === statusId || item.id === statusId;
    });

  if (!status && task.status) {
    status = statuses.find((item: any) => item.category === task.status);
  }

  if (!status) {
    status = statuses[0];
  }

  const statusIdValue = status._id?.toString?.() || status._id;
  const now = new Date();

  const orConds: any[] = [{ taskId: taskIdQuery }];
  if (normalizedTaskIdQuery) orConds.push({ taskId: normalizedTaskIdQuery });
  orConds.push({ taskCanonicalId: taskIdQuery });
  if (normalizedTaskIdQuery) orConds.push({ taskCanonicalId: normalizedTaskIdQuery });
  await db.collection("boardItems").deleteMany({
    userId: userIdQuery,
    workspaceId,
    $or: orConds,
  });

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

  const updatedTask = await db.collection("tasks").findOne({
    userId: userIdQuery,
    _id: task._id,
  });

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
    taskCanonicalId: task._id?.toString?.() || task._id,
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
  }

  return NextResponse.json({
    ...serializeTask(updatedTask || task),
    boardItemId: item._id,
    boardStatusId: item.statusId,
    boardRank: item.rank,
    boardCreatedAt: item.createdAt,
    boardUpdatedAt: item.updatedAt,
    boardId,
  });
}
