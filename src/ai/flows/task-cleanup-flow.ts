// src/ai/flows/task-cleanup-flow.ts
/**
 * @fileOverview Taskwise Task Quality Auditor (Phase 3 task cleanup).
 *
 * Classifies extracted tasks into keep / vanity / stale / duplicate /
 * completed_suggested / needs_more_info, extending the completed-task
 * auditor pattern (detect-completed-tasks-flow.ts). Adapted from the
 * <runtime_prompt_task_cleanup> system prompt in taskwise.md.
 *
 * The call goes through runPromptWithFallback (model override
 * TASK_CLEANUP_MODEL || COMPLETION_AUDIT_MODEL, default gpt-4o-mini) and the
 * JSON output is parsed leniently. On any failure this flow returns
 * { items: [] } — it never throws to the caller.
 *
 * NOTE: deliberately NOT a 'use server' module — only reachable through the
 * authenticated cleanup scan path, never as a client-callable server action.
 */

import { z } from "zod";
import { ai } from "@/ai/genkit";
import { runPromptWithFallback } from "@/ai/prompt-fallback";
import { extractJsonValue } from "./parse-json-output";

const MAX_AUDIT_TASKS = 30;
const MAX_WORKSPACE_TITLES = 60;
const MAX_DESCRIPTION_CHARS = 200;
const MAX_TRANSCRIPT_SNIPPET_CHARS = 300;

export const TASK_CLEANUP_CLASSIFICATIONS = [
  "keep",
  "vanity",
  "stale",
  "duplicate",
  "completed_suggested",
  "needs_more_info",
] as const;

export const TASK_CLEANUP_SUGGESTED_ACTIONS = [
  "keep",
  "expire",
  "suggest_duplicate",
  "suggest_completed",
  "ask_user",
] as const;

const TaskCleanupEvidenceSchema = z.object({
  sourceType: z.enum(["task", "transcript", "meeting"]),
  sourceId: z.string(),
  snippet: z.string(),
});

export const TaskCleanupAuditItemSchema = z.object({
  taskId: z.string(),
  classification: z.enum(TASK_CLEANUP_CLASSIFICATIONS),
  confidence: z.number().min(0).max(1).default(0),
  reason: z.string().default(""),
  evidence: z.array(TaskCleanupEvidenceSchema).default([]),
  suggestedAction: z.enum(TASK_CLEANUP_SUGGESTED_ACTIONS).optional(),
  expiresAt: z.string().nullable().optional(),
  duplicateOfTaskId: z.string().nullable().optional(),
});

export const TaskCleanupAuditOutputSchema = z.object({
  items: z.array(TaskCleanupAuditItemSchema).default([]),
});

export type TaskCleanupAuditItem = z.infer<typeof TaskCleanupAuditItemSchema>;
export type TaskCleanupAuditOutput = z.infer<typeof TaskCleanupAuditOutputSchema>;

export interface TaskCleanupAuditTaskInput {
  taskId: string;
  title: string;
  description?: string | null;
  assignee?: string | null;
  dueAt?: string | null;
  meetingDate?: string | null;
  meetingTitle?: string | null;
  transcriptSnippet?: string | null;
}

export interface TaskCleanupAuditInput {
  tasks: TaskCleanupAuditTaskInput[];
  /** Compact list of other open workspace tasks for duplicate awareness. */
  workspaceTaskTitles: Array<{ taskId: string; title: string }>;
  /** ISO date for "today" so stale reasoning is deterministic. */
  today: string;
}

export type TaskCleanupAuditMeta = {
  correlationId?: string;
  userId?: string;
};

const TaskCleanupPromptInputSchema = z.object({
  tasksJson: z.string(),
  workspaceTaskTitlesJson: z.string(),
  today: z.string(),
});

const TASK_CLEANUP_MODEL =
  process.env.TASK_CLEANUP_MODEL ||
  process.env.COMPLETION_AUDIT_MODEL ||
  "gpt-4o-mini";
const TASK_CLEANUP_MAX_TOKENS = Math.min(
  2000,
  Math.max(300, Number(process.env.TASK_CLEANUP_MAX_TOKENS || 900))
);

// Adapted from taskwise.md <runtime_prompt_task_cleanup>.
const taskCleanupAuditorPrompt = ai.definePrompt({
  name: "taskCleanupAuditorPrompt",
  input: { schema: TaskCleanupPromptInputSchema },
  output: { format: "json" },
  prompt: `
You are Taskwise Task Quality Auditor.

Your job is to classify extracted tasks into useful work, vanity/admin work, duplicate work, stale work, or already-completed work.

Be conservative. Do not remove meaningful work just because it is small.

Today's date: {{{today}}}

Classify each task using:
- task title
- task description
- assignee
- due date
- meeting date
- source meeting title
- source transcript snippets
- existing workspace tasks

Categories:
- keep: meaningful future work
- vanity: low-value logistics/admin task likely not worth tracking
- stale: task was time-sensitive and is now irrelevant
- duplicate: task appears to already exist
- completed_suggested: transcript or task history indicates it is done
- needs_more_info: too vague to safely classify

Rules:
- Never mark client commitments as vanity unless clearly irrelevant.
- Never mark legal, finance, security, compliance, or customer-facing commitments as vanity.
- Never mark a task with a future due date and an assignee as vanity or stale.
- Never mark a task whose title suggests a deliverable (build/create/write/design/implement/fix/ship/deliver) as vanity.
- Never mark a task completed without evidence — every completed_suggested item MUST include at least one evidence entry quoting the transcript or task history.
- Only classify tasks from the provided list. Do NOT invent taskIds.
- duplicateOfTaskId must be a taskId copied exactly from the existing workspace tasks list (or the audited tasks list). Never invent ids.
- Prefer "needs_more_info" over a risky cleanup.
- Give short, human-readable reasons.
- Give an expiry suggestion only when time relevance is clear.
- Return valid JSON only.

Tasks to audit (JSON lines):
\`\`\`
{{{tasksJson}}}
\`\`\`

Existing workspace tasks (for duplicate awareness):
\`\`\`
{{{workspaceTaskTitlesJson}}}
\`\`\`

Output:
{
  "items": [
    {
      "taskId": "id",
      "classification": "keep | vanity | stale | duplicate | completed_suggested | needs_more_info",
      "confidence": 0.0,
      "reason": "short explanation",
      "evidence": [
        {
          "sourceType": "task | transcript | meeting",
          "sourceId": "id",
          "snippet": "short evidence"
        }
      ],
      "suggestedAction": "keep | expire | suggest_duplicate | suggest_completed | ask_user",
      "expiresAt": "ISO date or null",
      "duplicateOfTaskId": "id or null"
    }
  ]
}
`,
});

const trimString = (value: unknown, maxChars: number): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > maxChars ? `${trimmed.slice(0, maxChars)}…` : trimmed;
};

const buildTaskLine = (task: TaskCleanupAuditTaskInput) => ({
  taskId: task.taskId,
  title: trimString(task.title, 200) || "",
  description: trimString(task.description, MAX_DESCRIPTION_CHARS),
  assignee: trimString(task.assignee, 80),
  dueAt: trimString(task.dueAt, 40),
  meetingDate: trimString(task.meetingDate, 40),
  meetingTitle: trimString(task.meetingTitle, 120),
  transcriptSnippet: trimString(task.transcriptSnippet, MAX_TRANSCRIPT_SNIPPET_CHARS),
});

const CLASSIFICATION_SET = new Set<string>(TASK_CLEANUP_CLASSIFICATIONS);
const SUGGESTED_ACTION_SET = new Set<string>(TASK_CLEANUP_SUGGESTED_ACTIONS);
const EVIDENCE_SOURCE_TYPES = new Set(["task", "transcript", "meeting"]);

const getString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const normalizeEvidenceEntry = (entry: unknown) => {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const record = entry as Record<string, unknown>;
  const sourceTypeRaw = getString(record.sourceType)?.toLowerCase();
  const sourceId = getString(record.sourceId) || getString(record.id);
  const snippet =
    getString(record.snippet) || getString(record.quote) || getString(record.text);
  if (!sourceTypeRaw || !EVIDENCE_SOURCE_TYPES.has(sourceTypeRaw) || !sourceId || !snippet) {
    return null;
  }
  return {
    sourceType: sourceTypeRaw as "task" | "transcript" | "meeting",
    sourceId,
    snippet: snippet.slice(0, MAX_TRANSCRIPT_SNIPPET_CHARS),
  };
};

/** Lenient item normalization used when strict schema parsing fails. */
const normalizeAuditItem = (entry: unknown): TaskCleanupAuditItem | null => {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const record = entry as Record<string, unknown>;
  const taskId = getString(record.taskId) || getString(record.id);
  const classificationRaw =
    getString(record.classification)?.toLowerCase() ||
    getString(record.category)?.toLowerCase();
  if (!taskId || !classificationRaw || !CLASSIFICATION_SET.has(classificationRaw)) {
    return null;
  }
  const confidenceRaw = Number(record.confidence);
  const confidence = Number.isFinite(confidenceRaw)
    ? Math.min(1, Math.max(0, confidenceRaw))
    : 0;
  const evidence = Array.isArray(record.evidence)
    ? record.evidence
        .map(normalizeEvidenceEntry)
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
    : [];
  const suggestedActionRaw = getString(record.suggestedAction)?.toLowerCase();
  return {
    taskId,
    classification: classificationRaw as TaskCleanupAuditItem["classification"],
    confidence,
    reason: getString(record.reason) || "",
    evidence,
    suggestedAction:
      suggestedActionRaw && SUGGESTED_ACTION_SET.has(suggestedActionRaw)
        ? (suggestedActionRaw as TaskCleanupAuditItem["suggestedAction"])
        : undefined,
    expiresAt: getString(record.expiresAt) || null,
    duplicateOfTaskId: getString(record.duplicateOfTaskId) || null,
  };
};

const normalizeAuditOutput = (raw: unknown): TaskCleanupAuditOutput => {
  const strict = TaskCleanupAuditOutputSchema.safeParse(raw);
  if (strict.success) return strict.data;

  const record =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const rawItems = Array.isArray(record.items)
    ? record.items
    : Array.isArray(raw)
      ? (raw as unknown[])
      : [];
  const items = rawItems
    .map(normalizeAuditItem)
    .filter((item): item is TaskCleanupAuditItem => Boolean(item));
  return { items };
};

/**
 * Audit a batch of tasks for cleanup. Caps input at 30 tasks / 60 workspace
 * titles, trims descriptions and transcript snippets, and never throws — any
 * model or parsing failure yields { items: [] }.
 */
export async function auditTasksForCleanup(
  input: TaskCleanupAuditInput,
  meta?: TaskCleanupAuditMeta
): Promise<TaskCleanupAuditOutput> {
  const tasks = (input.tasks || []).slice(0, MAX_AUDIT_TASKS).map(buildTaskLine);
  if (!tasks.length) {
    return { items: [] };
  }
  const workspaceTaskTitles = (input.workspaceTaskTitles || [])
    .slice(0, MAX_WORKSPACE_TITLES)
    .map((entry) => ({
      taskId: entry.taskId,
      title: trimString(entry.title, 140) || "",
    }));

  const promptInput = {
    tasksJson: tasks.map((task) => JSON.stringify(task)).join("\n"),
    workspaceTaskTitlesJson: workspaceTaskTitles
      .map((entry) => JSON.stringify(entry))
      .join("\n"),
    today: input.today,
  };

  try {
    const { output, text } = await runPromptWithFallback(
      taskCleanupAuditorPrompt,
      promptInput,
      {
        config: {
          model: TASK_CLEANUP_MODEL,
          maxOutputTokens: TASK_CLEANUP_MAX_TOKENS,
        },
      },
      {
        endpoint: "/api/tasks/cleanup/scan",
        operation: `taskCount=${tasks.length};workspaceTitles=${workspaceTaskTitles.length}`,
        promptName: "taskCleanupAuditorPrompt",
        correlationId: meta?.correlationId,
        userId: meta?.userId,
      }
    );
    const raw = extractJsonValue(output, text);
    const normalized = normalizeAuditOutput(raw);
    // Only keep verdicts for tasks we actually asked about.
    const auditedIds = new Set(tasks.map((task) => task.taskId));
    return {
      items: normalized.items.filter((item) => auditedIds.has(item.taskId)),
    };
  } catch (error) {
    console.warn("[task-cleanup] auditor call failed, returning no items:", error);
    return { items: [] };
  }
}
