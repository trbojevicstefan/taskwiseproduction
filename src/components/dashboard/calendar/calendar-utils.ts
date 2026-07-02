// src/components/dashboard/calendar/calendar-utils.ts

import {
  addDays,
  endOfDay,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import type {
  CalendarData,
  CalendarDayEntry,
  CalendarRange,
  CalendarView,
  GoogleCalendarOverlayEvent,
  TaskTone,
} from "./types";

export const CALENDAR_VIEW_STORAGE_KEY = "calendarView";

const CALENDAR_VIEWS: CalendarView[] = ["month", "week", "agenda"];

export const AGENDA_SPAN_DAYS = 30;

export const isCalendarView = (value: unknown): value is CalendarView =>
  typeof value === "string" && CALENDAR_VIEWS.includes(value as CalendarView);

export const readStoredCalendarView = (): CalendarView => {
  try {
    if (typeof localStorage === "undefined") return "month";
    const raw = localStorage.getItem(CALENDAR_VIEW_STORAGE_KEY);
    return isCalendarView(raw) ? raw : "month";
  } catch {
    return "month";
  }
};

export const storeCalendarView = (view: CalendarView): void => {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(CALENDAR_VIEW_STORAGE_KEY, view);
  } catch {
    // Storage may be unavailable (private mode); the view still works in-memory.
  }
};

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * dueAt/startTime values are schemaless (string | Date | legacy shapes).
 * Coerce defensively; date-only strings are parsed as LOCAL dates so a task
 * due "2026-07-10" lands on July 10 regardless of timezone.
 */
export const coerceDate = (value: unknown): Date | null => {
  if (value == null) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "number") {
    const fromNumber = new Date(value);
    return Number.isNaN(fromNumber.getTime()) ? null : fromNumber;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (DATE_ONLY_PATTERN.test(trimmed)) {
      const [year, month, day] = trimmed.split("-").map(Number);
      return new Date(year, month - 1, day);
    }
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
};

export const dayKey = (date: Date): string => format(date, "yyyy-MM-dd");

export const getViewRange = (view: CalendarView, anchor: Date): CalendarRange => {
  if (view === "month") {
    return {
      from: startOfWeek(startOfMonth(anchor), { weekStartsOn: 1 }),
      to: endOfWeek(endOfMonth(anchor), { weekStartsOn: 1 }),
    };
  }
  if (view === "week") {
    return {
      from: startOfWeek(anchor, { weekStartsOn: 1 }),
      to: endOfWeek(anchor, { weekStartsOn: 1 }),
    };
  }
  return {
    from: startOfDay(anchor),
    to: endOfDay(addDays(anchor, AGENDA_SPAN_DAYS)),
  };
};

export const formatRangeLabel = (
  view: CalendarView,
  anchor: Date,
  range: CalendarRange
): string => {
  if (view === "month") {
    return format(anchor, "MMMM yyyy");
  }
  if (view === "week") {
    if (isSameMonth(range.from, range.to)) {
      return `${format(range.from, "MMM d")}–${format(range.to, "d, yyyy")}`;
    }
    return `${format(range.from, "MMM d")} – ${format(range.to, "MMM d, yyyy")}`;
  }
  return `${format(range.from, "MMM d")} – ${format(range.to, "MMM d, yyyy")}`;
};

export const getTaskTone = (task: {
  overdue: boolean;
  priorityLabel: string | null;
}): TaskTone => {
  if (task.overdue) return "overdue";
  if ((task.priorityLabel || "").toLowerCase() === "urgent") return "urgent";
  return "neutral";
};

const entryTimeValue = (entry: CalendarDayEntry): number =>
  entry.date ? entry.date.getTime() : Number.MAX_SAFE_INTEGER;

/**
 * Buckets calendar payload + Google overlay events into per-day entry lists
 * keyed by yyyy-MM-dd. Timed items (meetings, Google events) come first in
 * chronological order; tasks follow, overdue first.
 */
export const buildDayEntries = (
  data: CalendarData,
  googleEvents: GoogleCalendarOverlayEvent[]
): Map<string, CalendarDayEntry[]> => {
  const timed: CalendarDayEntry[] = [];
  const tasks: CalendarDayEntry[] = [];

  data.meetings.forEach((meeting) => {
    const date = coerceDate(meeting.startTime);
    if (!date) return;
    timed.push({
      kind: "meeting",
      id: meeting.id,
      title: meeting.title,
      date,
      isClientMeeting: Boolean(meeting.isClientMeeting),
      attendeeCount: meeting.attendeeCount || 0,
    });
  });

  googleEvents.forEach((event) => {
    const date = coerceDate(event.startTime);
    if (!date) return;
    timed.push({
      kind: "google",
      id: event.id,
      title: event.title,
      date,
      link: event.hangoutLink || event.htmlLink || null,
    });
  });

  data.tasks.forEach((task) => {
    const date = coerceDate(task.dueAt);
    if (!date) return;
    tasks.push({
      kind: "task",
      id: task.id,
      title: task.title,
      date,
      tone: getTaskTone(task),
      status: task.status,
      priorityLabel: task.priorityLabel,
      assigneeName: task.assigneeName,
      sourceSessionId: task.sourceSessionId,
    });
  });

  timed.sort((a, b) => entryTimeValue(a) - entryTimeValue(b));
  tasks.sort((a, b) => {
    const aOverdue = a.kind === "task" && a.tone === "overdue" ? 0 : 1;
    const bOverdue = b.kind === "task" && b.tone === "overdue" ? 0 : 1;
    if (aOverdue !== bOverdue) return aOverdue - bOverdue;
    return a.title.localeCompare(b.title);
  });

  const buckets = new Map<string, CalendarDayEntry[]>();
  [...timed, ...tasks].forEach((entry) => {
    if (!entry.date) return;
    const key = dayKey(entry.date);
    const existing = buckets.get(key);
    if (existing) {
      existing.push(entry);
    } else {
      buckets.set(key, [entry]);
    }
  });
  return buckets;
};

export const formatEntryTime = (entry: CalendarDayEntry): string | null => {
  if (entry.kind === "task" || !entry.date) return null;
  return format(entry.date, "p");
};
