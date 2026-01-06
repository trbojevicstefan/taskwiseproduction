// src/ai/flows/detect-completed-tasks-flow.ts
/**
 * @fileOverview Detects which open tasks were explicitly completed in a transcript.
 */

import { z } from "zod";
import { ai } from "@/ai/genkit";
import { runPromptWithFallback } from "@/ai/prompt-fallback";
import { extractJsonValue } from "./parse-json-output";

const CompletionCandidateSchema = z.object({
  groupId: z.string(),
  title: z.string(),
  description: z.string().optional(),
  assigneeName: z.string().optional(),
  assigneeEmail: z.string().optional(),
  dueAt: z.string().optional(),
  priority: z.string().optional(),
});

export const DetectCompletedTasksInputSchema = z.object({
  transcript: z.string(),
  candidates: z.array(CompletionCandidateSchema),
});

export const DetectCompletedTasksOutputSchema = z.object({
  completed: z
    .array(
      z.object({
        groupId: z.string(),
        confidence: z.number().min(0).max(1).optional(),
        evidence: z.object({
          snippet: z.string(),
          speaker: z.string().optional(),
          timestamp: z.string().optional(),
        }),
      })
    )
    .default([]),
});

export type DetectCompletedTasksInput = z.infer<typeof DetectCompletedTasksInputSchema>;
export type DetectCompletedTasksOutput = z.infer<typeof DetectCompletedTasksOutputSchema>;

const completionPrompt = ai.definePrompt({
  name: "detectCompletedTasksPrompt",
  input: { schema: DetectCompletedTasksInputSchema },
  output: { format: "json" },
  prompt: `
You are a Completion Auditor. Your job is to identify which open tasks were confirmed as DONE in the transcript.

Rules:
- Only select tasks from the provided candidate list. Do NOT invent tasks.
- Match tasks by meaning even if the transcript uses slightly different wording, abbreviations, or minor misspellings (e.g., "Cvilio" vs "Sevilio").
- Mark a task as completed ONLY if the transcript clearly indicates it is finished (explicit or implicit). This can be:
  - explicit completion words (done, finished, completed, wrapped up, shipped, resolved, closed, finalized)
  - clear completion statements (we bought/purchased it, it's live, it's ready, it's in place, we already did it, it's handled/taken care of, signed off, approved, deployed, published, submitted)
- If a task is only in progress, planned, or merely discussed, DO NOT include it.
- Provide a short supporting snippet and (if available) the speaker name and timestamp.

Open tasks (JSON):
\`\`\`
{{{candidates}}}
\`\`\`

Transcript (may be shortened to completion-related lines):
\`\`\`
{{{transcript}}}
\`\`\`

Output JSON only:
{
  "completed": [
    {
      "groupId": "candidate groupId",
      "confidence": 0.0-1.0,
      "evidence": {
        "snippet": "short exact transcript excerpt",
        "speaker": "optional speaker",
        "timestamp": "optional timestamp"
      }
    }
  ]
}
`,
});

const detectCompletedTasksFlow = ai.defineFlow(
  {
    name: "detectCompletedTasksFlow",
    inputSchema: DetectCompletedTasksInputSchema,
    outputSchema: DetectCompletedTasksOutputSchema,
  },
  async (input: DetectCompletedTasksInput): Promise<DetectCompletedTasksOutput> => {
    if (!input.candidates.length) {
      return { completed: [] };
    }

    const { output, text } = await runPromptWithFallback(completionPrompt, input);
    const raw = extractJsonValue(output, text);
    const parsed = raw && typeof raw === "object" ? raw : {};
    return DetectCompletedTasksOutputSchema.parse(parsed);
  }
);

export async function detectCompletedTasks(
  input: DetectCompletedTasksInput
): Promise<DetectCompletedTasksOutput> {
  return await detectCompletedTasksFlow(input);
}
