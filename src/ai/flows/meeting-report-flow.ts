// src/ai/flows/meeting-report-flow.ts
/**
 * @fileOverview Meeting report flow (Priority 13).
 *
 * Composes a source-grounded report for ONE meeting from pre-rendered,
 * deterministic context blocks (summary, decisions/key moments, extracted
 * task status, attendees, completion signals, transcript excerpts). The LLM
 * call goes through runPromptWithFallback (model override
 * OPENAI_MEETING_REPORT_MODEL, default gpt-4o-mini) and the JSON output is
 * parsed leniently; when parsing fails or the model errors, a deterministic
 * fallback report is assembled from the same blocks — this flow never throws
 * to the route.
 *
 * NOTE: deliberately NOT a 'use server' module — it must only be reachable
 * through the authenticated POST /api/meetings/[id]/report route.
 */

import { z } from "zod";
import { ai } from "@/ai/genkit";
import { runPromptWithFallback } from "@/ai/prompt-fallback";
import { extractJsonValue } from "./parse-json-output";
import {
  GeneralChatSourceSchema,
  type GeneralChatSource,
} from "@/types/general-chat";

export const MeetingReportFlowInputSchema = z.object({
  meetingId: z.string(),
  meetingTitle: z.string(),
  /** ISO date (YYYY-MM-DD) or empty string when unknown. */
  meetingDate: z.string(),
  summary: z.string().optional(),
  agenda: z.string().optional(),
  /** One decision/key moment per line. */
  decisionsBlock: z.string().optional(),
  /** One TASK line per task: `TASK <id> | <title> | status=... | ...`. */
  tasksBlock: z.string().optional(),
  /** One attendee per line. */
  attendeesBlock: z.string().optional(),
  /** Completion signals with evidence snippets, one per line. */
  completionSignalsBlock: z.string().optional(),
  /** Transcript excerpts (already reduced/capped by the route). */
  transcript: z.string().optional(),
  /** Optional user-requested emphasis for the report. */
  focus: z.string().optional(),
  today: z.string(),
});

export type MeetingReportFlowInput = z.infer<typeof MeetingReportFlowInputSchema>;

export const MeetingReportResultSchema = z.object({
  report: z.string().min(1),
  sources: z.array(GeneralChatSourceSchema),
});

export type MeetingReportResult = z.infer<typeof MeetingReportResultSchema>;

export type MeetingReportFlowMeta = {
  correlationId?: string;
  userId?: string;
};

const MEETING_REPORT_MODEL =
  process.env.OPENAI_MEETING_REPORT_MODEL || "gpt-4o-mini";
const MEETING_REPORT_MAX_OUTPUT_TOKENS = (() => {
  const parsed = Number(
    process.env.OPENAI_MEETING_REPORT_MAX_OUTPUT_TOKENS || 1200
  );
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(3000, parsed) : 1200;
})();

// Defensive caps — the route already trims its blocks, these only guard
// against a caller accidentally passing oversized input.
const MAX_BLOCK_CHARS = 6_000;
const MAX_TRANSCRIPT_CHARS = 16_000;
const FALLBACK_SNIPPET_CHARS = 300;

const meetingReportPrompt = ai.definePrompt({
  name: "meetingReportPrompt",
  input: { schema: MeetingReportFlowInputSchema },
  output: { format: "json" },
  prompt: `
You are Taskwise AI. Write a concise, source-grounded report for ONE meeting, using ONLY the meeting data below.

Today's date: {{{today}}}

Meeting: "{{{meetingTitle}}}" (meeting id: {{{meetingId}}}{{#if meetingDate}}, date: {{{meetingDate}}}{{/if}})

{{#if agenda}}
Agenda:
"""
{{{agenda}}}
"""
{{/if}}

{{#if summary}}
Meeting summary:
"""
{{{summary}}}
"""
{{/if}}

{{#if decisionsBlock}}
Decisions / key moments:
"""
{{{decisionsBlock}}}
"""
{{/if}}

{{#if tasksBlock}}
Extracted tasks (lines are labeled TASK; the task id follows the label):
"""
{{{tasksBlock}}}
"""
{{/if}}

{{#if completionSignalsBlock}}
Completion signals (tasks that appear already done, with transcript evidence):
"""
{{{completionSignalsBlock}}}
"""
{{/if}}

{{#if attendeesBlock}}
Attendees:
"""
{{{attendeesBlock}}}
"""
{{/if}}

{{#if transcript}}
Transcript excerpts:
"""
{{{transcript}}}
"""
{{/if}}

{{#if focus}}
Requested emphasis from the user: "{{{focus}}}"
{{/if}}

Your instructions:
1. Write a Markdown report with these sections (omit a section when there is no data for it): "## Overview", "## Decisions", "## Action items", "## Completion signals", "## Attendees", "## Risks & open questions".
2. Ground every statement in the data above. Do not invent attendees, tasks, dates, decisions, or commitments.
3. In "## Action items" reflect each task's current status (todo / in progress / done) and owner when known.
4. Quote short transcript snippets as evidence where they support a decision or completion signal.
5. If the data is thin, say so plainly instead of padding the report.

Rules for sources:
- Every source's sourceId must be copied exactly from the data above: use "{{{meetingId}}}" for sourceType "meeting" or "transcript", and a TASK line id for sourceType "task". Never invent ids.
- Include the timestamp when a quoted transcript line has one (e.g. 12:30).

Output format — respond with a single JSON object in exactly this shape:
{
  "report": "the full Markdown report",
  "sources": [
    {
      "sourceType": "meeting | transcript | task",
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

const REPORT_SOURCE_TYPES = new Set(["meeting", "transcript", "task"]);

const normalizeSource = (entry: unknown): GeneralChatSource | null => {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const record = entry as Record<string, unknown>;
  const sourceTypeRaw = getString(record.sourceType)?.toLowerCase();
  const sourceId = getString(record.sourceId) || getString(record.id);
  const snippet =
    getString(record.snippet) || getString(record.quote) || getString(record.text);
  if (
    !sourceTypeRaw ||
    !REPORT_SOURCE_TYPES.has(sourceTypeRaw) ||
    !sourceId ||
    !snippet
  ) {
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

const normalizeCandidate = (
  raw: unknown,
  text: string | undefined
): MeetingReportResult | null => {
  const record =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const report =
    getString(record.report) ||
    getString(record.markdown) ||
    getString(record.answer) ||
    getString(text);
  if (!report) return null;

  const sources = Array.isArray(record.sources)
    ? record.sources
        .map(normalizeSource)
        .filter((entry): entry is GeneralChatSource => Boolean(entry))
    : [];

  return { report, sources };
};

const trimBlock = (value: string | undefined, max = MAX_BLOCK_CHARS) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
};

const trimFlowInput = (input: MeetingReportFlowInput): MeetingReportFlowInput => ({
  meetingId: input.meetingId.trim(),
  meetingTitle: input.meetingTitle.trim().slice(0, 300),
  meetingDate: input.meetingDate.trim().slice(0, 10),
  summary: trimBlock(input.summary),
  agenda: trimBlock(input.agenda),
  decisionsBlock: trimBlock(input.decisionsBlock),
  tasksBlock: trimBlock(input.tasksBlock),
  attendeesBlock: trimBlock(input.attendeesBlock),
  completionSignalsBlock: trimBlock(input.completionSignalsBlock),
  transcript: trimBlock(input.transcript, MAX_TRANSCRIPT_CHARS),
  focus: trimBlock(input.focus, 500),
  today: input.today.trim(),
});

const appendSection = (
  parts: string[],
  heading: string,
  block: string | undefined
) => {
  if (!block) return;
  parts.push(`## ${heading}`, block, "");
};

/**
 * Deterministic report used when the LLM call fails or its JSON cannot be
 * recovered: assemble the structured blocks verbatim and cite the meeting
 * itself so the route's id filter still holds. Exported for the route's
 * no-transcript/no-summary deterministic path.
 */
export const buildDeterministicReport = (
  input: MeetingReportFlowInput
): MeetingReportResult => {
  const parts: string[] = [
    `# Meeting report: ${input.meetingTitle || input.meetingId}`,
    "",
  ];
  if (input.meetingDate) {
    parts.push(`Date: ${input.meetingDate}`, "");
  }
  appendSection(parts, "Agenda", input.agenda);
  appendSection(parts, "Overview", input.summary);
  appendSection(parts, "Decisions", input.decisionsBlock);
  appendSection(parts, "Action items", input.tasksBlock);
  appendSection(parts, "Completion signals", input.completionSignalsBlock);
  appendSection(parts, "Attendees", input.attendeesBlock);

  const sources: GeneralChatSource[] = [];
  const evidence = input.summary?.trim() || input.transcript?.trim();
  if (evidence) {
    sources.push({
      sourceType: input.summary?.trim() ? "meeting" : "transcript",
      sourceId: input.meetingId,
      title: input.meetingTitle || input.meetingId,
      snippet: evidence
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)[0]
        ?.slice(0, FALLBACK_SNIPPET_CHARS) || evidence.slice(0, FALLBACK_SNIPPET_CHARS),
    });
  }

  return {
    report: parts.join("\n").trim(),
    sources,
  };
};

const runMeetingReport = async (
  input: MeetingReportFlowInput,
  meta?: MeetingReportFlowMeta
): Promise<MeetingReportResult> => {
  const promptInput = trimFlowInput(input);
  try {
    const { output, text } = await runPromptWithFallback(
      meetingReportPrompt,
      promptInput,
      {
        config: {
          model: MEETING_REPORT_MODEL,
          maxOutputTokens: MEETING_REPORT_MAX_OUTPUT_TOKENS,
        },
      },
      {
        endpoint: "/api/meetings/[id]/report",
        operation: "meetingReport",
        promptName: "meetingReportPrompt",
        correlationId: meta?.correlationId,
        userId: meta?.userId,
      }
    );

    const raw = extractJsonValue(output, text);
    const parsed = MeetingReportResultSchema.safeParse(raw);
    if (parsed.success) {
      return parsed.data;
    }

    const normalized = normalizeCandidate(raw, text);
    if (normalized) {
      const reparsed = MeetingReportResultSchema.safeParse(normalized);
      if (reparsed.success) {
        return reparsed.data;
      }
    }
  } catch (error) {
    console.warn(
      "[meeting-report] LLM call failed, using deterministic fallback:",
      error
    );
  }

  return buildDeterministicReport(promptInput);
};

const meetingReportFlow = ai.defineFlow(
  {
    name: "meetingReportFlow",
    inputSchema: MeetingReportFlowInputSchema,
    outputSchema: MeetingReportResultSchema,
  },
  async (input: MeetingReportFlowInput): Promise<MeetingReportResult> =>
    runMeetingReport(input)
);

/**
 * Generate a source-grounded meeting report. Never throws — degrades to a
 * deterministic report assembled from the structured input blocks.
 */
export async function generateMeetingReport(
  input: MeetingReportFlowInput,
  meta?: MeetingReportFlowMeta
): Promise<MeetingReportResult> {
  if (meta) {
    // defineFlow input schemas strip unknown keys; call the runner directly so
    // correlationId/userId reach the usage context.
    return runMeetingReport(input, meta);
  }
  return meetingReportFlow(input);
}
