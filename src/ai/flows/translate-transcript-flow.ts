"use server";
/**
 * @fileOverview Translate a meeting transcript while preserving timestamps and formatting.
 */

import { z } from "zod";
import { ai } from "@/ai/genkit";
import { runPromptWithFallback } from "@/ai/prompt-fallback";

export const TranslateTranscriptInputSchema = z.object({
  transcript: z.string(),
  targetLanguage: z.string(),
});

export const TranslateTranscriptOutputSchema = z.object({
  translatedTranscript: z.string(),
});

export type TranslateTranscriptInput = z.infer<typeof TranslateTranscriptInputSchema>;
export type TranslateTranscriptOutput = z.infer<typeof TranslateTranscriptOutputSchema>;

const translatePrompt = ai.definePrompt({
  name: "translateTranscriptPrompt",
  input: { schema: TranslateTranscriptInputSchema },
  prompt: `
You are a translation engine. Translate the transcript into {{targetLanguage}}.

Rules:
- Preserve all timestamps, speaker names, emails, URLs, IDs, and bracketed metadata exactly.
- Keep the line breaks, indentation, and spacing identical to the input.
- Do NOT add, remove, or reorder lines.
- Only translate the spoken content.

Return only the translated transcript. No commentary, no quotes, no code fences.

Transcript:
<<<TRANSCRIPT
{{{transcript}}}
TRANSCRIPT
`,
});

const TRANSLATION_MODEL = process.env.OPENAI_TRANSLATE_MODEL || "gpt-4.1";

const translateTranscriptFlow = ai.defineFlow(
  {
    name: "translateTranscriptFlow",
    inputSchema: TranslateTranscriptInputSchema,
    outputSchema: TranslateTranscriptOutputSchema,
  },
  async (input: TranslateTranscriptInput) => {
    const { text } = await runPromptWithFallback(translatePrompt, input, {
      config: { model: TRANSLATION_MODEL },
    });
    const translatedTranscript = typeof text === "string" ? text : "";
    if (!translatedTranscript.trim()) {
      throw new Error("Translation returned empty output.");
    }
    return { translatedTranscript };
  }
);

export async function translateTranscript(
  input: TranslateTranscriptInput
): Promise<TranslateTranscriptOutput> {
  return await translateTranscriptFlow(input);
}
