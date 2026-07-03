import { normalizeTask } from "@/lib/data";
import type { ExtractedTaskSchema } from "@/types/chat";

export const selectTasksForLevel = (
  allTaskLevels: any,
  detailLevel: "light" | "medium" | "detailed"
) => {
  if (!allTaskLevels) return [];
  return (
    allTaskLevels[detailLevel] ||
    allTaskLevels.medium ||
    allTaskLevels.light ||
    allTaskLevels.detailed ||
    []
  );
};

export const shouldAutoApproveSuggestion = (
  task: ExtractedTaskSchema,
  minMatchRatio: number
) => {
  if (!task.completionSuggested) return false;
  const confidence =
    typeof task.completionConfidence === "number" &&
    Number.isFinite(task.completionConfidence)
      ? task.completionConfidence
      : null;
  if (confidence === null) return false;
  return confidence >= minMatchRatio;
};

export const applyAutoApprovalFlags = (
  tasks: ExtractedTaskSchema[],
  minMatchRatio: number
) => {
  const walk = (items: ExtractedTaskSchema[]): ExtractedTaskSchema[] =>
    items.map((task: any) => {
      const nextTask = {
        ...task,
        subtasks: task.subtasks ? walk(task.subtasks) : task.subtasks,
      };
      if (shouldAutoApproveSuggestion(nextTask, minMatchRatio)) {
        return { ...nextTask, status: "done", completionSuggested: false };
      }
      return nextTask;
    });
  return walk(tasks);
};

export const sanitizeLevels = (levels: any) =>
  levels
    ? {
        light: (levels.light || []).map((task: any) =>
          normalizeTask(task as ExtractedTaskSchema)
        ),
        medium: (levels.medium || []).map((task: any) =>
          normalizeTask(task as ExtractedTaskSchema)
        ),
        detailed: (levels.detailed || []).map((task: any) =>
          normalizeTask(task as ExtractedTaskSchema)
        ),
      }
    : null;

export const resolveDetailLevel = (user: { taskGranularityPreference?: unknown }) => {
  const preference = user.taskGranularityPreference;
  if (preference === "light" || preference === "medium" || preference === "detailed") {
    return preference;
  }
  return "medium";
};

export const resolveCompletionMatchThreshold = (user: { completionMatchThreshold?: unknown }) => {
  const value = user.completionMatchThreshold;
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.min(0.95, Math.max(0.4, value));
  }
  return 0.6;
};

export const resolveCompletionAuditModel = () =>
  process.env.COMPLETION_AUDIT_MODEL ||
  process.env.OPENAI_COMPLETION_AUDIT_MODEL ||
  process.env.OPENAI_MODEL ||
  "gpt-4o-mini";
