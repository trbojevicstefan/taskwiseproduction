import { getDb } from "@/lib/db";
import { normalizeTask } from "@/lib/data";
import type { ExtractedTaskSchema, TaskReferenceSchema } from "@/types/chat";
import { TASK_LIST_PROJECTION } from "@/lib/task-projections";

type TaskLike = ExtractedTaskSchema | TaskReferenceSchema;

const walkTaskItems = (
  items: TaskLike[],
  visitor: (item: any) => void
) => {
  items.forEach((item: any) => {
    visitor(item);
    if (Array.isArray(item?.subtasks) && item.subtasks.length > 0) {
      walkTaskItems(item.subtasks as TaskLike[], visitor);
    }
  });
};

const collectTaskLookupKeys = (lists: TaskLike[][]) => {
  const taskIds = new Set<string>();
  const sourceTaskIds = new Set<string>();

  lists.forEach((items: any) => {
    walkTaskItems(items, (item: any) => {
      const canonicalId = item.taskId || item.taskCanonicalId || item._id;
      if (canonicalId) {
        taskIds.add(String(canonicalId));
      }
      if (item.id && !item.title) {
        sourceTaskIds.add(String(item.id));
      }
      if (
        item.sourceTaskId &&
        !canonicalId &&
        (item.id == null || !item.title)
      ) {
        sourceTaskIds.add(String(item.sourceTaskId));
      }
    });
  });

  return { taskIds, sourceTaskIds };
};

const toHydratedTask = (
  item: any,
  canonicalMap: Map<string, any>
): ExtractedTaskSchema | null => {
  const canonicalId = item.taskId || item.taskCanonicalId || item._id;
  const lookupId = canonicalId ? String(canonicalId) : item.id ? String(item.id) : null;
  const found = lookupId ? canonicalMap.get(lookupId) : null;

  if (found) {
    const hydrated = normalizeTask({
      ...found,
      id:
        item.id ||
        item.sourceTaskId ||
        found.sourceTaskId ||
        found.id ||
        String(found._id),
      taskCanonicalId: String(found._id),
    });
    if (Array.isArray(item?.subtasks)) {
      const hydratedSubtasks = item.subtasks
        .map((subtask: any) => toHydratedTask(subtask, canonicalMap))
        .filter(
          (subtask: ExtractedTaskSchema | null): subtask is ExtractedTaskSchema =>
            subtask !== null
        );
      hydrated.subtasks = hydratedSubtasks.length ? hydratedSubtasks : null;
    }
    return hydrated;
  }

  if (canonicalId) {
    // The task was referenced but no longer exists in canonical storage.
    return null;
  }

  return normalizeTask(item);
};

export const hydrateTaskReferences = async (
  userId: string,
  items: TaskLike[],
  options?: { workspaceId?: string | null }
): Promise<ExtractedTaskSchema[]> => {
  const [hydrated] = await hydrateTaskReferenceLists(userId, [items], options);
  return hydrated || [];
};

export const hydrateTaskReferenceLists = async (
  userId: string,
  lists: TaskLike[][],
  options?: { workspaceId?: string | null }
): Promise<ExtractedTaskSchema[][]> => {
  if (!lists.length) return [];
  if (lists.every((items) => !items || items.length === 0)) {
    return lists.map(() => []);
  }

  const { taskIds, sourceTaskIds } = collectTaskLookupKeys(lists);
  if (!taskIds.size && !sourceTaskIds.size) {
    return lists.map((items: any) => items.map((item: any) => normalizeTask(item)));
  }

  const db = await getDb();
  const orClauses: any[] = [];

  if (taskIds.size) {
    const ids = Array.from(taskIds);
    orClauses.push({ _id: { $in: ids } });
    orClauses.push({ id: { $in: ids } });
  }
  if (sourceTaskIds.size) {
    orClauses.push({ sourceTaskId: { $in: Array.from(sourceTaskIds) } });
  }

  if (!orClauses.length) {
    return lists.map((items: any) => items.map((item: any) => normalizeTask(item)));
  }

  const workspaceId =
    typeof options?.workspaceId === "string" ? options.workspaceId.trim() : "";
  const scopeFilter = workspaceId ? { workspaceId } : { userId };

  const canonicalTasks = await db
    .collection("tasks")
    .find(
      {
        ...scopeFilter,
        $or: orClauses,
      },
      { projection: TASK_LIST_PROJECTION }
    )
    .toArray();

  const canonicalMap = new Map<string, any>();
  canonicalTasks.forEach((task: any) => {
    canonicalMap.set(String(task._id), task);
    if (task.sourceTaskId) {
      canonicalMap.set(String(task.sourceTaskId), task);
    }
  });

  return lists.map((items: any) =>
    items
      .map((item: any) => toHydratedTask(item, canonicalMap))
      .filter(
        (item: ExtractedTaskSchema | null): item is ExtractedTaskSchema =>
          item !== null
      )
  );
};

