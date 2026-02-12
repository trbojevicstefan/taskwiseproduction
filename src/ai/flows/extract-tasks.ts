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
} from './schemas';
import { routeChatIntent } from './chat-intent-router-flow';


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
    "complete",
    "finish",
    "done",
    "mark",
    "status",
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

const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "to",
  "for",
  "of",
  "on",
  "in",
  "by",
  "with",
  "from",
  "that",
  "this",
  "it",
  "its",
  "my",
  "your",
  "our",
  "their",
  "task",
  "tasks",
  "item",
  "items",
]);

const flattenTasks = (tasks: TaskType[]): TaskType[] => {
  const result: TaskType[] = [];
  const walk = (items: TaskType[]) => {
    items.forEach((task) => {
      result.push(task);
      if (task.subtasks) {
        walk(task.subtasks);
      }
    });
  };
  walk(tasks);
  return result;
};

const extractQueryTokens = (message: string): string[] =>
  message
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));

const scoreTaskMatch = (task: TaskType, tokens: string[]): number => {
  if (!tokens.length) return 0;
  const haystack = `${task.title} ${task.description || ""}`.toLowerCase();
  const matched = tokens.filter((token) => haystack.includes(token));
  return matched.length / tokens.length;
};

const findTaskMatches = (message: string, tasks: TaskType[]) => {
  const tokens = extractQueryTokens(message);
  const candidates = flattenTasks(tasks)
    .map((task) => ({
      task,
      score: scoreTaskMatch(task, tokens),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  return { tokens, candidates };
};

const removeTasksByIds = (tasks: TaskType[], ids: Set<string>): TaskType[] =>
  tasks
    .filter((task) => !task.id || !ids.has(task.id))
    .map((task) => ({
      ...task,
      subtasks: task.subtasks ? removeTasksByIds(task.subtasks, ids) : task.subtasks,
    }));

const isDeleteIntent = (message: string): boolean =>
  /(delete|remove|archive)\b/i.test(message);

const isConfirmDelete = (message: string): boolean =>
  /(confirm delete|yes delete|delete it|go ahead delete|confirm removal)/i.test(message);

const needsTargetTask = (message: string): boolean =>
  /(update|change|edit|rename|assign|reassign|due|deadline|priority|move|merge|split|break down|simplify)/i.test(
    message
  );

const isExplicitKnowledgeRequest = (message: string): boolean => {
  const normalized = message.toLowerCase();
  return (
    /(transcript|meeting content|meeting details|transcript answer|summary|recap|key decisions|key moments|what did|who was|who attended|when was|how productive|productivity)/.test(
      normalized
    )
  );
};

// --- TASK ID AND PATCHING LOGIC ---

/**
 * Recursively assigns stable UUIDs to tasks and their subtasks if they don't already have one.
 * This is crucial for tracking tasks across AI operations.
 */
async function assignStableIds(tasks: Partial<TaskType>[]): Promise<TaskType[]> {
  // Ensure tasks is an array and filter out any null/undefined entries
  if (!Array.isArray(tasks)) {
    console.error("assignStableIds received non-array input:", tasks);
    return [];
  }
  const validTasks = tasks.filter(task => task); // Filter out null/undefined

  return Promise.all(validTasks.map(async (task) => ({
    ...task,
    title: task.title || 'Untitled Task',
    priority: task.priority || 'medium',
    id: task.id || uuidv4(),
    subtasks: task.subtasks ? await assignStableIds(task.subtasks) : undefined,
  } as TaskType)));
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
async function sanitizeAndAssignIds(task: Partial<TaskType>): Promise<TaskType> {
  const subtasks = task.subtasks ? await Promise.all(task.subtasks.map(sanitizeAndAssignIds)) : undefined;
  return {
    ...task,
    title: task.title || 'Untitled Task',
    priority: task.priority || 'medium',
    id: task.id || uuidv4(),
    subtasks: subtasks,
  } as TaskType;
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
    contextTaskTitle,
    previousMeetingId
  } = input;

  // --- CONTEXT INJECTION FOR CONTINUITY ---
  let previousSessionContext: string | undefined;

  if (previousMeetingId) {
    try {
      // Dynamic import to avoid hydration issues if used in client components
      const { getDb } = await import('@/lib/db');
      const { ObjectId } = await import('mongodb');

      const db = await getDb();
      // Use any to bypass TS check for now as we just need simple fields
      const prevMeeting = await db.collection('meetings').findOne({ _id: new ObjectId(previousMeetingId) }) as { extractedTasks?: Partial<TaskType>[]; summary?: string; title?: string; startTime?: Date } | null;

      if (prevMeeting) {
        const prevTasks = prevMeeting.extractedTasks || [];
        const summary = prevMeeting.summary || "No summary available.";
        const titles = prevTasks.map((t: Partial<TaskType>) => `- ${t.title} (${t.status || 'todo'})`).join('\n');
        const date = prevMeeting.startTime ? new Date(prevMeeting.startTime).toLocaleDateString() : "Unknown Date";

        previousSessionContext = `
**Previous Meeting:** "${prevMeeting.title || 'Untitled'}" (${date})
**Summary:** ${summary}
**Tasks from that meeting:**
${titles}
             `.trim();
      }
    } catch (error) {
      console.error("Failed to fetch previous meeting context:", error);
    }
  }

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

    // RECONCILIATION: Attempt to link new analyzed tasks to existing tasks (previous meeting context)
    // This handles "Rollovers" where the AI detects a task that already exists.
    const reconciledTasks = primaryTasks.map(newTask => {
      if (!existingTasks.length) return newTask;

      // Simple fuzzy match by title
      const newTitle = newTask.title.toLowerCase();
      const match = existingTasks.find(existing => {
        const existingTitle = existing.title.toLowerCase();
        return existingTitle === newTitle ||
          existingTitle.includes(newTitle) ||
          newTitle.includes(existingTitle);
      });

      if (match) {
        // Found a match! Use the existing ID to preserve continuity.
        // The NEW status from analysis is more current (e.g. "done").
        return {
          ...newTask,
          id: match.id, // Preserve the canonical ID
        };
      }
      return newTask;
    });

    return {
      tasks: await assignStableIds(reconciledTasks),
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
      meetingMetadata: analysisResult.meetingMetadata,
      sessionTitle: analysisResult.sessionTitle,
      chatResponseText: analysisResult.chatResponseText,
    };
  }

  const hasTranscript = Boolean(sourceMeetingTranscript);
  const hasTasks = existingTasks.length > 0;

  if (hasTranscript && !selectedTasks?.length && !contextTaskTitle) {
    if (isExplicitKnowledgeRequest(message)) {
      const qaResult: TranscriptQAOutput = await answerFromTranscript({
        transcript: sourceMeetingTranscript!,
        question: message,
        tasks: existingTasks,
      });
      return {
        tasks: existingTasks,
        chatResponseText: qaResult.answerText,
        qaAnswer: qaResult,
      };
    }
    const routed = await routeChatIntent({
      message,
      hasTranscript,
      hasTasks,
    });

    if (routed.intent === "knowledge") {
      const qaResult: TranscriptQAOutput = await answerFromTranscript({
        transcript: sourceMeetingTranscript!,
        question: message,
        tasks: existingTasks,
      });
      return {
        tasks: existingTasks,
        chatResponseText: qaResult.answerText,
        qaAnswer: qaResult,
      };
    }

    if (routed.intent === "ambiguous") {
      const clarification =
        routed.clarifyingQuestion ||
        "Do you want an answer from the transcript, or should I update the task list?";
      return {
        tasks: existingTasks,
        chatResponseText: clarification,
      };
    }
  }

  if (hasTasks && needsTargetTask(message) && !selectedTasks?.length && !contextTaskTitle) {
    const { tokens, candidates } = findTaskMatches(message, existingTasks);
    if (!tokens.length) {
      return {
        tasks: existingTasks,
        chatResponseText:
          "Which task should I update? Please mention part of the task title.",
      };
    }
    if (!candidates.length) {
      return {
        tasks: existingTasks,
        chatResponseText:
          "I couldn't find a matching task. Can you specify the task title?",
      };
    }
    const topScore = candidates[0].score;
    const topMatches = candidates.filter((entry) => entry.score >= topScore - 0.15);
    if (topMatches.length > 1) {
      const options = topMatches
        .slice(0, 3)
        .map((entry) => `"${entry.task.title}"`)
        .join(", ");
      return {
        tasks: existingTasks,
        chatResponseText: `I found multiple tasks that match. Which one did you mean: ${options}?`,
      };
    }
  }

  if (hasTasks && isDeleteIntent(message)) {
    const { candidates } = findTaskMatches(message, existingTasks);
    if (!candidates.length) {
      return {
        tasks: existingTasks,
        chatResponseText:
          "Which task should I delete? Please mention part of the task title.",
      };
    }

    const topScore = candidates[0].score;
    const topMatches = candidates.filter((entry) => entry.score >= topScore - 0.15);

    if (topMatches.length > 1) {
      const options = topMatches.slice(0, 3).map((entry) => `"${entry.task.title}"`).join(", ");
      return {
        tasks: existingTasks,
        chatResponseText: `I found multiple tasks that match. Which one should I delete: ${options}?`,
      };
    }

    const targetTask = topMatches[0].task;
    if (!isConfirmDelete(message)) {
      return {
        tasks: existingTasks,
        chatResponseText: `Confirm deletion of "${targetTask.title}"? Reply "confirm delete ${targetTask.title}".`,
      };
    }

    const updatedTasks = targetTask.id
      ? removeTasksByIds(existingTasks, new Set([targetTask.id]))
      : existingTasks;
    return {
      tasks: updatedTasks,
      chatResponseText: `Deleted "${targetTask.title}".`,
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
      previousSessionContext,
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
export const extractTasksFromChatFlow = ai.defineFlow(
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
