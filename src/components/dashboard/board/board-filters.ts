// src/components/dashboard/board/board-filters.ts
//
// Pure helpers for the board's filter, sort, and URL-persistence logic
// (Priority 11). No React, no fetches — everything here is unit-testable.
//
// URL contract (all keys optional; absent === default):
//   q          — search text
//   assignee   — repeated; person ids
//   unassigned — "1" to include unassigned tasks in the assignee filter
//   company    — repeated; client/company names (matched case-insensitively)
//   due        — today | overdue | this_week | none
//   priority   — repeated; low | medium | high | urgent
//   meeting    — repeated; source meeting (session) ids
//   completion — suggested | none  (completion-suggestion status)
//   status     — repeated; board column (status) ids
//   sort       — comma-separated "<statusId>:<mode>" pairs (mode != manual)

import {
  endOfWeek,
  isBefore,
  isSameDay,
  isValid,
  isWithinInterval,
  startOfDay,
  startOfWeek,
} from "date-fns";
import type { Task } from "@/types/project";
import type { TaskPriorityLabel } from "@/types/chat";

export type BoardDueFilter = "all" | "today" | "overdue" | "this_week" | "none";
export type BoardCompletionFilter = "all" | "suggested" | "none";
export type ColumnSortMode = "manual" | "priority" | "due" | "recency";

/** Columns with more tasks than this get a WIP-warning count highlight. */
export const COLUMN_WIP_THRESHOLD = 8;

export const PRIORITY_FILTER_OPTIONS: TaskPriorityLabel[] = [
  "low",
  "medium",
  "high",
  "urgent",
];

export const COLUMN_SORT_MODES: ColumnSortMode[] = [
  "manual",
  "priority",
  "due",
  "recency",
];

export interface BoardFilters {
  search: string;
  /** Person ids. Empty === no assignee filter. */
  assignees: string[];
  /** Include tasks with no resolved assignee (combines OR with `assignees`). */
  unassigned: boolean;
  /** Client/company names. Empty === no company filter. */
  companies: string[];
  due: BoardDueFilter;
  /** Effective priority labels. Empty === all priorities. */
  priorities: TaskPriorityLabel[];
  /** Source meeting (session) ids. Empty === no meeting filter. */
  meetings: string[];
  completion: BoardCompletionFilter;
  /** Board status (column) ids. Empty === all columns. */
  statuses: string[];
}

export const DEFAULT_BOARD_FILTERS: BoardFilters = {
  search: "",
  assignees: [],
  unassigned: false,
  companies: [],
  due: "all",
  priorities: [],
  meetings: [],
  completion: "all",
  statuses: [],
};

const DUE_FILTER_VALUES = new Set<BoardDueFilter>([
  "all",
  "today",
  "overdue",
  "this_week",
  "none",
]);

const COMPLETION_FILTER_VALUES = new Set<BoardCompletionFilter>([
  "all",
  "suggested",
  "none",
]);

const PRIORITY_LABEL_VALUES = new Set<string>(PRIORITY_FILTER_OPTIONS);

const isPriorityLabel = (value: string): value is TaskPriorityLabel =>
  PRIORITY_LABEL_VALUES.has(value);

const uniqueStrings = (values: string[]) =>
  Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));

export const parseBoardFilters = (params: URLSearchParams): BoardFilters => {
  const due = params.get("due") || "all";
  const completion = params.get("completion") || "all";
  return {
    search: params.get("q") ?? "",
    assignees: uniqueStrings(params.getAll("assignee")),
    unassigned: params.get("unassigned") === "1",
    companies: uniqueStrings(params.getAll("company")),
    due: DUE_FILTER_VALUES.has(due as BoardDueFilter)
      ? (due as BoardDueFilter)
      : "all",
    priorities: uniqueStrings(params.getAll("priority")).filter(isPriorityLabel),
    meetings: uniqueStrings(params.getAll("meeting")),
    completion: COMPLETION_FILTER_VALUES.has(
      completion as BoardCompletionFilter
    )
      ? (completion as BoardCompletionFilter)
      : "all",
    statuses: uniqueStrings(params.getAll("status")),
  };
};

/**
 * Writes `filters` into `params` in place. Keys at their default value are
 * removed so the URL stays clean; unrelated keys (boardId, ...) are untouched.
 */
export const applyBoardFiltersToParams = (
  filters: BoardFilters,
  params: URLSearchParams
): void => {
  const setSingle = (key: string, value: string, defaultValue: string) => {
    params.delete(key);
    if (value && value !== defaultValue) params.set(key, value);
  };
  const setMulti = (key: string, values: string[]) => {
    params.delete(key);
    uniqueStrings(values).forEach((value) => params.append(key, value));
  };

  setSingle("q", filters.search.trim(), "");
  setMulti("assignee", filters.assignees);
  params.delete("unassigned");
  if (filters.unassigned) params.set("unassigned", "1");
  setMulti("company", filters.companies);
  setSingle("due", filters.due, "all");
  setMulti("priority", filters.priorities);
  setMulti("meeting", filters.meetings);
  setSingle("completion", filters.completion, "all");
  setMulti("status", filters.statuses);
};

export const hasActiveBoardFilters = (filters: BoardFilters): boolean =>
  filters.search.trim().length > 0 ||
  filters.assignees.length > 0 ||
  filters.unassigned ||
  filters.companies.length > 0 ||
  filters.due !== "all" ||
  filters.priorities.length > 0 ||
  filters.meetings.length > 0 ||
  filters.completion !== "all" ||
  filters.statuses.length > 0;

export const countActiveBoardFilters = (filters: BoardFilters): number =>
  [
    filters.search.trim().length > 0,
    filters.assignees.length > 0 || filters.unassigned,
    filters.companies.length > 0,
    filters.due !== "all",
    filters.priorities.length > 0,
    filters.meetings.length > 0,
    filters.completion !== "all",
    filters.statuses.length > 0,
  ].filter(Boolean).length;

export interface BoardFilterContext {
  /** Resolves the person ids a task's assignee maps to (may be empty). */
  resolveAssigneeIds: (task: Task) => Set<string>;
  /** Resolves the client/company a task belongs to (assignee's company). */
  resolveCompany: (task: Task) => string | null;
  /** Injectable clock for tests. */
  now?: Date;
}

const toDueDate = (value: Task["dueAt"]): Date | null => {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return isValid(parsed) ? parsed : null;
};

export const getEffectivePriority = (task: Task): TaskPriorityLabel =>
  task.priorityLabel || task.priority || "medium";

/**
 * All filters compose with AND; multi-value filters match with OR inside the
 * group (e.g. any selected assignee).
 */
export const taskMatchesBoardFilters = (
  task: Task,
  statusId: string,
  filters: BoardFilters,
  ctx: BoardFilterContext
): boolean => {
  const now = ctx.now ?? new Date();

  const query = filters.search.trim().toLowerCase();
  if (query) {
    const haystack = [
      task.title,
      task.description || "",
      task.sourceSessionName || "",
      task.assigneeName || "",
    ]
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(query)) return false;
  }

  if (filters.statuses.length && !filters.statuses.includes(statusId)) {
    return false;
  }

  if (
    filters.priorities.length &&
    !filters.priorities.includes(getEffectivePriority(task))
  ) {
    return false;
  }

  if (filters.assignees.length || filters.unassigned) {
    const assigneeIds = ctx.resolveAssigneeIds(task);
    const matchesPerson = Array.from(assigneeIds).some((id) =>
      filters.assignees.includes(id)
    );
    const matchesUnassigned = filters.unassigned && assigneeIds.size === 0;
    if (!matchesPerson && !matchesUnassigned) return false;
  }

  if (filters.companies.length) {
    const company = (ctx.resolveCompany(task) || "").trim().toLowerCase();
    if (!company) return false;
    const wanted = filters.companies.map((value) => value.trim().toLowerCase());
    if (!wanted.includes(company)) return false;
  }

  if (filters.meetings.length) {
    if (!task.sourceSessionId) return false;
    if (!filters.meetings.includes(task.sourceSessionId)) return false;
  }

  if (filters.completion === "suggested" && !task.completionSuggested) {
    return false;
  }
  if (filters.completion === "none" && task.completionSuggested) {
    return false;
  }

  if (filters.due !== "all") {
    const dueDate = toDueDate(task.dueAt ?? null);
    if (filters.due === "none") {
      if (dueDate) return false;
    } else {
      if (!dueDate) return false;
      if (filters.due === "today" && !isSameDay(dueDate, now)) return false;
      if (filters.due === "overdue" && !isBefore(dueDate, startOfDay(now))) {
        return false;
      }
      if (
        filters.due === "this_week" &&
        !isWithinInterval(dueDate, {
          start: startOfWeek(now, { weekStartsOn: 1 }),
          end: endOfWeek(now, { weekStartsOn: 1 }),
        })
      ) {
        return false;
      }
    }
  }

  return true;
};

// ---------------------------------------------------------------------------
// Column sorting
// ---------------------------------------------------------------------------

const PRIORITY_RANK: Record<TaskPriorityLabel, number> = {
  urgent: 3,
  high: 2,
  medium: 1,
  low: 0,
};

const toTimestampOrNull = (value: unknown): number | null => {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value as string);
  const time = parsed.getTime();
  return Number.isNaN(time) ? null : time;
};

type SortableBoardTask = Task & { boardRank?: number };

const byManualRank = (a: SortableBoardTask, b: SortableBoardTask) => {
  const rankA = typeof a.boardRank === "number" ? a.boardRank : 0;
  const rankB = typeof b.boardRank === "number" ? b.boardRank : 0;
  if (rankA !== rankB) return rankA - rankB;
  return a.title.localeCompare(b.title);
};

/** Returns a new sorted array; the input is not mutated. */
export const sortColumnTasks = <T extends SortableBoardTask>(
  tasks: T[],
  mode: ColumnSortMode
): T[] => {
  const sorted = [...tasks];
  switch (mode) {
    case "priority":
      sorted.sort((a, b) => {
        const scoreA = typeof a.priorityScore === "number" ? a.priorityScore : -1;
        const scoreB = typeof b.priorityScore === "number" ? b.priorityScore : -1;
        if (scoreA !== scoreB) return scoreB - scoreA;
        const labelDelta =
          PRIORITY_RANK[getEffectivePriority(b)] -
          PRIORITY_RANK[getEffectivePriority(a)];
        if (labelDelta !== 0) return labelDelta;
        return byManualRank(a, b);
      });
      break;
    case "due":
      sorted.sort((a, b) => {
        const dueA = toTimestampOrNull(a.dueAt);
        const dueB = toTimestampOrNull(b.dueAt);
        if (dueA !== dueB) {
          if (dueA == null) return 1;
          if (dueB == null) return -1;
          return dueA - dueB;
        }
        return byManualRank(a, b);
      });
      break;
    case "recency":
      sorted.sort((a, b) => {
        const createdA = toTimestampOrNull((a as any).createdAt) ?? 0;
        const createdB = toTimestampOrNull((b as any).createdAt) ?? 0;
        if (createdA !== createdB) return createdB - createdA;
        return byManualRank(a, b);
      });
      break;
    case "manual":
    default:
      sorted.sort(byManualRank);
      break;
  }
  return sorted;
};

export type ColumnSortMap = Record<string, ColumnSortMode>;

const isColumnSortMode = (value: string): value is ColumnSortMode =>
  (COLUMN_SORT_MODES as string[]).includes(value);

/** Parses the `sort` query param ("statusA:priority,statusB:due"). */
export const parseColumnSort = (value: string | null): ColumnSortMap => {
  const map: ColumnSortMap = {};
  if (!value) return map;
  value.split(",").forEach((entry) => {
    const separator = entry.lastIndexOf(":");
    if (separator <= 0) return;
    const statusId = entry.slice(0, separator).trim();
    const mode = entry.slice(separator + 1).trim();
    if (statusId && isColumnSortMode(mode) && mode !== "manual") {
      map[statusId] = mode;
    }
  });
  return map;
};

/** Serializes a sort map for the `sort` query param; "" when all manual. */
export const serializeColumnSort = (map: ColumnSortMap): string =>
  Object.entries(map)
    .filter(([statusId, mode]) => statusId && mode !== "manual")
    .map(([statusId, mode]) => `${statusId}:${mode}`)
    .join(",");
