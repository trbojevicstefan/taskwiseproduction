
'use server';
/**
 * @fileOverview AI flow for merging multiple tasks into a single, coherent task.
 *
 * - mergeTasks - A function that takes multiple tasks and returns a single merged task.
 * - MergeTasksInput - The input type for the mergeTasks function.
 * - MergeTasksOutput - The return type for the mergeTasks function.
 */

import { ai } from '@/ai/genkit';
import { z } from 'zod';
import { runPromptWithFallback } from '@/ai/prompt-fallback';

// Schema for individual tasks within the input array
const TaskToMergeSchema = z.object({
  id: z.string().optional().describe("The original ID of the task, for reference."),
  title: z.string().optional().describe('The title of the task.'),
  description: z.string().optional().describe('The description of the task.'),
});

const MergeTasksInputSchema = z.object({
  tasksToMerge: z.array(TaskToMergeSchema).min(2).describe('An array of two or more tasks to be merged.'),
  contextPrompt: z.string().optional().describe("Optional broader context or project goal to guide the merge, if available.")
});
export type MergeTasksInput = z.infer<typeof MergeTasksInputSchema>;

const MergeTasksOutputSchema = z.object({
  mergedTitle: z.string().describe('The new, concise title for the merged task.'),
  mergedDescription: z.string().describe('A comprehensive description combining key details from all merged tasks.'),
});
export type MergeTasksOutput = z.infer<typeof MergeTasksOutputSchema>;

export async function mergeTasks(input: MergeTasksInput): Promise<MergeTasksOutput> {
  return mergeTasksFlow(input);
}

const mergeTasksPrompt = ai.definePrompt({
  name: 'mergeTasksPrompt',
  input: {schema: MergeTasksInputSchema},
  output: {schema: MergeTasksOutputSchema},
  prompt: `You are an expert task synthesizer and project manager.
Your goal is to merge a list of provided tasks into a single, well-defined, and actionable new task.

{{#if contextPrompt}}
Overall Context/Goal: {{{contextPrompt}}}
{{/if}}

Tasks to Merge:
{{#each tasksToMerge}}
- Task ID (for reference): {{{this.id}}}
  Task Title: {{{this.title}}}
  Description: {{{this.description}}}
{{/each}}

Based on the tasks above, please:
1.  Create a new, concise, and descriptive \`mergedTitle\` that accurately represents the combined scope of these tasks.
2.  Write a comprehensive \`mergedDescription\` that synthesizes the essential information and details from all the provided tasks. Ensure the description is clear and actionable.
Do not list the original tasks in your output, only provide the merged title and description.
Your output MUST be a valid JSON object adhering to the MergeTasksOutputSchema.
`,
});

const mergeTasksFlow = ai.defineFlow(
  {
    name: 'mergeTasksFlow',
    inputSchema: MergeTasksInputSchema,
    outputSchema: MergeTasksOutputSchema,
  },
  async (input: MergeTasksInput) => {
    // Input validation (min 2 tasks) is handled by Zod schema in MergeTasksInputSchema
    // and further by the component before calling.
    const {output} = await runPromptWithFallback(mergeTasksPrompt, input);
    if (!output) {
        throw new Error("AI failed to generate a merged task. Output was null.");
    }
    return output;
  }
);
