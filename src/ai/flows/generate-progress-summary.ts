'use server';

import { z } from 'zod';
import { ai } from '@/ai/genkit';
import { TaskSchema } from './schemas';
import { extractJsonValue } from './parse-json-output';
import { runPromptWithFallback } from '@/ai/prompt-fallback';

export const GenerateProgressSummaryInputSchema = z.object({
    previousMeetingDate: z.string(),
    previousMeetingTitle: z.string(),
    completedTasks: z.array(TaskSchema),
    pendingTasks: z.array(TaskSchema),
    newlyCompletedTasks: z.array(TaskSchema).optional(), // Tasks done since then
});
export type GenerateProgressSummaryInput = z.infer<typeof GenerateProgressSummaryInputSchema>;

export const GenerateProgressSummaryOutputSchema = z.object({
    summary: z.string().describe("A concise natural language summary of progress since the last meeting."),
});
export type GenerateProgressSummaryOutput = z.infer<typeof GenerateProgressSummaryOutputSchema>;

const progressPrompt = ai.definePrompt({
    name: 'generateProgressSummary',
    input: { schema: GenerateProgressSummaryInputSchema },
    output: { schema: GenerateProgressSummaryOutputSchema },
    prompt: `
You are an executive assistant preparing a progress report for a recurring meeting.
Compare the state of tasks from the previous meeting on {{previousMeetingDate}} ("{{previousMeetingTitle}}") to now.

**Context:**
- Completed Tasks (Done): {{json completedTasks}}
- Pending Tasks (Todo/In Progress): {{json pendingTasks}}
{{#if newlyCompletedTasks}}
- Recently Completed (Since last meeting): {{json newlyCompletedTasks}}
{{/if}}

**Instructions:**
1. Generate a concise, clear paragraph summarizing the progress.
2. Highlight key completions.
3. Mention how many items remain pending.
4. Keep it professional and brief (under 100 words).
5. Start with something like "Since our last meeting on [Date]..."
  `,
});

export const generateProgressSummary = ai.defineFlow(
    {
        name: 'generateProgressSummaryFlow',
        inputSchema: GenerateProgressSummaryInputSchema,
        outputSchema: GenerateProgressSummaryOutputSchema,
    },
    async (input: GenerateProgressSummaryInput): Promise<GenerateProgressSummaryOutput> => {
        const { output, text } = await runPromptWithFallback(progressPrompt, input);
        const raw = extractJsonValue(output, text);
        const parsed = GenerateProgressSummaryOutputSchema.safeParse(raw);
        if (parsed.success) {
            return parsed.data;
        }
        return { summary: text || "Could not generate summary." };
    }
);
