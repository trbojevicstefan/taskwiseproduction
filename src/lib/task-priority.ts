// src/lib/task-priority.ts
/**
 * Deterministic task priority scorer for Phase 9.
 *
 * Pure and dependency-light (date-fns only) — no I/O, no LLM calls. The
 * transparent additive weight table below IS the scoring model; the
 * priorityReason is composed from the same factors, so scores and reasons
 * are always consistent and reproducible.
 *
 * Weight table (additive, clamped to 0..100):
 *
 * | Signal                                                        | Weight |
 * |---------------------------------------------------------------|--------|
 * | Overdue (due calendar day before today)                       |  +40   |
 * | Due today                                                     |  +35   |
 * | Due within 2 days                                             |  +30   |
 * | Due within 7 days                                             |  +20   |
 * | Due within 14 days                                            |  +10   |
 * | Explicit task priority 'high'                                 |  +20   |
 * | Explicit task priority 'medium'                               |  +10   |
 * | Client impact (assignee uid/email in clientAssigneeIds)       |  +15   |
 * | Blocker signal in title/description (blocked, blocking,       |  +10   |
 * |   waiting on, unblock, depends on)                            |        |
 * | Recency (createdAt or lastUpdated within the last 7 days)     |   +5   |
 * | Workload relief (assignee open-task count > 10)               |   -5   |
 *
 * Due-date buckets are mutually exclusive (a task lands in exactly one).
 * status 'done' or cleanupStatus 'expired' short-circuits to
 * { score: 0, label: 'low', reason: 'Completed or expired' }.
 *
 * Label thresholds (scoreToPriorityLabel):
 *   score >= 70 -> 'urgent' | >= 45 -> 'high' | >= 25 -> 'medium' | else 'low'
 *
 * priorityReason = top 3 contributing factors in descending contribution
 * order, joined with '; ' (e.g. 'Overdue by 3 days; Marked high priority;
 * Client-facing'). A task with no contributing factors gets
 * 'No urgency signals'.
 */

import { differenceInCalendarDays } from "date-fns";
import type { TaskPriorityLabel } from "@/types/chat";

export interface PriorityTaskInput {
  title?: string | null;
  description?: string | null;
  status?: string | null;
  priority?: string | null;
  dueAt?: string | Date | null;
  assignee?: {
    uid?: string | null;
    email?: string | null;
  } | null;
  assigneeName?: string | null;
  createdAt?: string | Date | null;
  lastUpdated?: string | Date | null;
  cleanupStatus?: string | null;
}

export interface PriorityContext {
  now: Date;
  /** Assignee identifiers (person uid or email) classified as clients. */
  clientAssigneeIds?: Set<string>;
  /** Open (non-done) task counts keyed by assignee uid, email, or name. */
  assigneeOpenCounts?: Map<string, number>;
}

export interface TaskPriorityResult {
  priorityScore: number;
  priorityLabel: TaskPriorityLabel;
  priorityReason: string;
}

interface PriorityFactor {
  label: string;
  weight: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const RECENCY_WINDOW_DAYS = 7;
const WORKLOAD_RELIEF_THRESHOLD = 10;
const MAX_REASON_FACTORS = 3;

const COMPLETED_OR_EXPIRED_REASON = "Completed or expired";
const NO_SIGNALS_REASON = "No urgency signals";

// Start-of-word matches only; 'unblock' intentionally matches 'unblocked'
// and 'unblocking' too.
const BLOCKER_SIGNALS_RE =
  /\b(blocked|blocking|waiting on|unblock|depends on)/i;

const toDate = (value: string | Date | null | undefined): Date | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const formatDays = (count: number): string =>
  `${count} day${count === 1 ? "" : "s"}`;

export const scoreToPriorityLabel = (score: number): TaskPriorityLabel => {
  if (score >= 70) return "urgent";
  if (score >= 45) return "high";
  if (score >= 25) return "medium";
  return "low";
};

const buildDueDateFactor = (
  dueAt: string | Date | null | undefined,
  now: Date
): PriorityFactor | null => {
  const dueDate = toDate(dueAt);
  if (!dueDate) return null;

  // Calendar-day difference in the local timezone: a task due earlier today
  // is 'due today', not overdue.
  const dayDiff = differenceInCalendarDays(dueDate, now);
  if (dayDiff < 0) {
    return { label: `Overdue by ${formatDays(-dayDiff)}`, weight: 40 };
  }
  if (dayDiff === 0) {
    return { label: "Due today", weight: 35 };
  }
  if (dayDiff <= 2) {
    return { label: `Due in ${formatDays(dayDiff)}`, weight: 30 };
  }
  if (dayDiff <= 7) {
    return { label: `Due in ${formatDays(dayDiff)}`, weight: 20 };
  }
  if (dayDiff <= 14) {
    return { label: `Due in ${formatDays(dayDiff)}`, weight: 10 };
  }
  return null;
};

const isRecent = (
  value: string | Date | null | undefined,
  now: Date
): boolean => {
  const date = toDate(value);
  if (!date) return false;
  return now.getTime() - date.getTime() <= RECENCY_WINDOW_DAYS * DAY_MS;
};

const resolveAssigneeOpenCount = (
  task: PriorityTaskInput,
  counts: Map<string, number> | undefined
): number | null => {
  if (!counts || counts.size === 0) return null;
  const keys = [
    task.assignee?.uid,
    task.assignee?.email,
    task.assigneeName,
  ];
  for (const key of keys) {
    if (key && counts.has(key)) {
      return counts.get(key) ?? null;
    }
  }
  return null;
};

const isClientFacing = (
  task: PriorityTaskInput,
  clientAssigneeIds: Set<string> | undefined
): boolean => {
  if (!clientAssigneeIds || clientAssigneeIds.size === 0) return false;
  const uid = task.assignee?.uid;
  const email = task.assignee?.email;
  return Boolean(
    (uid && clientAssigneeIds.has(uid)) ||
      (email && clientAssigneeIds.has(email))
  );
};

const clampScore = (score: number): number =>
  Math.max(0, Math.min(100, score));

export const computeTaskPriority = (
  task: PriorityTaskInput,
  ctx: PriorityContext
): TaskPriorityResult => {
  if (task.status === "done" || task.cleanupStatus === "expired") {
    return {
      priorityScore: 0,
      priorityLabel: "low",
      priorityReason: COMPLETED_OR_EXPIRED_REASON,
    };
  }

  const factors: PriorityFactor[] = [];

  const dueFactor = buildDueDateFactor(task.dueAt, ctx.now);
  if (dueFactor) factors.push(dueFactor);

  if (task.priority === "high") {
    factors.push({ label: "Marked high priority", weight: 20 });
  } else if (task.priority === "medium") {
    factors.push({ label: "Marked medium priority", weight: 10 });
  }

  if (isClientFacing(task, ctx.clientAssigneeIds)) {
    factors.push({ label: "Client-facing", weight: 15 });
  }

  const blockerText = `${task.title || ""} ${task.description || ""}`;
  if (BLOCKER_SIGNALS_RE.test(blockerText)) {
    factors.push({ label: "Blocker/dependency signal", weight: 10 });
  }

  if (isRecent(task.createdAt, ctx.now) || isRecent(task.lastUpdated, ctx.now)) {
    factors.push({ label: "Recently active", weight: 5 });
  }

  const openCount = resolveAssigneeOpenCount(task, ctx.assigneeOpenCounts);
  if (openCount !== null && openCount > WORKLOAD_RELIEF_THRESHOLD) {
    factors.push({ label: "Assignee has a heavy workload", weight: -5 });
  }

  const rawScore = factors.reduce((sum, factor) => sum + factor.weight, 0);
  const priorityScore = clampScore(rawScore);

  // Stable sort: equal-weight factors keep the table order above.
  const topFactors = [...factors]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, MAX_REASON_FACTORS)
    .map((factor) => factor.label);

  return {
    priorityScore,
    priorityLabel: scoreToPriorityLabel(priorityScore),
    priorityReason: topFactors.length
      ? topFactors.join("; ")
      : NO_SIGNALS_REASON,
  };
};
