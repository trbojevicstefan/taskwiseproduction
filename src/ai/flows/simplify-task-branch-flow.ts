
'use server';
/**
 * @fileOverview AI flow for simplifying a task and its existing sub-tasks.
 *
 * - simplifyTaskBranch - A function that takes a task (potentially with sub-tasks) and returns a simplified version.
 * - SimplifyTaskBranchInput - The input type for the simplifyTaskBranch function.
 * - SimplifyTaskBranchOutput - The return type for the simplifyTaskBranch function.
 */

import { ai } from '@/ai/genkit';
import { z } from 'zod';
import { extractJsonValue } from './parse-json-output';
import { normalizeAiTasks } from '@/lib/ai-utils';
import { runPromptWithFallback } from '@/ai/prompt-fallback';

// Define TaskSchema with potential for subtasks (recursive) for input and output
const BaseTaskSchemaInternal = z.object({
    title: z.string().describe('The meaningful and descriptive title of the task. Ensure title is not empty.'),
    description: z.string().optional().describe('A more detailed description of the task.'),
    priority: z.enum(['high', 'medium', 'low']).default('medium').describe('The priority of the task.'),
    dueAt: z.string().optional().describe('The due date and time for the task in ISO 8601 format (YYYY-MM-DDTHH:mm:ss.sssZ), if mentioned.'),
});

type TaskTypeInternal = z.input<typeof BaseTaskSchemaInternal> & {
    subtasks?: TaskTypeInternal[];
    // We don't need id, addedToProjectId, etc. for the AI processing part for simplification
};

const TaskSchemaInternal: z.ZodType<TaskTypeInternal> = BaseTaskSchemaInternal.extend({
    subtasks: z.array(z.lazy(() => TaskSchemaInternal)).optional().describe('A list of sub-tasks. The AI can choose to omit or reduce these.'),
});


const SimplifyTaskBranchInputSchema = z.object({
    taskToSimplify: TaskSchemaInternal.describe('The task (including its current sub-tasks if any) to be simplified.'),
    requestedComplexity: z.enum(['very_low', 'low', 'medium_concise']).default('low').describe("The desired complexity of the simplified task structure. 'very_low' means minimal sub-tasks, 'low' means fewer and more concise, 'medium_concise' implies retaining structure but making descriptions shorter."),
    contextPrompt: z.string().optional().describe("Optional broader context or project goal to guide the simplification process.")
});
export type SimplifyTaskBranchInput = z.infer<typeof SimplifyTaskBranchInputSchema>;

const SimplifyTaskBranchOutputSchema = z.object({
    simplifiedTask: TaskSchemaInternal.describe('The single simplified root task, potentially with its own simplified sub-tasks. The title of this root task should be a refined version of the original input task title.'),
    aiSummaryMessage: z.string().optional().describe('A brief message from the AI about how it simplified the task.'),
});
export type SimplifyTaskBranchOutput = z.infer<typeof SimplifyTaskBranchOutputSchema>;

export async function simplifyTaskBranch(input: SimplifyTaskBranchInput): Promise<SimplifyTaskBranchOutput> {
    return simplifyTaskBranchFlow(input);
}

const simplifyTaskPrompt = ai.definePrompt({
    name: 'simplifyTaskBranchPrompt',
    input: {schema: SimplifyTaskBranchInputSchema},
    output: { format: 'json' },
    prompt: `You are an expert project manager AI specializing in task simplification and refinement.
Your goal is to take an existing task, along with its current sub-tasks (if any), and produce a simplified version of that task and its hierarchy.

Overall Context/Goal (if provided): {{{contextPrompt}}}

Task to Simplify:
Title: {{{taskToSimplify.title}}}
Description: {{{taskToSimplify.description}}}
Priority: {{{taskToSimplify.priority}}}
{{#if taskToSimplify.dueAt}}Due Date: {{{taskToSimplify.dueAt}}}{{/if}}
Current Sub-tasks:
{{#if taskToSimplify.subtasks}}
{{#each taskToSimplify.subtasks}}
- Sub-task Title: {{{this.title}}} (Description: {{{this.description}}}, Priority: {{{this.priority}}})
  {{#if this.subtasks}}
  Further Sub-tasks of "{{this.title}}":
    {{#each this.subtasks}}
    -- Title: {{{this.title}}} (Description: {{{this.description}}}, Priority: {{{this.priority}}})
    {{/each}}
  {{/if}}
{{/each}}
{{else}}
(No existing sub-tasks provided for this task)
{{/if}}

Desired Complexity for Simplified Output: {{{requestedComplexity}}}
- 'very_low': Aim for the main task only, or at most 1-2 very high-level sub-tasks. Descriptions should be extremely brief.
- 'low': Reduce the number of sub-tasks significantly. Merge related sub-tasks. Make titles and descriptions concise.
- 'medium_concise': Retain more of the original sub-task structure if logical, but ensure all titles and descriptions are significantly more concise and to the point. Remove redundant sub-tasks.

Instructions:
1.  Analyze the provided task and its sub-tasks.
2.  Based on the 'requestedComplexity', simplify the task structure. This may involve:
    *   Rewording the main task's title and description to be more concise or impactful.
    *   Reducing the number of sub-tasks.
    *   Merging multiple sub-tasks into a single, more comprehensive sub-task.
    *   Removing sub-tasks that are too granular or not essential for the chosen complexity level.
    *   Rewording sub-task titles and descriptions to be very concise.
3.  The primary output should be a single 'simplifiedTask' object. This object represents the original task in its new, simplified form. It can, and often should, have its own 'subtasks' array reflecting the simplification.
4.  Maintain the original priority and due date for the main simplified task unless simplification implies a change (which is rare). Sub-tasks can have their priorities adjusted.
5.  Provide an optional 'aiSummaryMessage' briefly explaining what you did (e.g., "Merged 3 sub-tasks into 1 and shortened descriptions.").

Output MUST be a valid JSON object adhering to the SimplifyTaskBranchOutputSchema.
The 'simplifiedTask' should represent the root task you were asked to simplify, not a list of new tasks.
Its 'title' should be a refined version of the original '{{{taskToSimplify.title}}}'.
Its 'subtasks' array (if any) should contain the simplified children.
`,
});

const simplifyTaskBranchFlow = ai.defineFlow(
    {
        name: 'simplifyTaskBranchFlow',
        inputSchema: SimplifyTaskBranchInputSchema,
        outputSchema: SimplifyTaskBranchOutputSchema,
    },
    async (input: SimplifyTaskBranchInput) => {
        const { output, text } = await runPromptWithFallback(simplifyTaskPrompt, input);
        const raw = extractJsonValue(output, text);
        const rawObject =
            raw && typeof raw === 'object' && !Array.isArray(raw)
                ? (raw as Record<string, unknown>)
                : {};
        const tasks = normalizeAiTasks([rawObject.simplifiedTask], 'Simplified task');
        const simplifiedTask = tasks[0];
        if (!simplifiedTask) {
            throw new Error("AI failed to generate a simplified task. Output was null or malformed.");
        }
        // Ensure the root simplifiedTask has a title.
        if (!simplifiedTask.title || simplifiedTask.title.trim() === "") {
            simplifiedTask.title = input.taskToSimplify.title + " (Simplified)"; // Fallback title
        }
        const aiSummaryMessage =
            typeof rawObject.aiSummaryMessage === 'string'
                ? rawObject.aiSummaryMessage
                : undefined;

        return SimplifyTaskBranchOutputSchema.parse({
            simplifiedTask,
            aiSummaryMessage,
        });
    }
);
