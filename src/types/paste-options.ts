// src/types/paste-options.ts
import { z } from 'zod';

export const styleOptions = z.enum(['meeting_transcript', 'general', 'vibe_coding', 'ai_chatgpt', 'ai_claude', 'ai_gemini']);
export type StyleOption = z.infer<typeof styleOptions>;
