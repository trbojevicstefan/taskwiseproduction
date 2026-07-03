// src/lib/task-cleanup-heuristics.ts
/**
 * Pure, dependency-free heuristic classifier for Phase 3 task cleanup.
 *
 * Classifies a single task as vanity/logistics, stale, duplicate,
 * low-specificity, ambiguous (LLM candidate) or keep — WITHOUT any I/O.
 * Protected classes (client work, legal/finance/security/compliance,
 * deliverables, assigned future-due tasks) are checked FIRST and always
 * force a 'keep' verdict so they can never be auto-flagged.
 */

import type { TaskCleanupCategory } from "@/types/chat";

export type HeuristicVerdict =
  | "keep"
  | "vanity"
  | "stale"
  | "duplicate"
  | "low_specificity"
  | "ambiguous";

export interface HeuristicTaskInput {
  /** Canonical task id — used to exclude self-matches in duplicate detection. */
  id?: string | null;
  title: string;
  description?: string | null;
  dueAt?: string | Date | null;
  assigneeName?: string | null;
  /** Resolved person id of the assignee (assignee.uid / assignee.id). */
  assigneePersonId?: string | null;
  status?: string | null;
  createdAt?: string | Date | null;
  sourceSessionType?: string | null;
  /** Start time of the source meeting, when known. */
  meetingStartTime?: string | Date | null;
}

export interface HeuristicContext {
  now: Date;
  /** Normalized title key -> canonical taskId (first/oldest task wins the key). */
  siblingTitleKeys: Map<string, string>;
  /** Person ids classified as clients — tasks assigned to them are protected. */
  clientAssigneeIds?: Set<string>;
  /** Auto-expire window in days used to compute suggestedExpiresAt. */
  autoExpireDays?: number;
}

export interface HeuristicResult {
  verdict: HeuristicVerdict;
  category?: TaskCleanupCategory;
  confidence: number;
  reason: string;
  duplicateOfTaskId?: string;
  suggestedExpiresAt?: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const STALE_MEETING_AGE_DAYS = 7;

/** Minimal replica of normalizeTitleKey from src/lib/ai-utils.ts (kept local so this module stays dependency-free). */
export const normalizeTitleKey = (title: string | undefined | null): string => {
  if (!title) return "";
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const PLACEHOLDER_ASSIGNEES = new Set([
  "unassigned",
  "unknown",
  "n/a",
  "na",
  "none",
  "tbd",
]);

const hasRealAssignee = (task: HeuristicTaskInput): boolean => {
  if (task.assigneePersonId) return true;
  const name = (task.assigneeName || "").trim().toLowerCase();
  return Boolean(name) && !PLACEHOLDER_ASSIGNEES.has(name);
};

const toDate = (value: string | Date | null | undefined): Date | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

// Protected keyword classes — legal/finance/security/compliance/contract/invoice/payment.
const PROTECTED_KEYWORDS_RE =
  /\b(legal|finance|security|compliance|contracts?|invoices?|payments?)\b/i;

// Titles that suggest a deliverable are never auto-flagged.
const DELIVERABLE_VERBS_RE =
  /\b(build|create|write|design|implement|fix|ship|deliver)\b/i;

type VanityPattern = {
  re: RegExp;
  category: TaskCleanupCategory;
  label: string;
};

// Case-insensitive, word-boundary patterns from the spec examples.
const VANITY_PATTERNS: VanityPattern[] = [
  {
    re: /\bsend (the )?(meeting )?invit(e|ation)s?\b/i,
    category: "scheduling_admin",
    label: "send a meeting invite",
  },
  {
    re: /\bsend (the |out )?(presentation|deck|slides)\b/i,
    category: "meeting_logistics",
    label: "send the presentation/deck/slides",
  },
  {
    re: /\bshare (the )?agenda\b/i,
    category: "meeting_logistics",
    label: "share the agenda",
  },
  {
    re: /\bbook (the )?(meeting )?room\b/i,
    category: "meeting_logistics",
    label: "book a meeting room",
  },
  {
    re: /\bforward the (calendar )?invite\b/i,
    category: "scheduling_admin",
    label: "forward the invite",
  },
  {
    re: /\bjoin the (call|meeting)\b/i,
    category: "meeting_logistics",
    label: "join the call/meeting",
  },
  {
    re: /\bschedule (the )?(meeting|call)\b/i,
    category: "scheduling_admin",
    label: "schedule a meeting/call",
  },
  {
    re: /\badd to calendar\b/i,
    category: "scheduling_admin",
    label: "add to calendar",
  },
];

// Weak logistics signals — not strong enough to flag on their own, but worth
// asking the LLM auditor about.
const WEAK_SIGNAL_RE =
  /\b(invite|invitation|calendar|agenda|slides|deck|reschedule|rsvp|zoom link|meeting link)\b/i;

// Words in a title that indicate the task is bound to a specific event/meeting.
const EVENT_REFERENCE_RE =
  /\b(meeting|call|demo|event|session|standup|stand-up|sync|workshop|webinar|kickoff|kick-off|retro(spective)?|offsite|presentation)\b/i;

const FOLLOW_UP_RE = /\b(follow[ -]?up|circle back|check[ -]?in|touch base)\b/i;

// Generic low-specificity phrases (whole normalized title).
const LOW_SPECIFICITY_TITLES = new Set([
  "follow up",
  "followup",
  "follow up later",
  "review",
  "review this",
  "review it",
  "sync",
  "sync up",
  "quick sync",
  "circle back",
  "check in",
  "touch base",
  "catch up",
  "ping",
  "reconnect",
]);

const FILLER_WORDS = new Set([
  "the",
  "a",
  "an",
  "this",
  "that",
  "it",
  "on",
  "in",
  "at",
  "with",
  "to",
  "up",
  "back",
  "for",
  "of",
  "later",
  "again",
]);

const countMeaningfulWords = (titleKey: string): number =>
  titleKey
    .split(" ")
    .filter((word) => word && !FILLER_WORDS.has(word)).length;

const computeSuggestedExpiresAt = (ctx: HeuristicContext): string | null => {
  const days = ctx.autoExpireDays;
  if (!days || !Number.isFinite(days) || days <= 0) return null;
  return new Date(ctx.now.getTime() + days * DAY_MS).toISOString();
};

export const classifyTaskHeuristic = (
  task: HeuristicTaskInput,
  ctx: HeuristicContext
): HeuristicResult => {
  const title = (task.title || "").trim();
  const titleKey = normalizeTitleKey(title);
  const description = (task.description || "").trim();
  const dueDate = toDate(task.dueAt);
  const hasFutureDue = Boolean(dueDate && dueDate.getTime() > ctx.now.getTime());

  // --- PROTECTED classes run FIRST and always force 'keep'. ---
  if (hasFutureDue && hasRealAssignee(task)) {
    return {
      verdict: "keep",
      confidence: 1,
      reason: "Protected: has a future due date and an assignee.",
    };
  }
  if (
    task.assigneePersonId &&
    ctx.clientAssigneeIds?.has(String(task.assigneePersonId))
  ) {
    return {
      verdict: "keep",
      confidence: 1,
      reason: "Protected: assigned to a client.",
    };
  }
  if (PROTECTED_KEYWORDS_RE.test(title) || PROTECTED_KEYWORDS_RE.test(description)) {
    return {
      verdict: "keep",
      confidence: 1,
      reason:
        "Protected: mentions legal/finance/security/compliance/contract/invoice/payment.",
    };
  }
  if (DELIVERABLE_VERBS_RE.test(title)) {
    return {
      verdict: "keep",
      confidence: 1,
      reason: "Protected: title suggests a deliverable.",
    };
  }

  if (!titleKey) {
    return { verdict: "keep", confidence: 0, reason: "No title to classify." };
  }

  // --- Vanity / logistics patterns. ---
  for (const pattern of VANITY_PATTERNS) {
    if (!pattern.re.test(title)) continue;
    const wholeTitleRe = new RegExp(
      `^(?:${pattern.re.source})[.!]?$`,
      "i"
    );
    const isWholeTitle = wholeTitleRe.test(title);
    return {
      verdict: "vanity",
      category: pattern.category,
      confidence: isWholeTitle ? 0.9 : 0.7,
      reason: isWholeTitle
        ? `Title is a ${pattern.label} logistics task.`
        : `Title contains a ${pattern.label} logistics phrase.`,
      suggestedExpiresAt: computeSuggestedExpiresAt(ctx),
    };
  }

  // --- Duplicates (normalized title key already claimed by another task). ---
  const duplicateOf = ctx.siblingTitleKeys.get(titleKey);
  if (duplicateOf && task.id && duplicateOf !== String(task.id)) {
    return {
      verdict: "duplicate",
      category: "duplicate",
      confidence: 0.75,
      reason: "Another open task has the same title.",
      duplicateOfTaskId: duplicateOf,
    };
  }

  // --- Stale: event-bound task whose source meeting is well in the past. ---
  const meetingStart = toDate(task.meetingStartTime);
  const meetingAgeDays = meetingStart
    ? (ctx.now.getTime() - meetingStart.getTime()) / DAY_MS
    : null;
  if (
    meetingAgeDays !== null &&
    meetingAgeDays > STALE_MEETING_AGE_DAYS &&
    !hasFutureDue &&
    (EVENT_REFERENCE_RE.test(title) || FOLLOW_UP_RE.test(title))
  ) {
    const isFollowUp = FOLLOW_UP_RE.test(title);
    return {
      verdict: "stale",
      category: isFollowUp ? "stale_follow_up" : "expired_event",
      confidence: 0.7,
      reason: isFollowUp
        ? `Follow-up from a meeting more than ${STALE_MEETING_AGE_DAYS} days ago with no future due date.`
        : `References an event/meeting that happened more than ${STALE_MEETING_AGE_DAYS} days ago with no future due date.`,
      suggestedExpiresAt: computeSuggestedExpiresAt(ctx),
    };
  }

  // --- Low specificity: generic short titles with no supporting detail. ---
  const meaningfulWords = countMeaningfulWords(titleKey);
  if (
    !description &&
    !hasRealAssignee(task) &&
    !dueDate &&
    meaningfulWords <= 3 &&
    (LOW_SPECIFICITY_TITLES.has(titleKey) || FOLLOW_UP_RE.test(title))
  ) {
    return {
      verdict: "low_specificity",
      category: "low_specificity",
      confidence: 0.65,
      reason: "Vague title with no description, assignee, or due date.",
    };
  }

  // --- Ambiguous: weak logistics signals below the flagging thresholds. ---
  if (WEAK_SIGNAL_RE.test(title)) {
    return {
      verdict: "ambiguous",
      confidence: 0.4,
      reason: "Weak scheduling/logistics signal; needs LLM review.",
    };
  }

  return { verdict: "keep", confidence: 0, reason: "No cleanup signals." };
};
