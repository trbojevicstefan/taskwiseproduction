import type { ExtractedTaskSchema } from "@/types/chat";

type MeetingTaskLike = Pick<ExtractedTaskSchema, "id"> & {
  subtasks?: MeetingTaskLike[] | null;
};

type MeetingTaskValidationResult =
  | { valid: true; invalidTaskIds: [] }
  | { valid: false; invalidTaskIds: string[] };

export type MeetingChatDecision =
  | { kind: "answer" }
  | { kind: "needs_selection" }
  | { kind: "task_update" };

export type MeetingChatDecisionInput = {
  message: string;
  selectedTaskIds: Set<string>;
};

const MEETING_TASK_EDIT_REGEX =
  /\b(rename|edit|update|assign|reassign|delete|remove|archive|mark|complete|completed|due|deadline|priority|break down|split|merge|simplify)\b/i;

const collectTaskIds = (tasks: MeetingTaskLike[], ids = new Set<string>()) => {
  tasks.forEach((task) => {
    if (task?.id) {
      ids.add(String(task.id));
    }
    if (Array.isArray(task?.subtasks) && task.subtasks.length > 0) {
      collectTaskIds(task.subtasks, ids);
    }
  });
  return ids;
};

const mergeTaskTree = (
  meetingTasks: ExtractedTaskSchema[],
  updatesById: Map<string, ExtractedTaskSchema>
): ExtractedTaskSchema[] =>
  meetingTasks.map((task) => {
    const updatedTask = updatesById.get(String(task.id));
    if (updatedTask) {
      return updatedTask;
    }
    if (Array.isArray(task.subtasks) && task.subtasks.length > 0) {
      return {
        ...task,
        subtasks: mergeTaskTree(task.subtasks, updatesById),
      };
    }
    return task;
  });

export const validateSelectedMeetingTaskIds = (
  meetingTasks: MeetingTaskLike[],
  selectedTaskIds: Set<string>
): MeetingTaskValidationResult => {
  const meetingTaskIds = collectTaskIds(meetingTasks);
  const invalidTaskIds = Array.from(selectedTaskIds).filter(
    (taskId) => !meetingTaskIds.has(String(taskId))
  );
  if (invalidTaskIds.length > 0) {
    return { valid: false, invalidTaskIds };
  }
  return { valid: true, invalidTaskIds: [] };
};

export const mergeSelectedMeetingTaskUpdates = (
  meetingTasks: ExtractedTaskSchema[],
  updatedSelectedTasks: ExtractedTaskSchema[]
): ExtractedTaskSchema[] => {
  const updatesById = new Map(
    updatedSelectedTasks.map((task) => [String(task.id), task])
  );
  return mergeTaskTree(meetingTasks, updatesById);
};

export const decideMeetingChatAction = (
  input: MeetingChatDecisionInput
): MeetingChatDecision => {
  const message = input.message.trim();
  if (MEETING_TASK_EDIT_REGEX.test(message)) {
    return input.selectedTaskIds.size > 0
      ? { kind: "task_update" }
      : { kind: "needs_selection" };
  }
  return { kind: "answer" };
};
