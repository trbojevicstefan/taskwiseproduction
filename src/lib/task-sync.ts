import type { Db } from "mongodb";
import type { ExtractedTaskSchema } from "@/types/chat";
import { normalizeTask } from "@/lib/data";
import { normalizePersonNameKey } from "@/lib/transcript-utils";

export type TaskOrigin = "manual" | "meeting" | "chat";
export type TaskSourceType = "meeting" | "chat";

export interface TaskSyncOptions {
  userId: string;
  sourceSessionId: string;
  sourceSessionType: TaskSourceType;
  sourceSessionName?: string | null;
  origin?: TaskOrigin;
  workspaceId?: string | null;
  taskState?: "active" | "suggested" | "archived";
}

export interface TaskSyncResult {
  upserted: number;
  deleted: number;
  taskMap: Map<string, string>;
}

const buildTaskRecords = (
  tasks: ExtractedTaskSchema[],
  options: TaskSyncOptions,
  now: Date,
  existingBySourceTaskId: Map<string, string>
) => {
  const records: any[] = [];
  const ids: string[] = [];
  const origin = options.origin || options.sourceSessionType;
  const resolveTaskId = (sourceTaskId: string) =>
    existingBySourceTaskId.get(sourceTaskId) || sourceTaskId;

  const walk = (items: ExtractedTaskSchema[], parentId: string | null) => {
    items.forEach((item, index) => {
      const task = normalizeTask(item);
      const sourceTaskId = task.id;
      const taskId = resolveTaskId(sourceTaskId);
      ids.push(taskId);
      const assigneeNameRaw = task.assigneeName || task.assignee?.name || null;
      const assigneeNameKey = assigneeNameRaw
        ? normalizePersonNameKey(assigneeNameRaw)
        : null;

      records.push({
        _id: taskId,
        userId: options.userId,
        workspaceId: options.workspaceId ?? null,
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
        researchBrief: task.researchBrief ?? null,
        aiAssistanceText: task.aiAssistanceText ?? null,
        taskType: task.taskType ?? null,
        completionSuggested: task.completionSuggested ?? null,
        completionConfidence: task.completionConfidence ?? null,
        completionEvidence: task.completionEvidence ?? null,
        completionTargets: task.completionTargets ?? null,
        aiSuggested: true,
        origin,
        taskState: options.taskState ?? "active",
        sourceSessionId: options.sourceSessionId,
        sourceSessionName: options.sourceSessionName ?? null,
        sourceSessionType: options.sourceSessionType,
        sourceTaskId,
        projectId: null,
        parentId,
        order: index,
        subtaskCount: task.subtasks?.length || 0,
        lastUpdated: now,
      });

      if (task.subtasks?.length) {
        walk(task.subtasks, taskId);
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
  const existingTasks = await db
    .collection("tasks")
    .find({
      userId: options.userId,
      sourceSessionType: options.sourceSessionType,
      sourceSessionId: options.sourceSessionId,
    })
    .project({ _id: 1, sourceTaskId: 1 })
    .toArray();
  const existingBySourceTaskId = new Map<string, string>();
  existingTasks.forEach((task: any) => {
    const key =
      task.sourceTaskId || task._id?.toString?.() || task.id;
    if (!key) return;
    existingBySourceTaskId.set(String(key), task._id);
  });

  const { records, ids } = buildTaskRecords(
    tasks,
    options,
    now,
    existingBySourceTaskId
  );

  const taskMap = new Map<string, string>();
  records.forEach((rec: any) => {
    if (rec.sourceTaskId) {
      taskMap.set(rec.sourceTaskId, String(rec._id));
    }
  });

  if (records.length) {
    await db.collection("tasks").bulkWrite(
      records.map((rec: any) => {
        const { _id, sourceTaskId, ...rest } = rec;
        if (sourceTaskId) {
          return {
            updateOne: {
              filter: {
                userId: options.userId,
                sourceSessionId: options.sourceSessionId,
                sourceTaskId,
              },
              update: { $set: rest, $setOnInsert: { createdAt: now, _id } },
              upsert: true,
            },
          };
        }

        return {
          updateOne: {
            filter: { _id, userId: options.userId },
            update: { $set: rest, $setOnInsert: { createdAt: now } },
            upsert: true,
          },
        };
      }),
      { ordered: false }
    );
  }

  const deleteFilter: Record<string, any> = {
    userId: options.userId,
    sourceSessionType: options.sourceSessionType,
    sourceSessionId: options.sourceSessionId,
  };

  if (ids.length > 0) {
    deleteFilter._id = { $nin: ids };
  }

  const deleteResult = await db
    .collection("tasks")
    .deleteMany(deleteFilter);

  return { upserted: records.length, deleted: deleteResult.deletedCount || 0, taskMap };
};
