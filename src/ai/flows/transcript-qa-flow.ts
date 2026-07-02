
// src/ai/flows/transcript-qa-flow.ts
'use server';
/**
 * @fileOverview This flow is dedicated to answering questions about a meeting transcript.
 * It is designed to provide direct, synthesized answers grounded in the provided text,
 * rather than generating tasks or other structured data.
 */

import { ai } from '@/ai/genkit';
import {
  TranscriptQAInputSchema,
  type TranscriptQAInput,
  TranscriptQAOutputSchema,
  type TranscriptQAOutput,
} from './schemas';
import { runPromptWithFallback } from '@/ai/prompt-fallback';
import { extractJsonValue } from './parse-json-output';
import { extractTranscriptAttendees, extractTranscriptTasks } from '@/lib/transcript-utils';

// --- GENKIT PROMPT ---

const qaPrompt = ai.definePrompt({
  name: 'transcriptQAPrompt',
  input: { schema: TranscriptQAInputSchema },
  output: { schema: TranscriptQAOutputSchema },
  prompt: `
You are a Principal Analyst & Strategist. Your only job is to answer the user's question based on the provided meeting transcript.

**Relevant Meeting Transcript Excerpts:**
\`\`\`
{{{transcript}}}
\`\`\`

{{#if tasks}}
**Current Task List (for context):**
\`\`\`json
{{json tasks}}
\`\`\`
{{/if}}

{{#if previousSessionContext}}
**Context from Previous Meeting:**
{{{previousSessionContext}}}
{{/if}}

**User's Question:**
"{{{question}}}"

**Your Instructions:**
1.  **Synthesize an Answer:** Do NOT just search for keywords. Read and understand the relevant parts of the transcript to form a complete, insightful answer to the user's question.
2.  **Infer Intent:** Understand the *underlying* question. "Why was the deadline changed?" requires looking for discussions about scope, resources, or blockers, not just the word "deadline".
3.  **Ground Your Answer:** Your entire answer must be based on the provided transcript. If the transcript does not contain the information to answer the question, you MUST state that clearly. For example: "The transcript does not mention the specific reason for the budget change."
4.  **Cite Your Sources:** For every piece of information you use in your answer, you MUST populate the \`sources\` array with the corresponding \`timestamp\` and \`snippet\` from the transcript. This is mandatory for providing evidence.
5.  **Output:** Your response must be a single JSON object containing the \`answerText\` and the \`sources\` array. Do not create tasks or any other data.
	  `,
});

const QA_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "did",
  "do",
  "for",
  "from",
  "how",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "the",
  "to",
  "was",
  "what",
  "when",
  "where",
  "who",
  "why",
  "with",
]);

const tokenize = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((token: any) => token.trim())
    .filter((token: any) => token.length > 2 && !QA_STOPWORDS.has(token));

const toRelevantTranscript = (transcript: string, question: string) => {
  const cleanTranscript = transcript.trim();
  if (!cleanTranscript) return cleanTranscript;
  if (cleanTranscript.length <= 5000) return cleanTranscript;

  const lines = cleanTranscript
    .split(/\r?\n/)
    .map((line: any) => line.trim())
    .filter(Boolean);
  if (lines.length <= 80) return cleanTranscript;

  const queryTokens = new Set(tokenize(question));
  if (!queryTokens.size) {
    const head = lines.slice(0, 30);
    const tail = lines.slice(-20);
    return [...head, ...tail].join("\n");
  }

  const scored = lines
    .map((line, index) => {
      const lineTokens = tokenize(line);
      if (!lineTokens.length) return { index, score: 0 };
      let overlap = 0;
      lineTokens.forEach((token: any) => {
        if (queryTokens.has(token)) overlap += 1;
      });
      const score = overlap / Math.max(1, Math.min(queryTokens.size, lineTokens.length));
      return { index, score };
    })
    .sort((a: any, b: any) => b.score - a.score);

  const selectedIndexes = new Set<number>();
  scored.slice(0, 24).forEach((entry: any) => {
    if (entry.score <= 0) return;
    selectedIndexes.add(entry.index);
    if (entry.index > 0) selectedIndexes.add(entry.index - 1);
    if (entry.index < lines.length - 1) selectedIndexes.add(entry.index + 1);
  });

  if (!selectedIndexes.size) {
    return lines.slice(0, 50).join("\n");
  }

  return Array.from(selectedIndexes)
    .sort((a: any, b: any) => a - b)
    .map((index: any) => lines[index])
    .join("\n");
};

// --- GENKIT FLOW ---

const answerFromTranscriptFlow = ai.defineFlow(
  {
    name: 'answerFromTranscriptFlow',
    inputSchema: TranscriptQAInputSchema,
    outputSchema: TranscriptQAOutputSchema,
  },
  async (input: TranscriptQAInput) => {
    const promptInput: TranscriptQAInput = {
      ...input,
      transcript: toRelevantTranscript(input.transcript, input.question),
    };
    const { output, text } = await runPromptWithFallback(
      qaPrompt,
      promptInput,
      undefined,
      {
        endpoint: "transcriptQA.answer",
      }
    );
    const raw = extractJsonValue(output, text);
    const parsed = TranscriptQAOutputSchema.safeParse(raw);
    if (parsed.success) {
      return parsed.data;
    }

    const getString = (value: unknown): string | undefined =>
      typeof value === "string" && value.trim() ? value.trim() : undefined;
    const extractTimestamp = (snippet?: string): string | undefined => {
      if (!snippet) return undefined;
      const match = snippet.match(/\b(\d{1,2}:\d{2}(?::\d{2})?)\b/);
      return match ? match[1] : undefined;
    };
    const splitTranscriptLines = (transcript: string): string[] =>
      transcript
        .split(/\r?\n/)
        .map((line: any) => line.trim())
        .filter(Boolean);
    const findSnippetForName = (transcript: string, name: string): { timestamp: string; snippet: string } | null => {
      const normalized = name.toLowerCase();
      const lines = splitTranscriptLines(transcript);
      for (const line of lines) {
        if (line.toLowerCase().includes(normalized)) {
          return {
            timestamp: extractTimestamp(line) || "N/A",
            snippet: line.length > 240 ? `${line.slice(0, 240).trim()}...` : line,
          };
        }
      }
      return null;
    };
    const normalizeSources = (value: unknown): TranscriptQAOutput["sources"] => {
      if (!Array.isArray(value)) return undefined;
      const normalized = value
        .map((entry: any) => {
          if (!entry || typeof entry !== "object") return null;
          const item = entry as { timestamp?: unknown; time?: unknown; snippet?: unknown; quote?: unknown; text?: unknown };
          const snippet = getString(item.snippet) || getString(item.quote) || getString(item.text);
          if (!snippet) return null;
          const timestamp = getString(item.timestamp) || getString(item.time) || extractTimestamp(snippet) || "N/A";
          return { timestamp, snippet };
        })
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
      return normalized.length ? normalized : undefined;
    };

    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      const record = raw as Record<string, unknown>;
      const answerText =
        getString(record.answerText) ||
        getString(record.answer) ||
        getString(record.response) ||
        getString(record.summary) ||
        getString(text);
      if (answerText) {
        return {
          answerText,
          sources: normalizeSources(record.sources),
        };
      }
    }

    if (text && text.trim()) {
      return {
        answerText: text.trim(),
        sources: [],
      };
    }

    const question = input.question.toLowerCase();
    const transcript = input.transcript?.trim();
    if (transcript) {
      if (question.includes("who") && (question.includes("attend") || question.includes("participant") || question.includes("meeting"))) {
        const attendees = extractTranscriptAttendees(transcript).map((person: any) => person.name).filter(Boolean);
        if (!attendees.length) {
          return {
            answerText: "The transcript does not list any attendees explicitly.",
            sources: [],
          };
        }
        const sources = attendees
          .map((name: any) => findSnippetForName(transcript, name))
          .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
        return {
          answerText: `Attendees mentioned in the transcript: ${attendees.join(', ')}.`,
          sources,
        };
      }
      if (question.includes("action item") || question.includes("action items") || question.includes("tasks")) {
        const tasks = (input.tasks || extractTranscriptTasks(transcript)) as { title?: string; sourceEvidence?: { snippet: string; timestamp?: string | null }[] }[];
        if (!tasks.length) {
          return {
            answerText: "The transcript does not contain any explicit action items.",
            sources: [],
          };
        }
        const titles = tasks.map((task: any) => task.title).filter(Boolean);
        const sources = tasks
          .flatMap((task: any) => task.sourceEvidence || [])
          .map((evidence: any) => ({
            timestamp: evidence.timestamp || extractTimestamp(evidence.snippet) || "N/A",
            snippet: evidence.snippet,
          }))
          .filter((entry: any) => entry.snippet);
        return {
          answerText: `Action items from the transcript: ${titles.join('; ')}.`,
          sources,
        };
      }
      if (question.includes("summary") || question.includes("recap") || question.includes("what happened")) {
        return {
          answerText: "The transcript does not include a summary in the available metadata.",
          sources: [],
        };
      }
      if (question.startsWith("when") || question.includes("when was")) {
        return {
          answerText: "The transcript does not specify the meeting date or time.",
          sources: [],
        };
      }
    }

    return {
      answerText: transcript
        ? "The transcript does not contain enough information to answer that question."
        : "Transcript data is not available for this meeting.",
    };
  }
);

/**
 * Wrapper function to be called from the orchestrator.
 */
export async function answerFromTranscript(input: TranscriptQAInput): Promise<TranscriptQAOutput> {
  return await answerFromTranscriptFlow(input);
}



