import { normalizeTitleKey } from "@/lib/ai-utils";
import { buildAssigneeKey } from "@/lib/task-completion-helpers";
import type { ExtractedTaskSchema } from "@/types/chat";

export const mergeCompletionSuggestions = (
  tasks: ExtractedTaskSchema[],
  suggestions: ExtractedTaskSchema[]
): ExtractedTaskSchema[] => {
  if (!suggestions.length) return tasks;

  const matchKey = (task: ExtractedTaskSchema) => {
    const assigneeName = task.assignee?.name || task.assigneeName || "";
    const assigneeEmail = task.assignee?.email || "";
    const assigneeKey = buildAssigneeKey(assigneeName, assigneeEmail, true);
    return `${normalizeTitleKey(task.title)}|${assigneeKey}`;
  };

  const suggestionByKey = new Map<string, ExtractedTaskSchema>();
  suggestions.forEach((suggestion: any) => {
    const key = matchKey(suggestion);
    if (!key) return;
    suggestionByKey.set(key, suggestion);
  });

  const applySuggestions = (items: ExtractedTaskSchema[]): ExtractedTaskSchema[] =>
    items.map((task: any) => {
      const key = matchKey(task);
      const suggestion = suggestionByKey.get(key);
      if (suggestion) {
        suggestionByKey.delete(key);
        return {
          ...task,
          status: task.status || "todo",
          completionSuggested: true,
          completionConfidence: suggestion.completionConfidence ?? null,
          completionEvidence: suggestion.completionEvidence ?? null,
          completionTargets: suggestion.completionTargets ?? null,
        };
      }
      if (task.subtasks?.length) {
        return { ...task, subtasks: applySuggestions(task.subtasks) };
      }
      return task;
    });

  const updated = applySuggestions(tasks);
  const remaining = Array.from(suggestionByKey.values()).map((suggestion: any) => ({
    ...suggestion,
    status: suggestion.status && suggestion.status !== "done" ? suggestion.status : "todo",
    completionSuggested: true,
  }));
  return remaining.length ? [...updated, ...remaining] : updated;
};

export const applyCompletionTargets = async (
  db: any,
  userId: string,
  suggestions: ExtractedTaskSchema[]
) => {
  for (const suggestion of suggestions) {
    if (!suggestion.completionTargets?.length) continue;

    const evidence = suggestion.completionEvidence || undefined;
    const targets = suggestion.completionTargets;

    const directTaskTargets = targets.filter((t) => t.sourceType === "task");
    if (directTaskTargets.length) {
      const taskIds = directTaskTargets.map((t) => t.taskId);
      await db.collection("tasks").updateMany(
        {
          userId,
          $or: [{ _id: { $in: taskIds } }, { id: { $in: taskIds } }],
        },
        {
          $set: {
            status: "done",
            completionEvidence: evidence,
            lastUpdated: new Date(),
          },
        }
      );
    }

    const sessionTargets = targets.filter((t) => t.sourceType !== "task");
    for (const target of sessionTargets) {
      await db.collection("tasks").updateMany(
        {
          userId,
          sourceSessionType: target.sourceType,
          $and: [
            {
              $or: [{ sourceSessionId: target.sourceSessionId }],
            },
            {
              $or: [{ _id: target.taskId }, { sourceTaskId: target.taskId }, { id: target.taskId }],
            },
          ],
        },
        {
          $set: {
            status: "done",
            completionEvidence: evidence,
            completionSuggested: false,
            lastUpdated: new Date(),
          },
        }
      );
    }
  }
};

export const filterTasksForSessionSync = (
  tasks: ExtractedTaskSchema[],
  sessionType: "meeting" | "chat",
  sessionId: string
) => {
  if (!tasks.length) return tasks;
  const sessionKey = String(sessionId);
  const shouldInclude = (task: ExtractedTaskSchema) => {
    if (!task.completionSuggested) return true;
    const targets = task.completionTargets || [];
    if (!targets.length) return true;
    return targets.some(
      (target: any) =>
        target.sourceType === sessionType &&
        String(target.sourceSessionId) === sessionKey
    );
  };

  const walk = (items: ExtractedTaskSchema[]): ExtractedTaskSchema[] =>
    items.reduce<ExtractedTaskSchema[]>((acc, task) => {
      if (!shouldInclude(task)) return acc;
      if (task.subtasks?.length) {
        acc.push({ ...task, subtasks: walk(task.subtasks) });
      } else {
        acc.push(task);
      }
      return acc;
    }, []);

  return walk(tasks);
};
