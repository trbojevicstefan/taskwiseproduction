import { randomUUID } from "crypto";
import type { Db } from "mongodb";
import type { ExtractedTaskSchema } from "@/types/chat";

const collectTopLevelIds = (tasks: ExtractedTaskSchema[]) =>
  Array.from(
    new Set((tasks || []).map((task: any) => String(task?.id || "")).filter(Boolean))
  );

const isDuplicateKeyError = (error: any) => {
  if (!error) return false;
  if (error.code === 11000) return true;
  if (Array.isArray(error.writeErrors)) {
    return error.writeErrors.some((entry: any) => entry?.code === 11000);
  }
  const message = String(error.message || "");
  return message.includes("E11000 duplicate key error");
};

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

  const statuses = await db
    .collection("boardStatuses")
    .find({ workspaceId, boardId })
    .sort({ order: 1 })
    .toArray();
  if (!statuses.length) return { created: 0 };

  const defaultStatusId = String(statuses[0]._id?.toString?.() || statuses[0]._id);
  const statusByCategory = new Map<string, string>();
  statuses.forEach((status: any) => {
    const id = String(status._id?.toString?.() || status._id);
    statusByCategory.set(status.category || "todo", id);
  });

  // Map extracted task ids to canonical tasks._id when available to avoid
  // creating board items that reference non-canonical ids.
  const canonicalMap = new Map();
  const foundTasks = await db
    .collection("tasks")
    .find({ workspaceId, sourceTaskId: { $in: taskIds } })
    .project({ _id: 1, sourceTaskId: 1 })
    .toArray();
  foundTasks.forEach((t: any) => {
    if (t && t.sourceTaskId) {
      canonicalMap.set(String(t.sourceTaskId), String(t._id?.toString?.() || t._id));
    }
  });

  const resolvedTaskIds = new Set<string>(taskIds);
  taskIds.forEach((sourceTaskId) => {
    const canonicalTaskId = canonicalMap.get(sourceTaskId);
    if (canonicalTaskId) {
      resolvedTaskIds.add(canonicalTaskId);
    }
  });

  const lookupTaskIds = Array.from(resolvedTaskIds);
  const existing = await db
    .collection("boardItems")
    .find({
      workspaceId,
      boardId,
      $or: [{ taskId: { $in: lookupTaskIds } }, { taskCanonicalId: { $in: lookupTaskIds } }],
    })
    .project({ taskId: 1, taskCanonicalId: 1 })
    .toArray();
  const existingTaskIds = new Set<string>();
  existing.forEach((item: any) => {
    const taskId = String(item?.taskId || "").trim();
    const taskCanonicalId = String(item?.taskCanonicalId || "").trim();
    if (taskId) existingTaskIds.add(taskId);
    if (taskCanonicalId) existingTaskIds.add(taskCanonicalId);
  });

  const now = new Date();
  const ranksByStatus = new Map<string, number>();
  for (const status of statuses) {
    const statusId = String(status._id?.toString?.() || status._id);
    const lastItem = await db
      .collection("boardItems")
      .find({ workspaceId, boardId, statusId })
      .sort({ rank: -1 })
      .limit(1)
      .toArray();
    const baseRank = typeof lastItem[0]?.rank === "number" ? lastItem[0].rank : 0;
    ranksByStatus.set(statusId, baseRank);
  }

  const newItems = tasks
    .filter((task: any) => {
      const sourceTaskId = String(task?.id || "").trim();
      if (!sourceTaskId) return false;
      const canonicalTaskId = canonicalMap.get(sourceTaskId) || null;
      const projectionTaskId = canonicalTaskId || sourceTaskId;
      return !existingTaskIds.has(sourceTaskId) && !existingTaskIds.has(projectionTaskId);
    })
    .map((task: any) => {
      const sourceTaskId = String(task.id);
      const canonicalTaskId = canonicalMap.get(sourceTaskId) || null;
      const projectionTaskId = canonicalTaskId || sourceTaskId;
      const statusCategory = task.status || "todo";
      const statusId = statusByCategory.get(statusCategory) || defaultStatusId;
      const nextRank = (ranksByStatus.get(statusId) || 0) + 1000;
      ranksByStatus.set(statusId, nextRank);

      return {
        _id: randomUUID(),
        userId,
        workspaceId,
        boardId,
        taskId: projectionTaskId,
        taskCanonicalId: canonicalTaskId,
        statusId,
        rank: nextRank,
        createdAt: now,
        updatedAt: now,
      };
    });

  let created = 0;
  if (newItems.length) {
    try {
      const result = await db.collection("boardItems").bulkWrite(
        newItems.map((item: any) => ({
          updateOne: {
            filter: {
              workspaceId,
              boardId,
              taskId: item.taskId,
            },
            update: { $setOnInsert: item },
            upsert: true,
          },
        })),
        { ordered: false }
      );
      created = result.upsertedCount || 0;
    } catch (error: any) {
      if (!isDuplicateKeyError(error)) {
        throw error;
      }
      created = error?.result?.upsertedCount || error?.result?.nUpserted || 0;
    }
  }

  return { created };
};
