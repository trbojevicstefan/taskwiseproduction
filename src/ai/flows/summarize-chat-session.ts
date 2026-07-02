
// Summarizes chat sessions to provide users with a quick understanding of past conversations.

'use server';

import { ai } from '@/ai/genkit';
import { z } from 'zod';
import { runPromptWithFallback } from '@/ai/prompt-fallback';

const SummarizeChatSessionInputSchema = z.object({
  chatSessionId: z.string().describe('The ID of the chat session to summarize.'),
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']).describe('The role of the message sender.'),
    content: z.string().describe('The content of the message.'),
  })).describe('The messages in the chat session.'),
});

export type SummarizeChatSessionInput = z.infer<typeof SummarizeChatSessionInputSchema>;

const SummarizeChatSessionOutputSchema = z.object({
  summary: z.string().describe('A concise summary of the chat session.'),
});

export type SummarizeChatSessionOutput = z.infer<typeof SummarizeChatSessionOutputSchema>;

export async function summarizeChatSession(input: SummarizeChatSessionInput): Promise<SummarizeChatSessionOutput> {
  return summarizeChatSessionFlow(input);
}

const summarizeChatSessionPrompt = ai.definePrompt({
  name: 'summarizeChatSessionPrompt',
  input: {
    schema: SummarizeChatSessionInputSchema,
  },
  output: {
    schema: SummarizeChatSessionOutputSchema,
  },
  prompt: `Summarize the following chat session. The summary should be concise and capture the key points of the conversation.\n\nChat Session ID: {{{chatSessionId}}}\n\nMessages:\n{{#each messages}}\n{{role}}: {{{content}}}\n{{/each}}`,
});

const summarizeChatSessionFlow = ai.defineFlow({
  name: 'summarizeChatSessionFlow',
  inputSchema: SummarizeChatSessionInputSchema,
  outputSchema: SummarizeChatSessionOutputSchema,
}, async (input: SummarizeChatSessionInput) => {
  const { output, text } = await runPromptWithFallback(
    summarizeChatSessionPrompt,
    input
  );
  const parsed = SummarizeChatSessionOutputSchema.safeParse(output);
  if (parsed.success) {
    return parsed.data;
  }
  return { summary: (text || "").trim() || "Unable to summarize this chat session." };
});
