// src/ai/flows/chat-intent-router-flow.ts
'use server';
/**
 * @fileOverview Lightweight intent router for meeting chat.
 * Decides whether the user wants retrieval (knowledge) or action (task edits).
 */

import { z } from 'zod';
import { ai } from '@/ai/genkit';
import { runPromptWithFallback } from '@/ai/prompt-fallback';
import { extractJsonValue } from './parse-json-output';

const ChatIntentInputSchema = z.object({
  message: z.string(),
  hasTranscript: z.boolean(),
  hasTasks: z.boolean(),
});

const ChatIntentOutputSchema = z.object({
  intent: z.enum(['knowledge', 'action', 'ambiguous']),
  confidence: z.number().min(0).max(1).optional(),
  reasoning: z.string().optional(),
  clarifyingQuestion: z.string().optional(),
});

export type ChatIntentInput = z.infer<typeof ChatIntentInputSchema>;
export type ChatIntentOutput = z.infer<typeof ChatIntentOutputSchema>;

const routerPrompt = ai.definePrompt({
  name: 'chatIntentRouterPrompt',
  input: { schema: ChatIntentInputSchema },
  output: { format: 'json' },
  prompt: `
You are the Intelligent Meeting Orchestrator. Your job is to decide whether the user wants:
- "knowledge": ask about meeting content or past discussion.
- "action": create/update/delete tasks or change the task list.
- "ambiguous": not enough detail to safely proceed; ask a clarifying question.

Context:
- hasTranscript: {{hasTranscript}}
- hasTasks: {{hasTasks}}

User Message:
"{{{message}}}"

Routing Rules:
1) If the user is asking about "what/why/who/when" or mentions a speaker said something, choose "knowledge".
2) If the user asks to add, update, delete, assign, or change tasks, choose "action".
3) If both are present, prefer "action" only when the command is explicit. Otherwise choose "ambiguous".
4) If hasTranscript is false, default to "action".
5) If the command is underspecified (e.g., "update the task"), choose "ambiguous" and ask a question.

Output JSON only:
{
  "intent": "knowledge" | "action" | "ambiguous",
  "confidence": 0.0-1.0,
  "reasoning": "one sentence",
  "clarifyingQuestion": "only if ambiguous"
}
`,
});

export async function routeChatIntent(input: ChatIntentInput): Promise<ChatIntentOutput> {
  const { output, text } = await runPromptWithFallback(routerPrompt, input);
  const raw = extractJsonValue(output, text);
  const parsed = ChatIntentOutputSchema.safeParse(raw);
  if (parsed.success) {
    return parsed.data;
  }

  const message = input.message.toLowerCase();
  const questionLike =
    /\?$/.test(message) ||
    /^(who|what|when|where|why|how|did|do|does|is|are|can|could|should|would)\b/.test(message);
  const actionSignals = /(add|create|update|change|edit|delete|remove|assign|reassign|due|deadline|priority|merge|split|break down|simplify)/.test(
    message
  );

  if (!input.hasTranscript) {
    return { intent: 'action', confidence: 0.6 };
  }
  if (actionSignals && !questionLike) {
    return { intent: 'action', confidence: 0.6 };
  }
  if (questionLike) {
    return { intent: 'knowledge', confidence: 0.6 };
  }
  return {
    intent: 'ambiguous',
    confidence: 0.4,
    clarifyingQuestion: 'Do you want a transcript answer or should I update the task list?',
  };
}
