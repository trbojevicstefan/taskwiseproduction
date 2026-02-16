
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

const BRIEF_MODEL = process.env.OPENAI_RESEARCH_BRIEF_MODEL || "gpt-4o-mini";
const BRIEF_MAX_OUTPUT_TOKENS = (() => {
  const parsed = Number(process.env.OPENAI_RESEARCH_BRIEF_MAX_OUTPUT_TOKENS || 520);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 520;
})();
const MAX_TITLE_CHARS = 220;
const MAX_DESCRIPTION_CHARS = 1200;
const MAX_PRIMARY_TRANSCRIPT_CHARS = 3200;
const MAX_RELATED_TRANSCRIPT_CHARS = 1400;
const MAX_RELATED_TRANSCRIPTS = 2;
const MAX_TOTAL_TRANSCRIPT_CHARS = 5200;

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

const toSingleLine = (value: string, maxChars: number) =>
  value.replace(/\s+/g, " ").trim().slice(0, maxChars);

const getKeywords = (input: GenerateResearchBriefInput) => {
  const raw = `${input.taskTitle || ""} ${input.taskDescription || ""} ${input.assigneeName || ""}`
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((token: any) => token.trim())
    .filter((token: any) => token.length >= 4);

  const unique = new Set<string>();
  raw.forEach((token: any) => {
    if (!unique.has(token) && unique.size < 12) {
      unique.add(token);
    }
  });
  return Array.from(unique);
};

const compactTranscript = (
  transcript: string | undefined,
  keywords: string[],
  maxChars: number
) => {
  if (!transcript) return undefined;
  const normalized = transcript.replace(/\r/g, "").trim();
  if (!normalized) return undefined;
  if (normalized.length <= maxChars) return normalized;

  const lower = normalized.toLowerCase();
  let focusIndex = -1;
  for (const keyword of keywords) {
    const idx = lower.indexOf(keyword);
    if (idx >= 0) {
      focusIndex = idx;
      break;
    }
  }

  if (focusIndex < 0) {
    return `${normalized.slice(0, maxChars).trim()} ...`;
  }

  const preWindow = Math.floor(maxChars * 0.35);
  let start = Math.max(0, focusIndex - preWindow);
  const end = Math.min(normalized.length, start + maxChars);
  start = Math.max(0, end - maxChars);

  let excerpt = normalized.slice(start, end).trim();
  if (start > 0) excerpt = `... ${excerpt}`;
  if (end < normalized.length) excerpt = `${excerpt} ...`;
  return excerpt;
};

const prepareBriefInput = (input: GenerateResearchBriefInput): GenerateResearchBriefInput => {
  const keywords = getKeywords(input);
  const primaryTranscript = compactTranscript(
    input.primaryTranscript,
    keywords,
    MAX_PRIMARY_TRANSCRIPT_CHARS
  );

  const relatedCandidates = (input.relatedTranscripts || [])
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .slice(0, MAX_RELATED_TRANSCRIPTS)
    .map((value: any) =>
      compactTranscript(value, keywords, MAX_RELATED_TRANSCRIPT_CHARS)
    )
    .filter((value): value is string => Boolean(value));

  const relatedTranscripts: string[] = [];
  let totalChars = primaryTranscript?.length || 0;
  for (const transcript of relatedCandidates) {
    if (totalChars >= MAX_TOTAL_TRANSCRIPT_CHARS) break;
    const remaining = MAX_TOTAL_TRANSCRIPT_CHARS - totalChars;
    if (remaining <= 0) break;
    if (transcript.length > remaining) {
      relatedTranscripts.push(`${transcript.slice(0, remaining).trim()} ...`);
      totalChars = MAX_TOTAL_TRANSCRIPT_CHARS;
      break;
    }
    relatedTranscripts.push(transcript);
    totalChars += transcript.length;
  }

  return {
    ...input,
    taskTitle: toSingleLine(input.taskTitle || "", MAX_TITLE_CHARS) || "Untitled Task",
    taskDescription: input.taskDescription
      ? toSingleLine(input.taskDescription, MAX_DESCRIPTION_CHARS)
      : undefined,
    assigneeName: input.assigneeName
      ? toSingleLine(input.assigneeName, 120)
      : undefined,
    primaryTranscript,
    relatedTranscripts,
  };
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
      const preparedInput = prepareBriefInput(input);
      const promptOptions = {
        config: {
          model: BRIEF_MODEL,
          maxOutputTokens: BRIEF_MAX_OUTPUT_TOKENS,
        },
      };
      const { output, text } = await runPromptWithFallback(
        researchBriefPrompt,
        preparedInput,
        promptOptions,
        {
          endpoint: "/api/ai/task-insights",
          operation: "brief",
          promptName: "researchBriefPrompt",
        }
      );
      const parsedOutput = output as { researchBrief?: string } | undefined;
      if (parsedOutput?.researchBrief) {
        return { researchBrief: unwrapMarkdown(parsedOutput.researchBrief) };
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

