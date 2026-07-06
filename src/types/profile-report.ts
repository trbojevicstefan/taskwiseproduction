import { z } from "zod";
import {
  GENERAL_CHAT_CONFIDENCE_LEVELS,
  GeneralChatSourceSchema,
} from "@/types/general-chat";

/**
 * Priority 9 — one-click person/company report contract.
 *
 * POST /api/people/[id]/report and POST /api/companies/[id]/report return an
 * apiSuccess envelope whose `data` matches ProfileReportSchema. Sources reuse
 * the GeneralChatSource shape so the same anti-hallucination id filtering
 * applies (every sourceId must exist in the gathered evidence).
 */

export const PROFILE_REPORT_SUBJECT_TYPES = ["person", "company"] as const;

export const ProfileReportSchema = z.object({
  subjectType: z.enum(PROFILE_REPORT_SUBJECT_TYPES),
  subjectName: z.string().min(1),
  generatedAt: z.string().min(1),
  executiveSummary: z.string().min(1),
  openCommitments: z.array(z.string()),
  overdueOrRisk: z.array(z.string()),
  completedWork: z.array(z.string()),
  recentMeetings: z.array(z.string()),
  keyDecisions: z.array(z.string()),
  suggestedNextAction: z.string(),
  confidence: z.enum(GENERAL_CHAT_CONFIDENCE_LEVELS),
  sources: z.array(GeneralChatSourceSchema),
});

export type ProfileReportSubjectType =
  (typeof PROFILE_REPORT_SUBJECT_TYPES)[number];
export type ProfileReport = z.infer<typeof ProfileReportSchema>;
