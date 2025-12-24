
'use server';
/**
 * @fileOverview AI flow for providing assistance on a given task, including potential obstacles, solution strategies, and research prompts.
 *
 * - generateTaskAssistance - A function that takes task details and returns helpful assistance.
 * - GenerateTaskAssistanceInput - The input type for the generateTaskAssistance function.
 * - GenerateTaskAssistanceOutput - The return type for the generateTaskAssistance function.
 */

import { ai } from '@/ai/genkit';
import { z } from 'zod';
import { runPromptWithFallback } from '@/ai/prompt-fallback';

const GenerateTaskAssistanceInputSchema = z.object({
  taskTitle: z.string().describe('The title of the task for which assistance is requested.'),
  taskDescription: z.string().optional().describe('The detailed description of the task, if available.'),
});
export type GenerateTaskAssistanceInput = z.infer<typeof GenerateTaskAssistanceInputSchema>;

const GenerateTaskAssistanceOutputSchema = z.object({
  assistanceMarkdown: z.string().describe('The AI-generated assistance in markdown format. This should include sections for potential obstacles, solution strategies, and key questions or research pointers.'),
});
export type GenerateTaskAssistanceOutput = z.infer<typeof GenerateTaskAssistanceOutputSchema>;

export async function generateTaskAssistance(input: GenerateTaskAssistanceInput): Promise<GenerateTaskAssistanceOutput> {
  return generateTaskAssistanceFlow(input);
}

const unwrapMarkdown = (value: string): string => {
  const trimmed = value.trim();
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const assistance =
      (typeof parsed.assistanceMarkdown === 'string' && parsed.assistanceMarkdown.trim()) ||
      (typeof parsed.assistance_markdown === 'string' && parsed.assistance_markdown.trim());
    return assistance || trimmed;
  } catch {
    return trimmed;
  }
};

const taskAssistancePrompt = ai.definePrompt({
  name: 'taskAssistancePrompt',
  input: {schema: GenerateTaskAssistanceInputSchema},
  output: {schema: GenerateTaskAssistanceOutputSchema},
  prompt: `You are a helpful AI assistant and an expert project coach. A user is looking for help with the following task:

Task Title: {{{taskTitle}}}
{{#if taskDescription}}
Task Description: {{{taskDescription}}}
{{/if}}

Based on this task, please provide assistance by outlining:
1.  **Potential Obstacles:** What are 2-3 common challenges or roadblocks someone might encounter when trying to complete this type of task?
2.  **Suggested Strategies:** Offer 2-3 high-level strategies or approaches to tackle this task effectively or overcome the identified obstacles.
3.  **Key Questions / Research Pointers:** Suggest 2-3 specific questions the user could ask themselves or research areas they could explore to gain clarity or find solutions related to this task.

Format your entire response as a single markdown string. Use headings for each section (e.g., "### Potential Obstacles").
Keep your advice concise, actionable, and generally applicable.
`,
});

const generateTaskAssistanceFlow = ai.defineFlow(
  {
    name: 'generateTaskAssistanceFlow',
    inputSchema: GenerateTaskAssistanceInputSchema,
    outputSchema: GenerateTaskAssistanceOutputSchema,
  },
  async (input: GenerateTaskAssistanceInput) => {
    try {
      const { output, text } = await runPromptWithFallback(taskAssistancePrompt, input);
      if (output?.assistanceMarkdown) {
        return { assistanceMarkdown: unwrapMarkdown(output.assistanceMarkdown) };
      }
      if (text && text.trim()) {
        return { assistanceMarkdown: unwrapMarkdown(text) };
      }
      return {
        assistanceMarkdown:
          "The AI returned an empty response. Please try again.",
      };
    } catch (error) {
      console.error("Error in generateTaskAssistanceFlow:", error);
      return {
        assistanceMarkdown:
          "The AI service is currently unavailable or encountered an error. Please try again shortly.",
      };
    }
  }
);
