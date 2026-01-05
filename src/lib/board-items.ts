import { randomUUID } from "crypto";
import type { Db } from "mongodb";
import type { ExtractedTaskSchema } from "@/types/chat";
import { buildIdQuery } from "@/lib/mongo-id";

const collectTopLevelIds = (tasks: ExtractedTaskSchema[]) =>
  (tasks || []).map((task) => task.id).filter(Boolean);

export const ensureBoardItemsForTasks = async (
  db: Db,
  {
    userId,
    workspaceId,
    boardId,
    tasks,
  }: {
    userId: string;
    workspaceId: string;
    boardId: string;
    tasks: ExtractedTaskSchema[];
  }
) => {
  const taskIds = collectTopLevelIds(tasks);
  if (!taskIds.length) return { created: 0 };

  const userIdQuery = buildIdQuery(userId);
  const statuses = await db
    .collection<any>("boardStatuses")
    .find({ userId: userIdQuery, workspaceId, boardId })
    .sort({ order: 1 })
    .toArray();
  if (!statuses.length) return { created: 0 };

  const defaultStatusId = statuses[0]._id?.toString?.() || statuses[0]._id;
  const statusByCategory = new Map<string, string>();
  statuses.forEach((status) => {
    const id = status._id?.toString?.() || status._id;
    statusByCategory.set(status.category || "todo", id);
  });

  const existing = await db
    .collection<any>("boardItems")
    .find({ userId: userIdQuery, workspaceId, boardId, taskId: { $in: taskIds } })
    .project({ taskId: 1 })
    .toArray();
  const existingIds = new Set(existing.map((item) => String(item.taskId)));

  const now = new Date();
  const ranksByStatus = new Map<string, number>();
  for (const status of statuses) {
    const statusId = status._id?.toString?.() || status._id;
    const lastItem = await db
      .collection<any>("boardItems")
      .find({ userId: userIdQuery, workspaceId, boardId, statusId })
      .sort({ rank: -1 })
      .limit(1)
      .toArray();
    const baseRank = typeof lastItem[0]?.rank === "number" ? lastItem[0].rank : 0;
    ranksByStatus.set(statusId, baseRank);
  }

  const newItems = tasks
    .filter((task) => task && task.id && !existingIds.has(task.id))
    .map((task) => {
      const statusCategory = task.status || "todo";
      const statusId = statusByCategory.get(statusCategory) || defaultStatusId;
      const nextRank = (ranksByStatus.get(statusId) || 0) + 1000;
      ranksByStatus.set(statusId, nextRank);

      return {
        _id: randomUUID(),
        userId,
        workspaceId,
        boardId,
        taskId: task.id,
        statusId,
        rank: nextRank,
        createdAt: now,
        updatedAt: now,
      };
    });

  if (newItems.length) {
    await db.collection<any>("boardItems").insertMany(newItems);
  }

  return { created: newItems.length };
};
