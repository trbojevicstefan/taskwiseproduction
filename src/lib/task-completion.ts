export {
  applyCompletionTargets,
  filterTasksForSessionSync,
  mergeCompletionSuggestions,
} from "@/lib/task-completion-sync";

export { buildCompletionSuggestions } from "@/lib/task-completion-detection";
export { normalizeEmail } from "@/lib/task-completion-helpers";

export type CompletionTarget = {
  sourceType: "task" | "meeting" | "chat";
  sourceSessionId: string;
  taskId: string;
  sourceSessionName?: string | null;
};


