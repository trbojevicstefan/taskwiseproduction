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
  assigneeKey: z.string().optional(),
});

export const DetectCompletedTasksInputSchema = z.object({
  transcript: z.string(),
  candidates: z.array(CompletionCandidateSchema),
});

const DetectCompletedTasksPromptInputSchema = z.object({
  transcript: z.string(),
  candidatesJson: z.string(),
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
  input: { schema: DetectCompletedTasksPromptInputSchema },
  output: { format: "json" },
  prompt: `
You are a Completion Auditor. Your job is to identify which open tasks were confirmed as DONE in the transcript.

Rules:
- Only select tasks from the provided candidate list. Do NOT invent tasks.
- Match tasks by meaning even if the transcript uses slightly different wording, abbreviations, or minor misspellings (e.g., "Cvilio" vs "Twillio").
- Mark a task as completed ONLY if the transcript clearly indicates it is finished (explicit or implicit). This can be:
  - explicit completion words (done, finished, completed, wrapped up, shipped, resolved, closed, finalized)
  - clear completion statements (we bought/purchased it, it's live, it's ready, it's in place, we already did it, it's handled/taken care of, signed off, approved, deployed, published, submitted)
- If a task is only in progress, planned, or merely discussed, DO NOT include it.
- If a speaker says "I'm done with [Task]" or "I finished [Task]", mark it as completed.
- Handle status updates like "Update on [Task]: it's complete/finished/done".
- Resolve pronouns like "it", "that", or "this" to the best matching candidate in this shortlist.
- If the transcript input is a short snippet, prioritize semantic equivalence over exact wording.
- When only one candidate strongly matches the completion evidence, include it.
- Use assigneeKey only as a tie-breaker when two task titles are similar.
- Provide a short supporting snippet and (if available) the speaker name and timestamp.
- Be conservative. If completion is ambiguous or uncertain, return no match.
- If a line indicates a blocker, failure, retry, error, or "we need to do this", it is NOT completed.
- Never include more than 3 completed items for one short snippet unless the transcript explicitly confirms each one.

Open task candidates (JSON):
\`\`\`
{{{candidatesJson}}}
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

const COMPLETION_AUDIT_MODEL =
  process.env.COMPLETION_AUDIT_MODEL ||
  process.env.OPENAI_COMPLETION_AUDIT_MODEL ||
  "gpt-4o-mini";
const COMPLETION_AUDIT_MAX_TOKENS = Math.min(
  900,
  Math.max(200, Number(process.env.COMPLETION_AUDIT_MAX_TOKENS || 450))
);
const COMPLETION_AUDIT_DEBUG = process.env.TASK_COMPLETION_DEBUG === "1";

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

    const promptInput = {
      transcript: input.transcript,
      candidatesJson: JSON.stringify(
        input.candidates.map((candidate) => ({
          groupId: candidate.groupId,
          title: candidate.title,
          assigneeKey: candidate.assigneeKey || "",
        })),
        null,
        2
      ),
    };

    if (COMPLETION_AUDIT_DEBUG) {
      console.info("[completion-audit] request", {
        transcriptChars: input.transcript.length,
        candidateCount: input.candidates.length,
        sampleCandidates: input.candidates.slice(0, 5).map((candidate) => ({
          groupId: candidate.groupId,
          title: candidate.title,
          assigneeKey: candidate.assigneeKey || "",
        })),
      });
    }

    const { output, text } = await runPromptWithFallback(
      completionPrompt,
      promptInput,
      {
        config: {
          model: COMPLETION_AUDIT_MODEL,
          maxOutputTokens: COMPLETION_AUDIT_MAX_TOKENS,
        },
      },
      {
        endpoint: "completionDetection.audit",
        operation: `candidateCount=${input.candidates.length};transcriptChars=${input.transcript.length}`,
      }
    );
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
