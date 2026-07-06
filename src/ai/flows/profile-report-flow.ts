// src/ai/flows/profile-report-flow.ts
/**
 * @fileOverview One-click person/company report flow (Priority 9).
 *
 * Composes a structured report (executive summary, open commitments, overdue
 * or at-risk items, completed work, recent meetings, key decisions, suggested
 * next action) grounded ONLY in the pre-gathered evidence blocks rendered by
 * src/lib/profile-report.ts. The LLM call goes through runPromptWithFallback
 * (model override OPENAI_PROFILE_REPORT_MODEL, default gpt-4o-mini) and the
 * JSON output is parsed leniently; when parsing fails or the model errors, a
 * deterministic low-confidence report is built from the context lines — this
 * flow never throws to the route.
 *
 * NOTE: deliberately NOT a 'use server' module — it must only be reachable
 * through the authenticated report routes, not as a client-callable action.
 */

import { z } from "zod";
import { ai } from "@/ai/genkit";
import { runPromptWithFallback } from "@/ai/prompt-fallback";
import { extractJsonValue } from "./parse-json-output";
import {
  GENERAL_CHAT_CONFIDENCE_LEVELS,
  GENERAL_CHAT_SOURCE_TYPES,
  type GeneralChatSource,
} from "@/types/general-chat";
import {
  PROFILE_REPORT_SUBJECT_TYPES,
  ProfileReportSchema,
  type ProfileReport,
  type ProfileReportSubjectType,
} from "@/types/profile-report";

export const ProfileReportFlowInputSchema = z.object({
  subjectType: z.enum(PROFILE_REPORT_SUBJECT_TYPES),
  subjectName: z.string(),
  contextBlocks: z.string(),
  today: z.string(),
});

export type ProfileReportFlowInput = z.infer<typeof ProfileReportFlowInputSchema>;

export type ProfileReportFlowMeta = {
  correlationId?: string;
  userId?: string;
};

const PROFILE_REPORT_MODEL =
  process.env.OPENAI_PROFILE_REPORT_MODEL || "gpt-4o-mini";
const PROFILE_REPORT_MAX_OUTPUT_TOKENS = (() => {
  const parsed = Number(
    process.env.OPENAI_PROFILE_REPORT_MAX_OUTPUT_TOKENS || 1200
  );
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(3000, parsed) : 1200;
})();

const MAX_CONTEXT_CHARS = 14_000;
const MAX_SUBJECT_NAME_CHARS = 200;
const FALLBACK_LINE_CHARS = 240;
const MAX_SECTION_ITEMS = 12;
const MAX_SECTION_ITEM_CHARS = 400;

const profileReportPrompt = ai.definePrompt({
  name: "profileReportPrompt",
  input: { schema: ProfileReportFlowInputSchema },
  output: { format: "json" },
  prompt: `
You are Taskwise AI, generating a source-grounded status report about the {{{subjectType}}} "{{{subjectName}}}" for a busy operator.

Today's date: {{{today}}}

Your job:
- Compose the report using ONLY the workspace evidence below.
- Be concise and factual; each bullet is one clear sentence.
- Distinguish evidence from inference; never invent meetings, people, tasks, dates, decisions, or commitments.
- Only list something as completed when the evidence explicitly supports it.
- Key decisions come from meeting summaries/transcript quotes; leave the list empty when none are evidenced.
- End with the single most useful next action.

Workspace evidence (lines are labeled PERSON / MEETING / TASK; the id follows the label; transcript quotes are indented under their MEETING line with [MM:SS] timestamps):
"""
{{{contextBlocks}}}
"""

Rules for sources:
- Every source's sourceId must be an id copied exactly from the evidence above. Never invent ids.
- Use sourceType "meeting" for meeting titles/summaries, "transcript" for transcript quotes (sourceId = the meeting id the quote belongs to), "task" for TASK lines, "person" for PERSON lines typed teammate/unknown, and "client" for PERSON lines typed client.
- Include the timestamp when the quoted line has one (e.g. 12:30).

Output format — respond with a single JSON object in exactly this shape:
{
  "executiveSummary": "2-4 sentence overview of the current state of the relationship/work",
  "openCommitments": ["open task or promise, with owner and due date when known"],
  "overdueOrRisk": ["overdue or at-risk item"],
  "completedWork": ["explicitly completed item"],
  "recentMeetings": ["meeting title and date with a one-line takeaway"],
  "keyDecisions": ["decision evidenced by a summary or transcript quote"],
  "suggestedNextAction": "single next best action",
  "confidence": "low | medium | high",
  "sources": [
    {
      "sourceType": "meeting | transcript | task | person | client",
      "sourceId": "id",
      "title": "source title",
      "snippet": "short supporting quote or summary",
      "timestamp": "optional"
    }
  ]
}
`,
});

const getString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const SOURCE_TYPE_SET = new Set<string>(GENERAL_CHAT_SOURCE_TYPES);
const CONFIDENCE_SET = new Set<string>(GENERAL_CHAT_CONFIDENCE_LEVELS);

const normalizeSource = (entry: unknown): GeneralChatSource | null => {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const record = entry as Record<string, unknown>;
  const sourceTypeRaw = getString(record.sourceType)?.toLowerCase();
  const sourceId = getString(record.sourceId) || getString(record.id);
  const snippet =
    getString(record.snippet) || getString(record.quote) || getString(record.text);
  if (!sourceTypeRaw || !SOURCE_TYPE_SET.has(sourceTypeRaw) || !sourceId || !snippet) {
    return null;
  }
  return {
    sourceType: sourceTypeRaw as GeneralChatSource["sourceType"],
    sourceId,
    title: getString(record.title) || sourceId,
    snippet,
    timestamp: getString(record.timestamp) || getString(record.time),
  };
};

const normalizeStringList = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => getString(entry))
    .filter((entry): entry is string => Boolean(entry))
    .slice(0, MAX_SECTION_ITEMS)
    .map((entry) => entry.slice(0, MAX_SECTION_ITEM_CHARS));
};

const normalizeCandidate = (
  raw: unknown,
  input: ProfileReportFlowInput
): ProfileReport | null => {
  const record =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const executiveSummary =
    getString(record.executiveSummary) ||
    getString(record.summary) ||
    getString(record.answer);
  if (!executiveSummary) return null;

  const confidenceRaw = getString(record.confidence)?.toLowerCase();
  const confidence = (
    confidenceRaw && CONFIDENCE_SET.has(confidenceRaw) ? confidenceRaw : "low"
  ) as ProfileReport["confidence"];

  const sources = Array.isArray(record.sources)
    ? record.sources
        .map(normalizeSource)
        .filter((entry): entry is GeneralChatSource => Boolean(entry))
    : [];

  return {
    subjectType: input.subjectType,
    subjectName: input.subjectName,
    generatedAt: new Date().toISOString(),
    executiveSummary,
    openCommitments: normalizeStringList(record.openCommitments),
    overdueOrRisk: normalizeStringList(
      record.overdueOrRisk ?? record.overdueOrRiskItems ?? record.risks
    ),
    completedWork: normalizeStringList(record.completedWork),
    recentMeetings: normalizeStringList(record.recentMeetings),
    keyDecisions: normalizeStringList(record.keyDecisions),
    suggestedNextAction:
      getString(record.suggestedNextAction) ||
      getString(record.nextAction) ||
      "Review the open items above and pick the next follow-up.",
    confidence,
    sources,
  };
};

const parseLabeledContextLine = (
  line: string,
  label: "MEETING" | "TASK"
): { id: string; title: string } | null => {
  if (!line.startsWith(`${label} `)) return null;
  const parts = line
    .slice(label.length + 1)
    .split("|")
    .map((part) => part.trim());
  const id = parts[0];
  if (!id) return null;
  return { id, title: parts[1] || id };
};

/**
 * Deterministic report used when the LLM call fails or its JSON cannot be
 * recovered: rebuild the sections mechanically from the labeled context lines
 * (confidence low). Sources cite the first meeting/task lines so the routes'
 * id filter still holds. Exported for tests.
 */
export const buildDeterministicReport = (
  input: ProfileReportFlowInput
): ProfileReport => {
  const lines = input.contextBlocks
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const openCommitments: string[] = [];
  const overdueOrRisk: string[] = [];
  const completedWork: string[] = [];
  const recentMeetings: string[] = [];
  const sources: GeneralChatSource[] = [];

  for (const line of lines) {
    const meeting = parseLabeledContextLine(line, "MEETING");
    if (meeting) {
      if (recentMeetings.length < MAX_SECTION_ITEMS) {
        recentMeetings.push(line.slice(0, FALLBACK_LINE_CHARS));
      }
      if (!sources.some((source) => source.sourceType === "meeting")) {
        sources.push({
          sourceType: "meeting",
          sourceId: meeting.id,
          title: meeting.title,
          snippet: line.slice(0, FALLBACK_LINE_CHARS),
        });
      }
      continue;
    }
    const task = parseLabeledContextLine(line, "TASK");
    if (task) {
      const truncated = line.slice(0, FALLBACK_LINE_CHARS);
      if (line.includes("status=done")) {
        if (completedWork.length < MAX_SECTION_ITEMS) completedWork.push(truncated);
      } else if (line.includes("OVERDUE")) {
        if (overdueOrRisk.length < MAX_SECTION_ITEMS) overdueOrRisk.push(truncated);
      } else if (openCommitments.length < MAX_SECTION_ITEMS) {
        openCommitments.push(truncated);
      }
      if (!sources.some((source) => source.sourceType === "task")) {
        sources.push({
          sourceType: "task",
          sourceId: task.id,
          title: task.title,
          snippet: truncated,
        });
      }
    }
  }

  return {
    subjectType: input.subjectType,
    subjectName: input.subjectName,
    generatedAt: new Date().toISOString(),
    executiveSummary: `I couldn't generate a narrative report for ${input.subjectName} this time, so here is a mechanical digest of the recorded evidence: ${recentMeetings.length} recent meeting(s), ${openCommitments.length} open item(s), ${overdueOrRisk.length} overdue item(s), and ${completedWork.length} completed item(s).`,
    openCommitments,
    overdueOrRisk,
    completedWork,
    recentMeetings,
    keyDecisions: [],
    suggestedNextAction: overdueOrRisk.length
      ? "Follow up on the overdue items listed above."
      : "Review the open commitments and schedule the next touchpoint.",
    confidence: "low",
    sources,
  };
};

const trimFlowInput = (input: ProfileReportFlowInput): ProfileReportFlowInput => ({
  subjectType: input.subjectType,
  subjectName: input.subjectName.trim().slice(0, MAX_SUBJECT_NAME_CHARS),
  contextBlocks: input.contextBlocks.trim().slice(0, MAX_CONTEXT_CHARS),
  today: input.today.trim(),
});

const runProfileReport = async (
  input: ProfileReportFlowInput,
  meta?: ProfileReportFlowMeta
): Promise<ProfileReport> => {
  const promptInput = trimFlowInput(input);
  try {
    const { output, text } = await runPromptWithFallback(
      profileReportPrompt,
      promptInput,
      {
        config: {
          model: PROFILE_REPORT_MODEL,
          maxOutputTokens: PROFILE_REPORT_MAX_OUTPUT_TOKENS,
        },
      },
      {
        endpoint:
          promptInput.subjectType === "company"
            ? "/api/companies/[id]/report"
            : "/api/people/[id]/report",
        operation: "profileReport",
        promptName: "profileReportPrompt",
        correlationId: meta?.correlationId,
        userId: meta?.userId,
      }
    );

    const raw = extractJsonValue(output, text);
    const normalized = normalizeCandidate(raw, promptInput);
    if (normalized) {
      const parsed = ProfileReportSchema.safeParse(normalized);
      if (parsed.success) {
        return parsed.data;
      }
    }
  } catch (error) {
    console.warn(
      "[profile-report] LLM call failed, using deterministic fallback:",
      error
    );
  }

  return buildDeterministicReport(promptInput);
};

const profileReportFlow = ai.defineFlow(
  {
    name: "profileReportFlow",
    inputSchema: ProfileReportFlowInputSchema,
    outputSchema: ProfileReportSchema,
  },
  async (input: ProfileReportFlowInput): Promise<ProfileReport> =>
    runProfileReport(input)
);

/**
 * Generate a source-grounded report for a person or company profile.
 * Never throws — degrades to a deterministic low-confidence report.
 */
export async function generateProfileReport(
  input: ProfileReportFlowInput,
  meta?: ProfileReportFlowMeta
): Promise<ProfileReport> {
  if (meta) {
    // defineFlow input schemas strip unknown keys; call the runner directly so
    // correlationId/userId reach the usage context.
    return runProfileReport(input, meta);
  }
  return profileReportFlow(input);
}

export type { ProfileReportSubjectType };
