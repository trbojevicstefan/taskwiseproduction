
// src/ai/flows/refine-tasks-flow.ts
'use server';
/**
 * @fileOverview This flow is specialized in refining or editing an existing set of tasks.
 * It's triggered when a user wants to break down a single task, or provides an instruction
 * to modify a specific selection of tasks. It returns the *complete, updated* task list.
 */

import { z } from 'zod';
import { ai } from '@/ai/genkit';
import { 
  RefineTasksInputSchema,
  type RefineTasksInput,
  RefineTasksOutputSchema,
  type RefineTasksOutput,
} from './schemas';
import { extractJsonValue } from './parse-json-output';
import { annotateTasksWithProvider, normalizeAiTasks } from '@/lib/ai-utils';
import { runPromptWithFallback } from '@/ai/prompt-fallback';

// --- GENKIT PROMPT ---

// A helper schema to stringify the JSON task list for the prompt
const PromptInputSchema = RefineTasksInputSchema.extend({
    fullTaskListJSON: z.string(),
    contextTaskJSON: z.string().optional(),
    tasksToRefineJSON: z.string().optional(),
});


const refineTasksPrompt = ai.definePrompt({
  name: 'refineTasksPrompt',
  input: { schema: PromptInputSchema },
  output: { format: 'json' },
  prompt: `
You are an expert AI assistant specializing in task refinement. Your goal is to intelligently modify an existing task list based on a user's specific instruction.

**CRITICAL DIRECTIVE:** You MUST return the **complete and final list of all tasks**. This includes all original tasks that were not affected by the user's request. Do not omit any tasks. Preserve the original IDs of all tasks unless you are merging them.

**Full Current Task List (for context):**
\`\`\`json
{{{fullTaskListJSON}}}
\`\`\`

{{#if contextTask}}
**Scenario: Breaking Down a Single Task**
- **Task to Break Down:** \`{{contextTask.title}}\`
- **User's Instruction:** "{{{instruction}}}"
- **Instructions:**
    1.  Generate a list of new sub-tasks for the provided "Task to Break Down".
    2.  Incorporate these new sub-tasks under the correct parent task within the full task list.
    3.  Return the complete, updated task list in the \`updatedTasks\` field.
    4.  Formulate a concise \`chatResponseText\`. Example: "Okay, I've broken down '{{contextTask.title}}' into sub-tasks."

{{else if tasksToRefine}}
**Scenario: Modifying a Specific Selection of Tasks**
- **Selected Tasks to Modify:**
\`\`\`json
{{{tasksToRefineJSON}}}
\`\`\`
- **User's Instruction:** "{{{instruction}}}"
- **Instructions:**
    1.  Analyze the user's instruction. It could be to merge, reword, add subtasks to, or delete the **selected tasks**.
    2.  Apply the changes **only to the selected tasks** within the context of the full task list.
    3.  Return the **complete, final, and updated** list of tasks in the \`updatedTasks\` field, including all original, unselected tasks.
    4.  Formulate a concise \`chatResponseText\` confirming the action. Example: "Done. I've updated the selected tasks as you requested."
{{/if}}

**Output Requirement:** Your final output MUST be a single, valid JSON object that strictly adheres to the provided output schema. Remember to return the entire task list.
  `,
});

// --- GENKIT FLOW ---

const refineTasksFlow = ai.defineFlow(
  {
    name: 'refineTasksFlow',
    inputSchema: RefineTasksInputSchema,
    outputSchema: RefineTasksOutputSchema,
  },
  async (input: RefineTasksInput) => {
    const promptInput: z.infer<typeof PromptInputSchema> = {
        ...input,
        fullTaskListJSON: JSON.stringify(input.fullTaskList, null, 2),
        contextTaskJSON: input.contextTask ? JSON.stringify(input.contextTask, null, 2) : undefined,
        tasksToRefineJSON: input.tasksToRefine ? JSON.stringify(input.tasksToRefine, null, 2) : undefined,
    };
    const { output, text, provider } = await runPromptWithFallback(refineTasksPrompt, promptInput);
    const raw = extractJsonValue(output, text);
    const rawObject =
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : {};

    const getString = (value: unknown): string | undefined =>
      typeof value === 'string' && value.trim() ? value.trim() : undefined;

    let updatedTasks = normalizeAiTasks(rawObject.updatedTasks, 'Refined task');
    if (provider) {
      updatedTasks = annotateTasksWithProvider(updatedTasks, provider);
    }

    const outputData: RefineTasksOutput = {
      chatResponseText:
        getString(rawObject.chatResponseText) ||
        "I've updated the tasks as requested.",
      updatedTasks,
    };

    return RefineTasksOutputSchema.parse(outputData);
  }
);

/**
 * Wrapper function to be called from the orchestrator.
 */
export async function refineTasks(input: RefineTasksInput): Promise<RefineTasksOutput> {
  return await refineTasksFlow(input);
}
