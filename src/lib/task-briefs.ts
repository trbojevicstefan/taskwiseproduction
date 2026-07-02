import type { BriefContext } from "@/lib/brief-context";
import { generateTaskBrief } from "@/lib/task-insights-client";
import type { ExtractedTaskSchema } from "@/types/chat";

export type BatchBriefSuccess = {
  taskId: string;
  brief: string;
};

export type BatchBriefFailure = {
  taskId: string;
  error: string;
};

export type BatchBriefGenerationResult = {
  successes: BatchBriefSuccess[];
  failures: BatchBriefFailure[];
  limitReached: boolean;
};

type ResolveTask = (taskId: string) => ExtractedTaskSchema | null | undefined;
type ResolveBriefContext = (
  task: ExtractedTaskSchema
) => BriefContext | Promise<BriefContext>;

const getTaskAssigneeName = (task: ExtractedTaskSchema) =>
  task.assignee?.name || task.assigneeName || undefined;

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Could not generate brief.";

export const isBriefLimitReachedError = (error: unknown) =>
  getErrorMessage(error).toLowerCase().includes("monthly ai brief limit reached");

export const generateBriefsForTasks = async ({
  taskIds,
  resolveTask,
  resolveBriefContext,
}: {
  taskIds: Iterable<string>;
  resolveTask: ResolveTask;
  resolveBriefContext?: ResolveBriefContext;
}): Promise<BatchBriefGenerationResult> => {
  const successes: BatchBriefSuccess[] = [];
  const failures: BatchBriefFailure[] = [];
  let limitReached = false;

  for (const taskId of taskIds) {
    const task = resolveTask(taskId);
    if (!task) {
      failures.push({ taskId, error: "Task not found." });
      continue;
    }

    try {
      const briefContext = resolveBriefContext
        ? await Promise.resolve(resolveBriefContext(task))
        : undefined;
      const result = await generateTaskBrief({
        taskTitle: task.title || "Untitled task",
        taskDescription: task.description || undefined,
        assigneeName: getTaskAssigneeName(task),
        taskPriority: task.priority,
        primaryTranscript: briefContext?.primaryTranscript || undefined,
        relatedTranscripts: briefContext?.relatedTranscripts?.length
          ? briefContext.relatedTranscripts
          : undefined,
        meetingTimeline: briefContext?.meetingTimeline?.length
          ? briefContext.meetingTimeline
          : undefined,
      });
      successes.push({ taskId, brief: result.researchBrief });
    } catch (error) {
      const message = getErrorMessage(error);
      failures.push({ taskId, error: message });
      if (isBriefLimitReachedError(error)) {
        limitReached = true;
        break;
      }
    }
  }

  return { successes, failures, limitReached };
};
