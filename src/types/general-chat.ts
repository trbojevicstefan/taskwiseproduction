import { z } from "zod";

/**
 * Shared contract types for the General AI Chat (Phase 2).
 *
 * POST /api/ai/chat returns an apiSuccess envelope whose `data` matches
 * GeneralChatAnswerSchema. The flow (src/ai/flows/general-chat-flow.ts) and
 * the route both validate against these schemas.
 */

export const GENERAL_CHAT_SOURCE_TYPES = [
  "meeting",
  "transcript",
  "task",
  "person",
  "client",
] as const;

export const GENERAL_CHAT_ACTION_TYPES = [
  "open_meeting",
  "open_task",
  "create_task",
  "schedule_slack_reminder",
  "none",
] as const;

export const GENERAL_CHAT_CONFIDENCE_LEVELS = ["low", "medium", "high"] as const;

export const ChatScopeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("workspace") }).strict(),
  z
    .object({
      type: z.literal("meeting"),
      meetingId: z.string().trim().min(1).max(200),
    })
    .strict(),
  z
    .object({
      type: z.literal("client"),
      clientId: z.string().trim().min(1).max(200),
    })
    .strict(),
  z
    .object({
      type: z.literal("person"),
      personId: z.string().trim().min(1).max(200),
    })
    .strict(),
  z.object({ type: z.literal("planner") }).strict(),
]);

export const GeneralChatSourceSchema = z.object({
  sourceType: z.enum(GENERAL_CHAT_SOURCE_TYPES),
  sourceId: z.string().min(1),
  title: z.string(),
  snippet: z.string(),
  timestamp: z.string().optional(),
});

export const GeneralChatSuggestedActionSchema = z.object({
  label: z.string().min(1),
  actionType: z.enum(GENERAL_CHAT_ACTION_TYPES),
  targetId: z.string().optional(),
});

export const GeneralChatAnswerSchema = z.object({
  answer: z.string().min(1),
  confidence: z.enum(GENERAL_CHAT_CONFIDENCE_LEVELS),
  sources: z.array(GeneralChatSourceSchema),
  suggestedActions: z.array(GeneralChatSuggestedActionSchema),
});

export const ChatHistoryEntrySchema = z
  .object({
    role: z.enum(["user", "assistant"]),
    text: z.string().min(1),
    sources: z.array(GeneralChatSourceSchema).optional(),
  })
  .strict();

export type GeneralChatSourceType = (typeof GENERAL_CHAT_SOURCE_TYPES)[number];
export type GeneralChatActionType = (typeof GENERAL_CHAT_ACTION_TYPES)[number];
export type GeneralChatConfidence =
  (typeof GENERAL_CHAT_CONFIDENCE_LEVELS)[number];
export type ChatScope = z.infer<typeof ChatScopeSchema>;
export type ChatHistoryEntry = z.infer<typeof ChatHistoryEntrySchema>;
export type GeneralChatSource = z.infer<typeof GeneralChatSourceSchema>;
export type GeneralChatSuggestedAction = z.infer<
  typeof GeneralChatSuggestedActionSchema
>;
export type GeneralChatAnswer = z.infer<typeof GeneralChatAnswerSchema>;
