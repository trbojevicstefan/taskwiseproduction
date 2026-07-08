// src/lib/task-cleanup.ts
/**
 * Phase 3 task cleanup scan runner.
 *
 * Heuristics-first pipeline over the workspace's open tasks:
 *  1. auto-transition overdue suggested_expire tasks to expired,
 *  2. classify every eligible task with the pure heuristics
 *     (src/lib/task-cleanup-heuristics.ts) — protected classes are skipped,
 *  3. send only ambiguous / stale / duplicate candidates to the LLM auditor
 *     (src/ai/flows/task-cleanup-flow.ts, capped at 30 tasks per scan),
 *  4. apply strictness + category gates, then bulk-write cleanup fields ONLY
 *     where the existing cleanupStatus is absent or 'active' — reviewed
 *     (dismissed/expired/…) docs are never overwritten.
 *
 * Nothing is ever deleted; every state this writes is reversible via the
 * cleanup 'restore' action.
 */

import type { Db } from "mongodb";
import type { TaskCleanupCategory, TaskCleanupEvidence } from "@/types/chat";
import type { TaskCleanupSettings } from "@/lib/workspace-settings";
import {
  classifyTaskHeuristic,
  normalizeTitleKey,
  type HeuristicResult,
} from "@/lib/task-cleanup-heuristics";
import {
  auditTasksForCleanup,
  type TaskCleanupAuditItem,
  type TaskCleanupAuditTaskInput,
} from "@/ai/flows/task-cleanup-flow";

export interface TaskCleanupScanScope {
  userId: string;
  workspaceId?: string | null;
  memberUserIds?: string[];
}

export interface TaskCleanupScanResult {
  scanned: number;
  flagged: number;
  expired: number;
  byCategory: Record<string, number>;
}

const MAX_SCAN_TASKS = 500;
const MAX_LLM_TASKS = 30;
const MAX_TRANSCRIPT_MEETINGS = 10;
const MAX_MEETING_META_IDS = 200;
const MAX_WORKSPACE_TITLES = 60;
const MAX_SNIPPET_CHARS = 300;
const DAY_MS = 24 * 60 * 60 * 1000;

const SCAN_TASK_PROJECTION = {
  _id: 1,
  title: 1,
  description: 1,
  status: 1,
  dueAt: 1,
  assignee: 1,
  assigneeName: 1,
  createdAt: 1,
  sourceSessionId: 1,
  sourceSessionType: 1,
  sourceSessionName: 1,
  taskState: 1,
  cleanupStatus: 1,
} as const;

/**
 * Same fallback semantics the workspace-scoped list routes use: docs tagged
 * with the workspace id, plus legacy docs without a workspaceId that belong
 * to a workspace member. Without a workspaceId, scope by user ids only.
 */
const buildScopeFilter = (scope: TaskCleanupScanScope): Record<string, any> => {
  const memberUserIds =
    Array.isArray(scope.memberUserIds) && scope.memberUserIds.length
      ? scope.memberUserIds
      : [scope.userId];
  if (scope.workspaceId) {
    return {
      $or: [
        { workspaceId: scope.workspaceId },
        {
          workspaceId: { $exists: false },
          userId: { $in: memberUserIds },
        },
      ],
    };
  }
  return { userId: { $in: memberUserIds } };
};

/** Scan writes may only touch docs whose cleanup state is absent or 'active'. */
const UNREVIEWED_CLEANUP_FILTER = {
  $or: [
    { cleanupStatus: { $exists: false } },
    { cleanupStatus: null },
    { cleanupStatus: "active" },
  ],
};

const isEligibleForScan = (task: any): boolean =>
  task.cleanupStatus === undefined ||
  task.cleanupStatus === null ||
  task.cleanupStatus === "active";

const toDate = (value: unknown): Date | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
};

const toIsoString = (value: unknown): string | null => {
  const date = toDate(value);
  return date ? date.toISOString() : null;
};

const resolveAssigneePersonId = (task: any): string | null => {
  const raw = task?.assignee;
  const direct = raw?.uid || raw?.id;
  return direct ? String(direct) : null;
};

/**
 * Extract up to two transcript lines mentioning significant title words —
 * targeted evidence for the LLM's completed-task detection.
 */
const extractTranscriptSnippet = (
  transcript: unknown,
  title: string
): string | null => {
  if (typeof transcript !== "string" || !transcript.trim()) return null;
  const words = normalizeTitleKey(title)
    .split(" ")
    .filter((word) => word.length > 3);
  if (!words.length) return null;
  const lines = transcript
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const matches: string[] = [];
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (words.some((word) => lower.includes(word))) {
      matches.push(line);
      if (matches.length >= 2) break;
    }
  }
  if (!matches.length) return null;
  return matches.join(" … ").slice(0, MAX_SNIPPET_CHARS);
};

type FlagKind = "vanity" | "stale" | "duplicate" | "low_specificity" | "completed";

interface PendingFlag {
  taskId: string;
  kind: FlagKind;
  cleanupStatus: "suggested_expire" | "duplicate_suggested" | "completed_suggested";
  category: TaskCleanupCategory;
  confidence: number;
  reason: string;
  evidence: TaskCleanupEvidence[] | null;
  expiresAt: string | null;
  duplicateOfTaskId: string | null;
}

const passesStrictnessGate = (
  flag: PendingFlag,
  strictness: TaskCleanupSettings["strictness"]
): boolean => {
  switch (flag.kind) {
    case "completed":
      // LLM-confirmed completions (evidence-backed) are allowed at every level.
      return true;
    case "vanity":
      if (strictness === "aggressive") return flag.confidence >= 0.6;
      return flag.confidence >= 0.85;
    case "duplicate":
    case "stale":
      if (strictness === "light") return false;
      if (strictness === "aggressive") return flag.confidence >= 0.6;
      return flag.confidence >= 0.7;
    case "low_specificity":
      return strictness === "aggressive" && flag.confidence >= 0.6;
    default:
      return false;
  }
};

const staleCategory = (
  heuristic: HeuristicResult | undefined
): TaskCleanupCategory =>
  heuristic?.category === "expired_event" ? "expired_event" : "stale_follow_up";

const vanityCategory = (
  heuristic: HeuristicResult | undefined
): TaskCleanupCategory =>
  heuristic?.category === "meeting_logistics"
    ? "meeting_logistics"
    : "scheduling_admin";

export const runTaskCleanupScan = async (
  db: Db,
  scope: TaskCleanupScanScope,
  settings: TaskCleanupSettings
): Promise<TaskCleanupScanResult> => {
  const emptyResult: TaskCleanupScanResult = {
    scanned: 0,
    flagged: 0,
    expired: 0,
    byCategory: {},
  };
  if (!settings.enabled) {
    return emptyResult;
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const scopeFilter = buildScopeFilter(scope);
  const tasksCollection = db.collection("tasks");

  // 1. Auto-transition suggested_expire -> expired where the window elapsed.
  const expiryResult = await tasksCollection.updateMany(
    {
      ...scopeFilter,
      cleanupStatus: "suggested_expire",
      expiresAt: { $ne: null, $lte: nowIso },
    },
    { $set: { cleanupStatus: "expired", lastUpdated: now } }
  );
  const expired = expiryResult?.modifiedCount || 0;

  // 2. Load the open-task scan window (newest first, capped).
  const tasks: any[] = await tasksCollection
    .find(
      {
        ...scopeFilter,
        status: { $ne: "done" },
        taskState: { $ne: "archived" },
      },
      { projection: SCAN_TASK_PROJECTION }
    )
    .sort({ createdAt: -1, _id: -1 })
    .limit(MAX_SCAN_TASKS)
    .toArray();

  const eligibleTasks = tasks.filter(isEligibleForScan);
  if (!eligibleTasks.length) {
    return { ...emptyResult, expired };
  }

  // Sibling title-key map for duplicate detection — the oldest task claims a
  // key, newer tasks with the same normalized title become duplicate candidates.
  const keyOwners = new Map<string, { taskId: string; createdAtMs: number }>();
  const titleById = new Map<string, string>();
  for (const task of tasks) {
    const taskId = String(task._id);
    titleById.set(taskId, task.title || "");
    const key = normalizeTitleKey(task.title);
    if (!key) continue;
    const createdAtMs = toDate(task.createdAt)?.getTime() ?? Number.POSITIVE_INFINITY;
    const existing = keyOwners.get(key);
    if (!existing || createdAtMs < existing.createdAtMs) {
      keyOwners.set(key, { taskId, createdAtMs });
    }
  }
  const siblingTitleKeys = new Map<string, string>();
  keyOwners.forEach((owner, key) => siblingTitleKeys.set(key, owner.taskId));

  // Client-person ids (protected assignees) — cheap _id-only fetch.
  const clientAssigneeIds = new Set<string>();
  try {
    const clientPeople: any[] = await db
      .collection("people")
      .find(
        { ...buildScopeFilter(scope), personType: "client" },
        { projection: { _id: 1 } }
      )
      .toArray();
    clientPeople.forEach((person) => clientAssigneeIds.add(String(person._id)));
  } catch (error) {
    console.warn("[task-cleanup] failed to load client people, continuing:", error);
  }

  // Cheap meeting metadata (title + startTime) for stale heuristics.
  const meetingMetaById = new Map<string, { title: string; startTime: string | null }>();
  const meetingIds = Array.from(
    new Set(
      eligibleTasks
        .filter(
          (task) => task.sourceSessionType === "meeting" && task.sourceSessionId
        )
        .map((task) => String(task.sourceSessionId))
    )
  ).slice(0, MAX_MEETING_META_IDS);
  if (meetingIds.length) {
    try {
      const meetingDocs: any[] = await db
        .collection("meetings")
        .find(
          { _id: { $in: meetingIds } } as any,
          { projection: { _id: 1, title: 1, startTime: 1 } }
        )
        .toArray();
      meetingDocs.forEach((doc) => {
        meetingMetaById.set(String(doc._id), {
          title: typeof doc.title === "string" ? doc.title : "",
          startTime: toIsoString(doc.startTime),
        });
      });
    } catch (error) {
      console.warn("[task-cleanup] failed to load meeting metadata, continuing:", error);
    }
  }

  // 3. Heuristics pass.
  const heuristicById = new Map<string, HeuristicResult>();
  const llmCandidates: any[] = [];
  for (const task of eligibleTasks) {
    const taskId = String(task._id);
    const meetingMeta =
      task.sourceSessionType === "meeting" && task.sourceSessionId
        ? meetingMetaById.get(String(task.sourceSessionId))
        : undefined;
    const heuristic = classifyTaskHeuristic(
      {
        id: taskId,
        title: task.title || "",
        description: task.description || null,
        dueAt: task.dueAt ?? null,
        assigneeName: task.assigneeName ?? null,
        assigneePersonId: resolveAssigneePersonId(task),
        status: task.status ?? null,
        createdAt: task.createdAt ?? null,
        sourceSessionType: task.sourceSessionType ?? null,
        meetingStartTime: meetingMeta?.startTime ?? null,
      },
      {
        now,
        siblingTitleKeys,
        clientAssigneeIds,
        autoExpireDays: settings.autoExpireDays,
      }
    );
    heuristicById.set(taskId, heuristic);
    if (
      heuristic.verdict === "ambiguous" ||
      heuristic.verdict === "stale" ||
      heuristic.verdict === "duplicate"
    ) {
      llmCandidates.push(task);
    }
  }

  // 4. LLM audit for candidates needing confirmation/evidence (cap 30).
  const llmBatch = llmCandidates.slice(0, MAX_LLM_TASKS);
  const llmSentIds = new Set(llmBatch.map((task) => String(task._id)));
  const llmItemsById = new Map<string, TaskCleanupAuditItem>();
  if (llmBatch.length) {
    // Targeted transcript fetch (max 10 meetings) for completed detection.
    const transcriptById = new Map<string, string>();
    const transcriptMeetingIds = Array.from(
      new Set(
        llmBatch
          .filter(
            (task) => task.sourceSessionType === "meeting" && task.sourceSessionId
          )
          .map((task) => String(task.sourceSessionId))
      )
    ).slice(0, MAX_TRANSCRIPT_MEETINGS);
    if (transcriptMeetingIds.length) {
      try {
        const transcriptDocs: any[] = await db
          .collection("meetings")
          .find(
            { _id: { $in: transcriptMeetingIds } } as any,
            { projection: { _id: 1, originalTranscript: 1 } }
          )
          .toArray();
        transcriptDocs.forEach((doc) => {
          if (typeof doc.originalTranscript === "string") {
            transcriptById.set(String(doc._id), doc.originalTranscript);
          }
        });
      } catch (error) {
        console.warn("[task-cleanup] failed to load transcripts, continuing:", error);
      }
    }

    const auditTasks: TaskCleanupAuditTaskInput[] = llmBatch.map((task) => {
      const taskId = String(task._id);
      const sessionId = task.sourceSessionId ? String(task.sourceSessionId) : null;
      const meetingMeta = sessionId ? meetingMetaById.get(sessionId) : undefined;
      const transcript = sessionId ? transcriptById.get(sessionId) : undefined;
      return {
        taskId,
        title: task.title || "",
        description: task.description || null,
        assignee: task.assigneeName || task.assignee?.name || null,
        dueAt: toIsoString(task.dueAt),
        meetingDate: meetingMeta?.startTime ?? null,
        meetingTitle: meetingMeta?.title || task.sourceSessionName || null,
        transcriptSnippet: transcript
          ? extractTranscriptSnippet(transcript, task.title || "")
          : null,
      };
    });
    const workspaceTaskTitles = tasks
      .filter((task) => !llmSentIds.has(String(task._id)))
      .slice(0, MAX_WORKSPACE_TITLES)
      .map((task) => ({ taskId: String(task._id), title: task.title || "" }));

    const auditOutput = await auditTasksForCleanup(
      {
        tasks: auditTasks,
        workspaceTaskTitles,
        today: nowIso.slice(0, 10),
      },
      { userId: scope.userId }
    );
    auditOutput.items.forEach((item) => {
      llmItemsById.set(item.taskId, item);
    });
  }

  // 5. Merge heuristic + LLM verdicts into pending flags.
  const expiresAtForNewFlags = new Date(
    now.getTime() + settings.autoExpireDays * DAY_MS
  ).toISOString();
  const pendingFlags: PendingFlag[] = [];

  for (const task of eligibleTasks) {
    const taskId = String(task._id);
    const heuristic = heuristicById.get(taskId);
    const llmItem = llmSentIds.has(taskId) ? llmItemsById.get(taskId) : undefined;

    let flag: PendingFlag | null = null;

    if (llmItem) {
      // The LLM verdict overrides the heuristic for audited tasks —
      // keep/needs_more_info explicitly cancels any heuristic flag.
      switch (llmItem.classification) {
        case "vanity":
          flag = {
            taskId,
            kind: "vanity",
            cleanupStatus: "suggested_expire",
            category: vanityCategory(heuristic),
            confidence: llmItem.confidence,
            reason: llmItem.reason || heuristic?.reason || "Low-value logistics task.",
            evidence: llmItem.evidence.length ? llmItem.evidence : null,
            expiresAt: expiresAtForNewFlags,
            duplicateOfTaskId: null,
          };
          break;
        case "stale":
          flag = {
            taskId,
            kind: "stale",
            cleanupStatus: "suggested_expire",
            category: staleCategory(heuristic),
            confidence: llmItem.confidence,
            reason: llmItem.reason || heuristic?.reason || "Task is no longer time-relevant.",
            evidence: llmItem.evidence.length ? llmItem.evidence : null,
            expiresAt: expiresAtForNewFlags,
            duplicateOfTaskId: null,
          };
          break;
        case "duplicate": {
          const duplicateOfTaskId =
            llmItem.duplicateOfTaskId || heuristic?.duplicateOfTaskId || null;
          if (duplicateOfTaskId && duplicateOfTaskId !== taskId) {
            flag = {
              taskId,
              kind: "duplicate",
              cleanupStatus: "duplicate_suggested",
              category: "duplicate",
              confidence: llmItem.confidence,
              reason: llmItem.reason || heuristic?.reason || "Duplicate of an existing task.",
              evidence: llmItem.evidence.length
                ? llmItem.evidence
                : [
                    {
                      sourceType: "task",
                      sourceId: duplicateOfTaskId,
                      snippet: titleById.get(duplicateOfTaskId) || "Existing task",
                    },
                  ],
              expiresAt: null,
              duplicateOfTaskId,
            };
          }
          break;
        }
        case "completed_suggested":
          // Evidence is REQUIRED for completed suggestions — downgrade to no-op.
          if (llmItem.evidence.length >= 1) {
            flag = {
              taskId,
              kind: "completed",
              cleanupStatus: "completed_suggested",
              category: "already_completed",
              confidence: llmItem.confidence,
              reason: llmItem.reason || "Transcript indicates this task is already done.",
              evidence: llmItem.evidence,
              expiresAt: null,
              duplicateOfTaskId: null,
            };
          }
          break;
        case "keep":
        case "needs_more_info":
        default:
          flag = null;
          break;
      }
    } else if (heuristic) {
      switch (heuristic.verdict) {
        case "vanity":
          flag = {
            taskId,
            kind: "vanity",
            cleanupStatus: "suggested_expire",
            category: vanityCategory(heuristic),
            confidence: heuristic.confidence,
            reason: heuristic.reason,
            evidence: null,
            expiresAt: heuristic.suggestedExpiresAt || expiresAtForNewFlags,
            duplicateOfTaskId: null,
          };
          break;
        case "stale":
          flag = {
            taskId,
            kind: "stale",
            cleanupStatus: "suggested_expire",
            category: staleCategory(heuristic),
            confidence: heuristic.confidence,
            reason: heuristic.reason,
            evidence: null,
            expiresAt: heuristic.suggestedExpiresAt || expiresAtForNewFlags,
            duplicateOfTaskId: null,
          };
          break;
        case "duplicate":
          if (heuristic.duplicateOfTaskId && heuristic.duplicateOfTaskId !== taskId) {
            flag = {
              taskId,
              kind: "duplicate",
              cleanupStatus: "duplicate_suggested",
              category: "duplicate",
              confidence: heuristic.confidence,
              reason: heuristic.reason,
              evidence: [
                {
                  sourceType: "task",
                  sourceId: heuristic.duplicateOfTaskId,
                  snippet:
                    titleById.get(heuristic.duplicateOfTaskId) || "Existing task",
                },
              ],
              expiresAt: null,
              duplicateOfTaskId: heuristic.duplicateOfTaskId,
            };
          }
          break;
        case "low_specificity":
          flag = {
            taskId,
            kind: "low_specificity",
            cleanupStatus: "suggested_expire",
            category: "low_specificity",
            confidence: heuristic.confidence,
            reason: heuristic.reason,
            evidence: null,
            expiresAt: expiresAtForNewFlags,
            duplicateOfTaskId: null,
          };
          break;
        default:
          flag = null;
          break;
      }
    }

    if (!flag) continue;
    if (!passesStrictnessGate(flag, settings.strictness)) continue;
    if (settings.categories[flag.category] === false) continue;
    pendingFlags.push(flag);
  }

  // 6. Bulk-write flags — guarded so reviewed docs are never overwritten.
  let flagged = 0;
  const byCategory: Record<string, number> = {};
  if (pendingFlags.length) {
    const operations = pendingFlags.map((flag) => ({
      updateOne: {
        filter: {
          _id: flag.taskId,
          ...UNREVIEWED_CLEANUP_FILTER,
        },
        update: {
          $set: {
            cleanupStatus: flag.cleanupStatus,
            cleanupCategory: flag.category,
            cleanupReason: flag.reason,
            cleanupConfidence: flag.confidence,
            cleanupEvidence: flag.evidence,
            expiresAt: flag.expiresAt,
            duplicateOfTaskId: flag.duplicateOfTaskId,
            lastUpdated: now,
          },
        },
      },
    }));
    const bulkResult: any = await tasksCollection.bulkWrite(operations as any, {
      ordered: false,
    });
    flagged =
      typeof bulkResult?.modifiedCount === "number"
        ? bulkResult.modifiedCount
        : pendingFlags.length;
    pendingFlags.forEach((flag) => {
      byCategory[flag.category] = (byCategory[flag.category] || 0) + 1;
    });
  }

  return {
    scanned: eligibleTasks.length,
    flagged,
    expired,
    byCategory,
  };
};
