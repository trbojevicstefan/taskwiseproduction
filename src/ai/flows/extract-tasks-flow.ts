
// src/ai/flows/extract-tasks-flow.ts
'use server';
/**
 * @fileOverview This flow is responsible for general-purpose task extraction from a user's message.
 * It is used when no specific meeting transcript is provided. It can create a new task list
 * from scratch or modify an existing list based on the user's instructions.
 */

import { z } from 'zod';
import { ai } from '@/ai/genkit';
import { 
  ExtractTasksFromMessageInputSchema,
  type ExtractTasksFromMessageInput,
  ExtractTasksFromMessageOutputSchema,
  type ExtractTasksFromMessageOutput,
  type TaskType,
} from './schemas';
import { alignTasksToLight, annotateTasksWithProvider, applyTaskMetadata, normalizeAiTasks, normalizeTitleKey } from '@/lib/ai-utils';
import { extractJsonValue } from './parse-json-output';
import { rewriteTaskTitles } from './rewrite-task-titles';
import { runPromptWithFallback } from '@/ai/prompt-fallback';

// --- GENKIT PROMPT ---

// A helper schema to stringify the JSON task list for the prompt
const PromptInputSchema = ExtractTasksFromMessageInputSchema.extend({
    existingTasksJSON: z.string().optional(),
    existingTasksScoped: z.boolean().optional(),
    existingTaskCount: z.number().optional(),
});

const extractTasksPrompt = ai.definePrompt({
  name: 'extractTasksFromMessagePrompt',
  input: { schema: PromptInputSchema },
  output: { format: 'json' },
  prompt: `
You are an expert AI assistant focused on creating and managing tasks.

**Core Directives:**
- Your primary goal is to analyze the user's message and respond with a structured list of tasks.
- If the user's message is a simple greeting or question, still create at least one relevant task based on the implied intent.
- CRITICAL: Do not create tasks with empty or meaningless placeholder titles like "1.", "a)", "Subtask", "Action item", or "Task 1". Every title must be descriptive and action-oriented.
- Avoid meta tasks like "learn", "research", "review", "clarify", or "figure out" unless the user explicitly asked for those actions. When the user asks for a how-to or gives an imperative (e.g., "bake a cake"), produce concrete, step-by-step tasks that directly accomplish the goal.
- Do not simply restate the user's request as a single task. Use semantic understanding to infer the necessary steps, deliverables, and decisions to accomplish the goal.

{{#if existingTasks}}
**Scenario: Modifying an Existing Task List**
The user wants to add, remove, or change their current tasks.
{{#if existingTasksScoped}}
-   **Scope Note:** The JSON below is a relevance-filtered subset of a larger list ({{existingTaskCount}} tasks total). Only modify tasks in this subset and return the updated subset.
{{/if}}
-   **Current Task List (JSON):** \`\`\`json
{{{existingTasksJSON}}}
\`\`\`
-   **User's Request:** "{{{message}}}"
-   **Instructions:**
    1.  Analyze the user's request. It may refer to specific tasks by title. The request **only applies to the tasks it explicitly mentions**.
    2.  Apply the changes (add, remove, merge, reword, etc.) **only to the mentioned tasks**.
    3.  **CRITICAL**: Return the **complete, final, and updated** list of tasks in the \`tasks\` field for the provided list.
    4.  **CRITICAL**: Preserve all existing task properties and IDs unless the user explicitly asks to change them for a specific task.
    5.  Formulate a concise \`chatResponseText\` confirming the action. Example: "Done. I've updated the task list as you requested."

{{else}}
**Scenario: Creating a New Task List from Scratch**
The user provides a general request, a topic, or raw text.
-   **User's Input:** {{{message}}}
-   **Requested Detail Level:** {{requestedDetailLevel}}
-   **Instructions:**
    1.  **CRITICAL: Generate Three Levels of Detail.** You must generate three complete, hierarchical task lists for the user's input and place them in the \`allTaskLevels\` object:
        *   \`allTaskLevels.light\`: Generate only top-level, high-level macro tasks. If you only generate a few (1-3) tasks, make their descriptions more detailed to provide a useful summary.
        *   \`allTaskLevels.medium\`: Use the SAME top-level tasks as \`light\`, but add one level of important sub-tasks.
        *   \`allTaskLevels.detailed\`: Use the SAME top-level tasks as \`light\`, but break subtasks down one level deeper where relevant.
        *   **CRITICAL:** Do NOT invent unrelated tasks or pad the list to hit a quota. For how-to requests, the implied steps are part of the user's intent, so include standard steps that accomplish the request.
        *   **Granularity Targets (guidelines only):** Light should have 3-7 tasks. Medium should have 5-12 tasks. Detailed should have 12-30 tasks across multiple levels.
        *   **Concrete Steps:** If the user asks for instructions (how-to) or a direct action, the tasks must be specific, actionable steps that accomplish the goal (ingredients, prep, execution, finishing). Do NOT answer with a single high-level task like "learn how to bake a cake."
    2.  **Set Primary Task List:** Based on the user's \`requestedDetailLevel\` ('light', 'medium', 'detailed'), copy the corresponding task list from \`allTaskLevels\` into the main \`tasks\` output field.
    3.  **Chat Response:** Formulate a concise \`chatResponseText\`.
    4.  {{#if isFirstMessage}}**Session Title:** Generate a short, descriptive \`sessionTitle\` for this new session.{{/if}}
{{/if}}

	**Output Requirement:** Your final output MUST be a single, valid JSON object that strictly adheres to the provided output schema.
	  `,
});

const EXISTING_TASK_CONTEXT_CAP = Math.max(
  6,
  Math.min(20, Number(process.env.EXISTING_TASK_CONTEXT_CAP || 12))
);
const CONTEXT_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "for",
  "from",
  "in",
  "into",
  "it",
  "its",
  "my",
  "of",
  "on",
  "or",
  "task",
  "tasks",
  "the",
  "to",
  "update",
  "with",
]);

const flattenTaskList = (tasks: TaskType[]): TaskType[] => {
  const flat: TaskType[] = [];
  const walk = (items: TaskType[]) => {
    items.forEach((task: any) => {
      flat.push(task);
      if (task.subtasks?.length) {
        walk(task.subtasks);
      }
    });
  };
  walk(tasks);
  return flat;
};

const tokenizeMessage = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((token: any) => token.trim())
    .filter((token: any) => token.length > 2 && !CONTEXT_STOPWORDS.has(token));

const taskLookupKey = (task: TaskType) => {
  if (task.id) return `id:${task.id}`;
  const title = normalizeTitleKey(task.title);
  return title ? `title:${title}` : "";
};

const scoreTaskRelevance = (task: TaskType, queryTokens: string[]) => {
  if (!queryTokens.length) return 0;
  const haystack = normalizeTitleKey(`${task.title} ${task.description || ""}`);
  if (!haystack) return 0;
  let matched = 0;
  queryTokens.forEach((token: any) => {
    if (haystack.includes(token)) matched += 1;
  });
  return matched / queryTokens.length;
};

const selectPromptTaskContext = (tasks: TaskType[], message: string) => {
  if (!tasks.length) {
    return {
      scopedTasks: [] as TaskType[],
      scopedKeys: new Set<string>(),
      wasTrimmed: false,
    };
  }
  const flat = flattenTaskList(tasks);
  if (flat.length <= EXISTING_TASK_CONTEXT_CAP) {
    return {
      scopedTasks: tasks,
      scopedKeys: new Set(tasks.map(taskLookupKey).filter(Boolean)),
      wasTrimmed: false,
    };
  }
  const queryTokens = tokenizeMessage(message);
  const scored = flat
    .map((task, index) => ({
      task,
      index,
      score: scoreTaskRelevance(task, queryTokens),
    }))
    .sort((a: any, b: any) => b.score - a.score || a.index - b.index);

  const selected = scored
    .slice(0, EXISTING_TASK_CONTEXT_CAP)
    .map((entry: any) => entry.task);
  const deduped = Array.from(
    new Map(selected.map((task: any) => [taskLookupKey(task), task])).values()
  ).filter((task: any) => taskLookupKey(task));
  return {
    scopedTasks: deduped,
    scopedKeys: new Set(deduped.map(taskLookupKey).filter(Boolean)),
    wasTrimmed: deduped.length < tasks.length,
  };
};

const mergeScopedTaskUpdates = (
  fullTasks: TaskType[],
  scopedUpdates: TaskType[],
  scopedKeys: Set<string>,
  message: string
): TaskType[] => {
  if (!fullTasks.length) return scopedUpdates;
  if (!scopedUpdates.length) return fullTasks;
  const isDeleteIntent = /\b(delete|remove|archive)\b/i.test(message);
  const updateByKey = new Map(
    scopedUpdates
      .map((task: any) => [taskLookupKey(task), task] as const)
      .filter(([key]) => Boolean(key))
  );
  const consumed = new Set<string>();
  const walk = (items: TaskType[]): TaskType[] =>
    items.reduce<TaskType[]>((acc, task) => {
      const key = taskLookupKey(task);
      const nextSubtasks = task.subtasks?.length ? walk(task.subtasks) : task.subtasks;
      const hasScopedKey = Boolean(key && scopedKeys.has(key));
      if (hasScopedKey && key) {
        const updated = updateByKey.get(key);
        if (!updated) {
          if (!isDeleteIntent) {
            acc.push(nextSubtasks !== task.subtasks ? { ...task, subtasks: nextSubtasks } : task);
          }
          return acc;
        }
        consumed.add(key);
        acc.push({
          ...task,
          ...updated,
          id: task.id || updated.id,
          subtasks: updated.subtasks ?? nextSubtasks,
        });
        return acc;
      }
      if (nextSubtasks !== task.subtasks) {
        acc.push({ ...task, subtasks: nextSubtasks });
      } else {
        acc.push(task);
      }
      return acc;
    }, []);

  const merged = walk(fullTasks);
  const append = scopedUpdates.filter((task: any) => {
    const key = taskLookupKey(task);
    return key ? !consumed.has(key) : true;
  });
  return append.length ? [...merged, ...append] : merged;
};

// --- GENKIT FLOW ---

const extractTasksFromMessageFlow = ai.defineFlow(
  {
    name: 'extractTasksFromMessageFlow',
    inputSchema: ExtractTasksFromMessageInputSchema,
    outputSchema: ExtractTasksFromMessageOutputSchema,
  },
  async (input: ExtractTasksFromMessageInput) => {
    const normalizedMessage = input.message.trim();
    const wordCount = normalizedMessage ? normalizedMessage.split(/\s+/).length : 0;
    const multiStepTriggers = [
      "make",
      "build",
      "create",
      "develop",
      "design",
      "launch",
      "bake",
      "cook",
      "prepare",
      "plan",
      "organize",
      "set up",
      "setup",
      "write",
      "draft",
    ];
    const shouldForceBreakdown =
      (!input.existingTasks || input.existingTasks.length === 0) &&
      wordCount > 0 &&
      wordCount <= 10 &&
      multiStepTriggers.some((trigger: any) => normalizedMessage.toLowerCase().includes(trigger));
    const effectiveMessage = shouldForceBreakdown
      ? `Break this down into concrete, step-by-step tasks that complete the goal: ${input.message}`
      : input.message;
    const existingTasks = input.existingTasks || [];
    const scopedContext = selectPromptTaskContext(existingTasks, effectiveMessage);
    const tasksForPrompt = existingTasks.length ? scopedContext.scopedTasks : undefined;

    const promptInput = {
        ...input,
        message: effectiveMessage,
        existingTasks: tasksForPrompt,
        existingTasksJSON: tasksForPrompt ? JSON.stringify(tasksForPrompt, null, 2) : undefined,
        existingTasksScoped: scopedContext.wasTrimmed || undefined,
        existingTaskCount: existingTasks.length || undefined,
    };
    const { output, text, provider } = await runPromptWithFallback(
      extractTasksPrompt,
      promptInput,
      undefined,
      {
        endpoint: "extractTasksFromMessage",
      }
    );
    const raw = extractJsonValue(output, text);
    const rawObject =
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : {};

    const getString = (value: unknown): string | undefined =>
      typeof value === 'string' && value.trim() ? value.trim() : undefined;
    const getObject = (value: unknown): Record<string, unknown> | null =>
      value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;

    const allTaskLevelsObject = getObject(rawObject.allTaskLevels);
    let allTaskLevels = allTaskLevelsObject
      ? {
          light: normalizeAiTasks(allTaskLevelsObject.light, 'Next step'),
          medium: normalizeAiTasks(allTaskLevelsObject.medium, 'Next step'),
          detailed: normalizeAiTasks(allTaskLevelsObject.detailed, 'Next step'),
        }
      : undefined;

    const shouldRewrite = !input.existingTasks || input.existingTasks.length === 0;
    const rewriteTasksSafely = async (tasksToRewrite: TaskType[]) => {
      try {
        return await rewriteTaskTitles(tasksToRewrite, input.message);
      } catch (error) {
        console.error("Failed to rewrite task titles:", error);
        return tasksToRewrite;
      }
    };

    if (allTaskLevels && shouldRewrite) {
      const rewrittenLight = await rewriteTasksSafely(allTaskLevels.light);
      const rewrittenMedium = await rewriteTasksSafely(allTaskLevels.medium);
      const rewrittenDetailed = await rewriteTasksSafely(allTaskLevels.detailed);

      allTaskLevels = {
        light: applyTaskMetadata(rewrittenLight),
        medium: applyTaskMetadata(alignTasksToLight(rewrittenLight, rewrittenMedium)),
        detailed: applyTaskMetadata(alignTasksToLight(rewrittenLight, rewrittenDetailed)),
      };
    }

    let tasks = normalizeAiTasks(rawObject.tasks, 'Next step');
    if (tasks.length && shouldRewrite) {
      tasks = applyTaskMetadata(await rewriteTasksSafely(tasks));
    }
    if (!tasks.length && allTaskLevels) {
      const fallback =
        allTaskLevels[input.requestedDetailLevel] ||
        allTaskLevels.medium ||
        allTaskLevels.light ||
        allTaskLevels.detailed ||
        [];
      tasks = fallback;
    }
    if (shouldForceBreakdown && allTaskLevels?.detailed?.length) {
      if (allTaskLevels.detailed.length > tasks.length) {
        tasks = allTaskLevels.detailed;
      }
    }
    if (!tasks.length) {
      const messageFallback = normalizeAiTasks([input.message], 'Next step');
      tasks =
        messageFallback.length > 0
          ? messageFallback
          : normalizeAiTasks([{ title: 'Define next steps' }], 'Next step');
    }
    if (scopedContext.wasTrimmed && existingTasks.length) {
      tasks = mergeScopedTaskUpdates(
        existingTasks,
        tasks,
        scopedContext.scopedKeys,
        effectiveMessage
      );
    }

    const tagProvider = (items: TaskType[]) =>
      annotateTasksWithProvider(items, provider);
    tasks = tagProvider(tasks);
    if (allTaskLevels) {
      allTaskLevels = {
        light: tagProvider(allTaskLevels.light),
        medium: tagProvider(allTaskLevels.medium),
        detailed: tagProvider(allTaskLevels.detailed),
      };
    }

    const outputData: ExtractTasksFromMessageOutput = {
      chatResponseText:
        getString(rawObject.chatResponseText) ||
        "I've created a task list from your input.",
      sessionTitle: getString(rawObject.sessionTitle),
      tasks,
      allTaskLevels:
        allTaskLevels &&
        (allTaskLevels.light.length ||
          allTaskLevels.medium.length ||
          allTaskLevels.detailed.length)
          ? allTaskLevels
          : undefined,
    };

    return ExtractTasksFromMessageOutputSchema.parse(outputData);
  }
);

/**
 * Wrapper function to be called from the orchestrator.
 */
export async function extractTasksFromMessage(input: ExtractTasksFromMessageInput): Promise<ExtractTasksFromMessageOutput> {
  return await extractTasksFromMessageFlow(input);
}


