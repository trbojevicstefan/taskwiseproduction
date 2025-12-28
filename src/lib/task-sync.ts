import type { Db } from "mongodb";
import type { ExtractedTaskSchema } from "@/types/chat";
import { normalizeTask } from "@/lib/data";
import { normalizePersonNameKey } from "@/lib/transcript-utils";
import { buildIdQuery } from "@/lib/mongo-id";

export type TaskOrigin = "manual" | "meeting" | "chat";
export type TaskSourceType = "meeting" | "chat";

export interface TaskSyncOptions {
  userId: string;
  sourceSessionId: string;
  sourceSessionType: TaskSourceType;
  sourceSessionName?: string | null;
  origin?: TaskOrigin;
}

export interface TaskSyncResult {
  upserted: number;
  deleted: number;
}

const buildTaskRecords = (
  tasks: ExtractedTaskSchema[],
  options: TaskSyncOptions,
  now: Date
) => {
  const records: any[] = [];
  const ids: string[] = [];
  const origin = options.origin || options.sourceSessionType;

  const walk = (items: ExtractedTaskSchema[], parentId: string | null) => {
    items.forEach((item, index) => {
      const task = normalizeTask(item);
      ids.push(task.id);
      const assigneeNameRaw = task.assigneeName || task.assignee?.name || null;
      const assigneeNameKey = assigneeNameRaw
        ? normalizePersonNameKey(assigneeNameRaw)
        : null;

      records.push({
        _id: task.id,
        userId: options.userId,
        title: task.title,
        description: task.description || "",
        status: task.status || "todo",
        priority: task.priority || "medium",
        dueAt: task.dueAt ?? null,
        assignee: task.assignee ?? null,
        assigneeName: task.assigneeName ?? null,
        assigneeNameKey,
        sourceEvidence: task.sourceEvidence ?? null,
        aiProvider: task.aiProvider ?? null,
        comments: task.comments ?? null,
        taskType: task.taskType ?? null,
        completionSuggested: task.completionSuggested ?? null,
        completionConfidence: task.completionConfidence ?? null,
        completionEvidence: task.completionEvidence ?? null,
        completionTargets: task.completionTargets ?? null,
        aiSuggested: true,
        origin,
        sourceSessionId: options.sourceSessionId,
        sourceSessionName: options.sourceSessionName ?? null,
        sourceSessionType: options.sourceSessionType,
        sourceTaskId: task.id,
        projectId: null,
        parentId,
        order: index,
        subtaskCount: task.subtasks?.length || 0,
        lastUpdated: now,
      });

      if (task.subtasks?.length) {
        walk(task.subtasks, task.id);
      }
    });
  };

  walk(tasks, null);
  return { records, ids };
};

export const syncTasksForSource = async (
  db: Db,
  tasks: ExtractedTaskSchema[],
  options: TaskSyncOptions
): Promise<TaskSyncResult> => {
  const now = new Date();
  const { records, ids } = buildTaskRecords(tasks, options, now);
  const userIdQuery = buildIdQuery(options.userId);
  const sessionIdQuery = buildIdQuery(options.sourceSessionId);

  await Promise.all(
    records.map(({ _id, ...rest }) =>
      db.collection("tasks").updateOne(
        { _id, userId: userIdQuery },
        { $set: rest, $setOnInsert: { createdAt: now } },
        { upsert: true }
      )
    )
  );

  const deleteFilter: Record<string, any> = {
    userId: userIdQuery,
    sourceSessionType: options.sourceSessionType,
    $or: [{ sourceSessionId: sessionIdQuery }, { sourceSessionId: options.sourceSessionId }],
  };

  if (ids.length > 0) {
    deleteFilter._id = { $nin: ids };
  }

  const deleteResult = await db
    .collection("tasks")
    .deleteMany(deleteFilter);

  return { upserted: records.length, deleted: deleteResult.deletedCount || 0 };
};
