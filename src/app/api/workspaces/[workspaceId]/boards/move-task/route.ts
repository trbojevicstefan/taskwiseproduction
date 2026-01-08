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

const getNextRank = async (db: any, filter: Record<string, any>) => {
  const lastItem = await db
    .collection<any>("boardItems")
    .find(filter)
    .sort({ rank: -1 })
    .limit(1)
    .toArray();
  const lastRank = typeof lastItem[0]?.rank === "number" ? lastItem[0].rank : 0;
  return lastRank + 1000;
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
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const boardId = typeof body.boardId === "string" ? body.boardId : "";
  const taskId = typeof body.taskId === "string" ? body.taskId : "";
  const statusId = typeof body.statusId === "string" ? body.statusId : null;

  if (!workspaceId || !boardId || !taskId) {
    return NextResponse.json(
      { error: "Workspace ID, board ID, and task ID are required." },
      { status: 400 }
    );
  }

  const db = await getDb();
  const userIdQuery = buildIdQuery(userId);
  const taskIdQuery = buildIdQuery(taskId);

  const task = await db.collection<any>("tasks").findOne({
    userId: userIdQuery,
    $or: [{ _id: taskIdQuery }, { id: taskId }],
  });
  if (!task) {
    return NextResponse.json({ error: "Task not found." }, { status: 404 });
  }

  const statuses = await db
    .collection<any>("boardStatuses")
    .find({ userId: userIdQuery, workspaceId, boardId })
    .sort({ order: 1 })
    .toArray();
  if (!statuses.length) {
    return NextResponse.json({ error: "Board status not found." }, { status: 404 });
  }

  let status =
    statusId &&
    statuses.find((item) => {
      const id = item._id?.toString?.() || item._id;
      return id === statusId || item.id === statusId;
    });

  if (!status && task.status) {
    status = statuses.find((item) => item.category === task.status);
  }

  if (!status) {
    status = statuses[0];
  }

  const statusIdValue = status._id?.toString?.() || status._id;
  const now = new Date();

  await db.collection<any>("boardItems").deleteMany({
    userId: userIdQuery,
    workspaceId,
    taskId: taskIdQuery,
  });

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

  const updatedTask = await db.collection<any>("tasks").findOne({
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
    statusId: statusIdValue,
    rank,
    createdAt: now,
    updatedAt: now,
  };

  await db.collection<any>("boardItems").insertOne(item);

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
