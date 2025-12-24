// src/ai/flows/extract-tasks.ts
'use server';

/**
 * @fileOverview This file is the primary ORCHESTRATOR for AI-driven task operations.
 * It uses an initial AI call to classify the user's intent and then delegates the
 * task to the appropriate specialized AI flow. This is more robust than simple string matching.
 */

import { z } from 'zod';
import { ai } from '@/ai/genkit';
import { analyzeMeeting } from './analyze-meeting-flow';
import { refineTasks } from './refine-tasks-flow';
import { answerFromTranscript } from './transcript-qa-flow';
import { extractTasksFromMessage } from './extract-tasks-flow';
import { v4 as uuidv4 } from 'uuid';
import { filterTaskRecursive } from '@/lib/ai-utils';
import type { ExtractedTaskSchema } from '@/types/chat';
import { 
  TaskSchema, 
  OrchestratorInputSchema,
  type OrchestratorInput,
  OrchestratorOutputSchema,
  type OrchestratorOutput,
  type AnalyzeMeetingOutput,
  type RefineTasksOutput,
  type TranscriptQAOutput,
  type ExtractTasksFromMessageOutput,
  PersonSchema,
} from './schemas';

export type { OrchestratorInput, OrchestratorOutput };

type MeetingPerson = NonNullable<AnalyzeMeetingOutput['attendees']>[number];

const isLikelyTaskModification = (message: string): boolean => {
  const trimmed = message.trim();
  const normalized = trimmed.toLowerCase();
  const modificationSignals = [
    "add",
    "create",
    "update",
    "change",
    "edit",
    "rename",
    "reword",
    "remove",
    "delete",
    "assign",
    "reassign",
    "due",
    "deadline",
    "priority",
    "merge",
    "split",
    "break down",
    "simplify",
  ];
  const hasModification = modificationSignals.some((signal) => normalized.includes(signal));
  const taskKeywords = /task|tasks|action item|action items|todo|to-do|follow up|next step/;
  const isQuestion =
    /\?$/.test(trimmed) ||
    /^(who|what|when|where|why|how|did|do|does|is|are|can|could|should|would)\b/.test(normalized);
  const isDirectiveQuestion = /(can you|could you|would you|please|let's|we should|we need)/.test(normalized);
  if (isQuestion && !isDirectiveQuestion) {
    return false;
  }
  return hasModification || (taskKeywords.test(normalized) && !isQuestion);
};

// --- TASK ID AND PATCHING LOGIC ---

/**
 * Recursively assigns stable UUIDs to tasks and their subtasks if they don't already have one.
 * This is crucial for tracking tasks across AI operations.
 */
async function assignStableIds(tasks: any[]): Promise<TaskType[]> {
  // Ensure tasks is an array and filter out any null/undefined entries
  if (!Array.isArray(tasks)) {
    console.error("assignStableIds received non-array input:", tasks);
    return [];
  }
  const validTasks = tasks.filter(task => task); // Filter out null/undefined
  
  return Promise.all(validTasks.map(async (task) => ({
    ...task,
    id: task.id || uuidv4(),
    subtasks: task.subtasks ? await assignStableIds(task.subtasks) : undefined,
  })));
}


/**
 * Applies AI-generated changes to an existing task list.
 * This prevents wholesale replacement and preserves user data and stable IDs.
 * @param existingTasks The current list of tasks.
 * @param newOrUpdatedTasks The tasks returned by an AI flow.
 * @returns A new, merged list of tasks.
 */
function applyTaskPatch(existingTasks: TaskType[], newOrUpdatedTasks: TaskType[]): TaskType[] {
    if (!existingTasks || existingTasks.length === 0) {
        return newOrUpdatedTasks; // If there's nothing to patch, return the new tasks.
    }
    // If the AI returns a list, we assume it's the new state of the world.
    // A more complex diff/patch could be done here, but for now, replacement
    // is the primary mode when the AI is asked to modify the list.
    // The key is that the orchestrator will PRESERVE tasks the AI wasn't asked about.
    return newOrUpdatedTasks;
}

// Helper to find a task by title for the refinement context
async function findTaskByTitle(tasks: TaskType[], title: string): Promise<TaskType | undefined> {
    for (const task of tasks) {
        if (task.title === title) return task;
        if (task.subtasks) {
            const found = await findTaskByTitle(task.subtasks, title);
            if (found) return found;
        }
    }
    return undefined;
}

// Helper to ensure tasks from AI have IDs and are sanitized
async function sanitizeAndAssignIds(task: any): Promise<TaskType> {
    const subtasks = task.subtasks ? await Promise.all(task.subtasks.map(sanitizeAndAssignIds)) : undefined;
    return {
      ...task,
      id: task.id || uuidv4(),
      subtasks: subtasks,
    };
}

// --- ORCHESTRATOR/DISPATCHER LOGIC ---

/**
 * This is the main exported function that replaces the old monolithic `extractTasksFromChat`.
 * It acts as a dispatcher, inspecting the input context and routing the request to the
 * most appropriate specialized AI flow.
 */
export async function extractTasksFromChat(input: OrchestratorInput): Promise<OrchestratorOutput> {
  const { 
      message, 
      sourceMeetingTranscript, 
      existingTasks = [], 
      selectedTasks,
      contextTaskTitle
  } = input;

  // --- ROUTING LOGIC ---
  
  // 1. INITIAL MEETING ANALYSIS: A transcript is provided and it's the main subject of the message.
  if (sourceMeetingTranscript && (message === sourceMeetingTranscript || input.isFirstMessage)) {
      const analysisResult: AnalyzeMeetingOutput = await analyzeMeeting({
          transcript: sourceMeetingTranscript,
          requestedDetailLevel: "light",
      });

      const primaryTasks = analysisResult.allTaskLevels.light || [];

      // Combine attendees and mentioned people, adding a role
      const attendees = (analysisResult.attendees || []).map((p: MeetingPerson) => ({ ...p, role: 'attendee' as const }));
      const mentioned = (analysisResult.mentionedPeople || []).map((p: MeetingPerson) => ({ ...p, role: 'mentioned' as const }));
      const combinedPeople = [...attendees, ...mentioned];
      
      const uniquePeople = Array.from(new Map(combinedPeople.map(p => [p.name.toLowerCase(), p])).values());


      return {
          tasks: await assignStableIds(primaryTasks),
          allTaskLevels: {
              light: await assignStableIds(analysisResult.allTaskLevels.light),
              medium: await assignStableIds(analysisResult.allTaskLevels.medium),
              detailed: await assignStableIds(analysisResult.allTaskLevels.detailed),
          },
          people: uniquePeople,
          meetingSummary: analysisResult.meetingSummary,
          keyMoments: analysisResult.keyMoments,
          overallSentiment: analysisResult.overallSentiment,
          speakerActivity: analysisResult.speakerActivity,
          sessionTitle: analysisResult.sessionTitle,
          chatResponseText: analysisResult.chatResponseText,
      };
  }

  // 2. REFINEMENT SCENARIO (Priority 1 for follow-up chats): User has tasks selected OR is breaking down a task.
  // This now takes priority over general Q&A for meeting-related chats.
  if ((selectedTasks && selectedTasks.length > 0) || contextTaskTitle) {
      const contextTask = contextTaskTitle ? await findTaskByTitle(existingTasks, contextTaskTitle) : undefined;
      const refineResult: RefineTasksOutput = await refineTasks({
          tasksToRefine: selectedTasks || [],
          contextTask: contextTask,
          instruction: message,
          fullTaskList: existingTasks,
      });

      // Apply the patch. `refineResult.updatedTasks` contains the *entire* new task list.
      const finalTasks = applyTaskPatch(existingTasks, await Promise.all(refineResult.updatedTasks.map((t: TaskType) => sanitizeAndAssignIds(t))));

      return {
          tasks: finalTasks,
          chatResponseText: refineResult.chatResponseText || "I've updated the tasks as you requested.",
      };
  }
  
  // 3. CHAT ABOUT A MEETING (Q&A): If a transcript is present, but NO tasks are selected, it's a follow-up Q&A.
  if (sourceMeetingTranscript) {
      if (existingTasks.length > 0 && isLikelyTaskModification(message)) {
          const modifyResult: ExtractTasksFromMessageOutput = await extractTasksFromMessage({
              message,
              existingTasks,
              requestedDetailLevel: input.requestedDetailLevel,
          });
          const updatedTasks = applyTaskPatch(
              existingTasks,
              await Promise.all(modifyResult.tasks.map((t: TaskType) => sanitizeAndAssignIds(t)))
          );
          return {
              tasks: updatedTasks,
              chatResponseText: modifyResult.chatResponseText,
          };
      }
      const qaResult: TranscriptQAOutput = await answerFromTranscript({
          transcript: sourceMeetingTranscript,
          question: message,
          tasks: existingTasks, // Provide tasks for context
      });
      return {
          tasks: existingTasks, // CRITICAL: Return tasks unchanged
          chatResponseText: qaResult.answerText, // The primary output is the answer
          qaAnswer: qaResult,
      };
  }
  
  // 4. GENERAL TASK EXTRACTION SCENARIO: Default case for creating/modifying tasks from a message without a meeting context.
  const generalResult: ExtractTasksFromMessageOutput = await extractTasksFromMessage({
      message: message,
      isFirstMessage: input.isFirstMessage,
      requestedDetailLevel: input.requestedDetailLevel,
      existingTasks: existingTasks, // Pass existing tasks for modification context
  });

  // Decide whether to append or replace. If existing tasks were provided, the AI was asked to modify.
  const finalGeneralTasks = (existingTasks.length > 0)
    ? applyTaskPatch(existingTasks, await Promise.all(generalResult.tasks.map((t: TaskType) => sanitizeAndAssignIds(t))))
    : await assignStableIds(generalResult.tasks);
  
  const finalAllLevels = generalResult.allTaskLevels
    ? {
        light: await assignStableIds(generalResult.allTaskLevels.light),
        medium: await assignStableIds(generalResult.allTaskLevels.medium),
        detailed: await assignStableIds(generalResult.allTaskLevels.detailed),
    } : undefined;

  return {
      tasks: finalGeneralTasks,
      allTaskLevels: finalAllLevels,
      chatResponseText: generalResult.chatResponseText,
      sessionTitle: generalResult.sessionTitle,
  };
}


// The Genkit flow definition. It now simply wraps our orchestrator.
const extractTasksFromChatFlow = ai.defineFlow(
  {
    name: 'extractTasksOrchestratorFlow', // Renamed for clarity
    inputSchema: OrchestratorInputSchema,
    outputSchema: OrchestratorOutputSchema,
  },
  async (input: OrchestratorInput) => extractTasksFromChat(input)
);

// Define a type for the recursive task structure
type TaskType = z.infer<typeof TaskSchema>;

export type ExtractTasksFromChatOutput = {
  chatResponseText?: string;
  sessionTitle?: string;
  tasks?: TaskType[];
  people?: AnalyzeMeetingOutput['attendees'];
};

export async function processChatForTasks(output: ExtractTasksFromChatOutput | null | undefined) {
  if (!output) {
    return {
      chatResponseText: "I processed your request, but couldn't generate a specific summary.",
      tasks: [],
      people: [],
    };
  }

  const tasks = (output.tasks || [])
    .map((task) => filterTaskRecursive(task as unknown as ExtractedTaskSchema))
    .filter(Boolean) as TaskType[];

  return {
    chatResponseText: output.chatResponseText || "I processed your request, but couldn't generate a specific summary.",
    sessionTitle: output.sessionTitle,
    tasks,
    people: output.people || [],
  };
}
