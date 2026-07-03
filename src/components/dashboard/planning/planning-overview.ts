// src/components/dashboard/planning/planning-overview.ts
//
// Client-side types and helpers for GET /api/planning/overview (Phase 5).
// The API returns apiSuccess({ data: { sections, counts } }) where every task
// is the serializeTask shape used by the task routes plus `planningFlags`.

import type { Task } from "@/types/project";

export interface PlanningFlags {
  overdue: boolean;
  blocked: boolean;
  waitingOnClient: boolean;
  needsOwner: boolean;
  needsDueDate: boolean;
}

export type PlanningTask = Task & {
  planningFlags?: Partial<PlanningFlags> | null;
};

export type PlanningSectionKey =
  | "today"
  | "thisWeek"
  | "blocked"
  | "waitingOnClient"
  | "needsOwner"
  | "needsDueDate";

export interface PlanningOverview {
  sections: Record<PlanningSectionKey, PlanningTask[]>;
  counts: Record<PlanningSectionKey, number>;
}

/** Render order: Today + This week on the top row, triage sections below. */
export const PLANNING_SECTION_ORDER: PlanningSectionKey[] = [
  "today",
  "thisWeek",
  "blocked",
  "waitingOnClient",
  "needsOwner",
  "needsDueDate",
];

export interface PlanningSectionMeta {
  title: string;
  emptyText: string;
  /**
   * The flag that defines membership in this section — suppressed from the
   * row's flag chips because the section title already says it.
   */
  suppressedFlag?: keyof PlanningFlags;
}

export const PLANNING_SECTION_META: Record<PlanningSectionKey, PlanningSectionMeta> = {
  today: { title: "Today", emptyText: "Nothing due today." },
  thisWeek: { title: "This week", emptyText: "Nothing else due this week." },
  blocked: {
    title: "Blocked",
    emptyText: "No blocked tasks.",
    suppressedFlag: "blocked",
  },
  waitingOnClient: {
    title: "Waiting on client",
    emptyText: "Nothing waiting on a client.",
    suppressedFlag: "waitingOnClient",
  },
  needsOwner: {
    title: "Needs owner",
    emptyText: "Every task has an owner.",
    suppressedFlag: "needsOwner",
  },
  needsDueDate: {
    title: "Needs due date",
    emptyText: "Every task has a due date.",
    suppressedFlag: "needsDueDate",
  },
};

/** Suggested prompts for the planning AI assistant (Phase 5 spec). */
export const PLANNING_ASSISTANT_PROMPTS: string[] = [
  "Prioritize my week",
  "What should I do next?",
  "What is blocked?",
  "What client commitments are at risk?",
];

const EMPTY_OVERVIEW: PlanningOverview = {
  sections: {
    today: [],
    thisWeek: [],
    blocked: [],
    waitingOnClient: [],
    needsOwner: [],
    needsDueDate: [],
  },
  counts: {
    today: 0,
    thisWeek: 0,
    blocked: 0,
    waitingOnClient: 0,
    needsOwner: 0,
    needsDueDate: 0,
  },
};

/** Defensive normalization of the /api/planning/overview payload. */
export const normalizePlanningOverview = (data: unknown): PlanningOverview => {
  const raw = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const rawSections = (raw.sections && typeof raw.sections === "object"
    ? raw.sections
    : {}) as Record<string, unknown>;
  const rawCounts = (raw.counts && typeof raw.counts === "object"
    ? raw.counts
    : {}) as Record<string, unknown>;

  const sections = {} as Record<PlanningSectionKey, PlanningTask[]>;
  const counts = {} as Record<PlanningSectionKey, number>;

  for (const key of PLANNING_SECTION_ORDER) {
    const list = rawSections[key];
    sections[key] = Array.isArray(list)
      ? (list.filter(
          (entry) => Boolean(entry) && typeof entry === "object"
        ) as PlanningTask[])
      : [];
    const count = rawCounts[key];
    counts[key] =
      typeof count === "number" && Number.isFinite(count) && count >= 0
        ? count
        : sections[key].length;
  }

  return { sections, counts };
};

export const isPlanningOverviewEmpty = (overview: PlanningOverview): boolean =>
  PLANNING_SECTION_ORDER.every((key) => overview.sections[key].length === 0);

export { EMPTY_OVERVIEW as EMPTY_PLANNING_OVERVIEW };
