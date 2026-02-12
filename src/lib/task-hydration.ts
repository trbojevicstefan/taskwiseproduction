import { getDb } from "@/lib/db";
import { buildIdQuery } from "@/lib/mongo-id";
import { normalizeTask } from "@/lib/data";
import type { ExtractedTaskSchema, TaskReferenceSchema } from "@/types/chat";

export const hydrateTaskReferences = async (
  userId: string,
  items: Array<ExtractedTaskSchema | TaskReferenceSchema>
): Promise<ExtractedTaskSchema[]> => {
  if (!items || !items.length) return [];

  const db = await getDb();
  const userIdQuery = buildIdQuery(userId);

  // Collect all taskIds and sourceTaskIds
  const taskIds = new Set<string>();
  const sourceTaskIds = new Set<string>();

  // Keep map of ID -> reference items to merge overrides later
  const refMap = new Map<string, TaskReferenceSchema>();

  items.forEach((item: any) => {
    // Check if it's already a full task (has title, etc.) or just a reference
    // We treat "taskId" or "taskCanonicalId" as the link
    const canonicalId = item.taskId || item.taskCanonicalId || item._id;
    if (canonicalId) {
      taskIds.add(String(canonicalId));
      if (!item.title) {
        // It's likely a thin reference, store for merging
        refMap.set(String(canonicalId), item);
      }
    }

    // Fallback for legacy items that might haven't synced canonical ID yet but have sourceTaskId
    if (item.id && !item.title) {
      // If it lacks title, it's a reference, but maybe only has sourceTaskId? 
      // Actually, thin views MUST have a way to link.
      // If we only have `id` (sourceTaskId), we try to find by that.
      sourceTaskIds.add(item.id);
      refMap.set(item.id, item);
    }
  });

  if (!taskIds.size && !sourceTaskIds.size) {
    // All items seem to be full objects already or invalid? 
    // If they have titles, we assume they are full objects (legacy or just hydrated).
    // We just ensure they are normalized.
    return items.map((t: any) => normalizeTask(t));
  }

  // Fetch from DB
  const orClauses: any[] = [];
  if (taskIds.size) {
    orClauses.push({ _id: { $in: Array.from(taskIds).map(id => buildIdQuery(id)) } });
    orClauses.push({ id: { $in: Array.from(taskIds) } }); // Checking both _id and id fields
  }
  if (sourceTaskIds.size) {
    orClauses.push({ sourceTaskId: { $in: Array.from(sourceTaskIds) } });
  }

  if (!orClauses.length) return items.map((t: any) => normalizeTask(t));

  const canonicalTasks = await db.collection("tasks")
    .find({
      userId: userIdQuery,
      $or: orClauses
    })
    .toArray();

  const canonicalMap = new Map<string, any>();
  canonicalTasks.forEach((t: any) => {
    canonicalMap.set(String(t._id), t);
    if (t.sourceTaskId) canonicalMap.set(String(t.sourceTaskId), t);
  });

  // Reconstruct list, filtering out ghosts (items with canonical ID that weren't found)
  const hydrated: ExtractedTaskSchema[] = items
    .map((item: any) => {
      const canonicalId = item.taskId || item.taskCanonicalId || item._id;
      const lookupId = canonicalId ? String(canonicalId) : item.id;

      const found = canonicalMap.get(lookupId);

      if (found) {
        const base = normalizeTask({
          ...found,
          id: found.sourceTaskId || found.id || String(found._id),
          taskCanonicalId: String(found._id),
        });

        // Merge necessary overrides if preserving any specific session metadata is needed
        // For now, simply return the canonical version as SSoT
        return {
          ...base,
          // If the item passed in had an ID, we assume the frontend uses the sourceTaskId (item.id)
          // unless we migrate frontend to use canonical IDs entirely.
          id: item.id || base.id,
        };
      }

      // If we looked for a canonical ID but didn't find it, it's a ghost (deleted task).
      // We filter these out by returning null here and filtering below.
      if (canonicalId) {
        return null;
      }

      // If no canonical ID was present on the item, it's likely a legacy embedded object 
      // or a temporary item. We preserve it.
      return normalizeTask(item);
    })
    .filter((t): t is ExtractedTaskSchema => t !== null);

  return hydrated;
};
