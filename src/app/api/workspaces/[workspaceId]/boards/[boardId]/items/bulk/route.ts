import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { buildIdQuery } from "@/lib/mongo-id";
import { normalizePersonNameKey } from "@/lib/transcript-utils";

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
  const taskIds = Array.isArray(body.taskIds)
    ? body.taskIds.map((id: any) => String(id)).filter(Boolean)
    : [];
  if (taskIds.length === 0) {
    return NextResponse.json({ error: "taskIds is required." }, { status: 400 });
  }

  const db = await getDb();
  const userIdQuery = buildIdQuery(userId);
  const taskIdFilters = taskIds.flatMap((id) => [
    { _id: buildIdQuery(id) },
    { id },
  ]);
  const now = new Date();
  const taskUpdate: Record<string, any> = { lastUpdated: now };
  const updates = body.updates || {};

  if (typeof updates.priority === "string") {
    taskUpdate.priority = updates.priority;
  }
  if (typeof updates.dueAt === "string" || updates.dueAt === null) {
    taskUpdate.dueAt = updates.dueAt;
  }
  if (typeof updates.assignee === "object" || updates.assignee === null) {
    taskUpdate.assignee = updates.assignee;
  }
  if (typeof updates.assigneeName === "string" || updates.assigneeName === null) {
    taskUpdate.assigneeName = updates.assigneeName;
    const rawName = updates.assigneeName || updates.assignee?.name || null;
    taskUpdate.assigneeNameKey = rawName ? normalizePersonNameKey(rawName) : null;
  }

  let statusIdValue: string | null = null;
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
    statusIdValue = status._id?.toString?.() || status._id || body.statusId;
    statusCategory = status.category;
    taskUpdate.status = statusCategory;
  }

  if (Object.keys(taskUpdate).length > 1) {
    await db.collection<any>("tasks").updateMany(
      {
        userId: userIdQuery,
        $or: taskIdFilters,
      },
      { $set: taskUpdate }
    );
  }

  if (statusIdValue) {
    const lastItem = await db
      .collection<any>("boardItems")
      .find({ userId: userIdQuery, workspaceId, boardId, statusId: statusIdValue })
      .sort({ rank: -1 })
      .limit(1)
      .toArray();
    let nextRank = typeof lastItem[0]?.rank === "number" ? lastItem[0].rank : 0;

    const operations = taskIds.map((taskId) => {
      nextRank += 1000;
      return {
        updateOne: {
          filter: { userId: userIdQuery, workspaceId, boardId, taskId },
          update: {
            $set: {
              statusId: statusIdValue,
              rank: nextRank,
              updatedAt: now,
            },
          },
        },
      };
    });
    if (operations.length) {
      await db.collection<any>("boardItems").bulkWrite(operations);
    }
  }

  return NextResponse.json({ ok: true });
}
