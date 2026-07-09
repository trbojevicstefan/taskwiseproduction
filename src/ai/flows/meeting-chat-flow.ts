'use server';

import { answerFromTranscript } from "@/ai/flows/transcript-qa-flow";
import { refineTasks } from "@/ai/flows/refine-tasks-flow";
import {
  decideMeetingChatAction,
  mergeSelectedMeetingTaskUpdates,
} from "@/lib/meeting-chat";

export type MeetingChatInput = {
  message: string;
  transcript: string;
  meetingTasks: any[];
  selectedTaskIds: string[];
  selectedTasks?: any[];
  requestedDetailLevel?: "light" | "medium" | "detailed";
};

export type MeetingChatOutput =
  | {
      kind: "answer";
      answerText: string;
      needsSelection?: false;
      sources?: { timestamp: string; snippet: string }[];
    }
  | {
      kind: "task_update";
      answerText: string;
      needsSelection?: false;
      updatedTasks: any[];
    }
  | {
      kind: "needs_selection";
      answerText: string;
      needsSelection: true;
    };

const collectTasksByIds = (
  tasks: any[],
  selectedTaskIds: Set<string>
): any[] => {
  const walk = (items: any[]): any[] =>
    items
      .map((task) => {
        const selectedSubtasks = task.subtasks?.length ? walk(task.subtasks) : [];
        const isSelected = selectedTaskIds.has(String(task.id));
        if (isSelected || selectedSubtasks.length > 0) {
          return {
            ...task,
            subtasks: selectedSubtasks.length ? selectedSubtasks : task.subtasks,
          };
        }
        return null;
      })
      .filter(Boolean);
  return walk(tasks);
};

const pickUpdatesById = (
  tasks: any[],
  selectedTaskIds: Set<string>
): any[] =>
  collectTasksByIds(tasks, selectedTaskIds);

export async function answerMeetingChat(
  input: MeetingChatInput
): Promise<MeetingChatOutput> {
  const selectedTaskIds = new Set(input.selectedTaskIds.map(String));
  const decision = decideMeetingChatAction({
    message: input.message,
    selectedTaskIds,
  });

  if (decision.kind === "needs_selection") {
    return {
      kind: "needs_selection",
      needsSelection: true,
      answerText: "Select one or more meeting tasks first.",
    };
  }

  if (decision.kind === "answer") {
    const result = await answerFromTranscript({
      question: input.message,
      transcript: input.transcript,
      tasks: input.meetingTasks,
    });
    return {
      kind: "answer",
      answerText: result.answerText,
      sources: result.sources,
    };
  }

  const selectedTasks =
    input.selectedTasks && input.selectedTasks.length > 0
      ? input.selectedTasks
      : collectTasksByIds(input.meetingTasks, selectedTaskIds);

  const refined = await refineTasks({
    instruction: input.message,
    fullTaskList: input.meetingTasks,
    tasksToRefine: selectedTasks,
  });

  const selectedUpdates = pickUpdatesById(
    refined.updatedTasks,
    selectedTaskIds
  );
  const updatedTasks = mergeSelectedMeetingTaskUpdates(
    input.meetingTasks,
    selectedUpdates
  );

  return {
    kind: "task_update",
    answerText: refined.chatResponseText,
    updatedTasks,
  };
}
