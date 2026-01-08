
'use server';
/**
 * @fileOverview AI flow for generating a research brief for a given task.
 *
 * - generateResearchBrief - A function that takes task details and returns a research brief.
 * - GenerateResearchBriefInput - The input type for the generateResearchBrief function.
 * - GenerateResearchBriefOutput - The return type for the generateResearchBrief function.
 */

import { ai } from '@/ai/genkit';
import { z } from 'zod';
import { runPromptWithFallback } from '@/ai/prompt-fallback';

const GenerateResearchBriefInputSchema = z.object({
  taskTitle: z.string().describe('The title of the task for which to generate a research brief.'),
  taskDescription: z.string().optional().describe('The detailed description of the task, if available.'),
  assigneeName: z.string().optional().describe("The assignee's name, if available."),
  taskPriority: z.enum(["low", "medium", "high"]).optional().describe("Task priority, if available."),
  primaryTranscript: z.string().optional().describe('Full transcript for the primary meeting context.'),
  relatedTranscripts: z.array(z.string()).optional().describe('Additional transcripts related to the assignee.'),
});
export type GenerateResearchBriefInput = z.infer<typeof GenerateResearchBriefInputSchema>;

const GenerateResearchBriefOutputSchema = z.object({
  researchBrief: z.string().describe('The AI-generated research brief in markdown format.'),
});
export type GenerateResearchBriefOutput = z.infer<typeof GenerateResearchBriefOutputSchema>;

export async function generateResearchBrief(input: GenerateResearchBriefInput): Promise<GenerateResearchBriefOutput> {
  return generateResearchBriefFlow(input);
}

const unwrapMarkdown = (value: string): string => {
  const trimmed = value.trim();
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const brief =
      (typeof parsed.researchBrief === 'string' && parsed.researchBrief.trim()) ||
      (typeof parsed.research_brief === 'string' && parsed.research_brief.trim());
    return brief || trimmed;
  } catch {
    return trimmed;
  }
};

const researchBriefPrompt = ai.definePrompt({
  name: 'researchBriefPrompt',
  input: {schema: GenerateResearchBriefInputSchema},
  output: {schema: GenerateResearchBriefOutputSchema},
  prompt: `You are an expert research assistant. Your goal is to generate a concise research brief based on a given task.

Task Title: {{{taskTitle}}}
{{#if taskDescription}}
Task Description: {{{taskDescription}}}
{{/if}}
{{#if assigneeName}}
Assignee: {{{assigneeName}}}
{{/if}}
{{#if taskPriority}}
Task Priority: {{{taskPriority}}}
{{/if}}

{{#if primaryTranscript}}
Primary Meeting Transcript:
{{{primaryTranscript}}}
{{/if}}

{{#if relatedTranscripts}}
Additional Relevant Transcripts:
{{#each relatedTranscripts}}
- Transcript {{@index}}:
{{this}}
{{/each}}
{{/if}}

Based on the provided task information, please generate a short research brief covering the following sections (use markdown for formatting):
1.  **Problem Overview:** 1 short sentence.
2.  **Key Considerations/Questions:** 2-3 brief bullet points.
3.  **Potential Obstacles/Risks:** 1-2 brief bullet points.
4.  **Possible Angles for Deeper Research:** 2 brief bullet points.

Use the transcripts to ground the brief in real context. If transcripts are missing, focus on the task details. Keep the brief concise and actionable: aim for 8-10 lines total, avoid long paragraphs, and keep each bullet to a single line. The brief should be formatted as a single markdown string.
`,
});

const generateResearchBriefFlow = ai.defineFlow(
  {
    name: 'generateResearchBriefFlow',
    inputSchema: GenerateResearchBriefInputSchema,
    outputSchema: GenerateResearchBriefOutputSchema,
  },
  async (input: GenerateResearchBriefInput) => {
    try {
      const { output, text } = await runPromptWithFallback(researchBriefPrompt, input);
      if (output?.researchBrief) {
        return { researchBrief: unwrapMarkdown(output.researchBrief) };
      }
      if (text && text.trim()) {
        return { researchBrief: unwrapMarkdown(text) };
      }
      return { researchBrief: "The AI returned an empty response. Please try again." };
    } catch (error) {
      console.error("Error in generateResearchBriefFlow:", error);
      // Return a user-friendly error message within the expected schema
      return { researchBrief: "The AI service is currently unavailable or encountered an error. Please try again shortly." };
    }
  }
);
