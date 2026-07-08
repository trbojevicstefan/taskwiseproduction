// src/lib/planning-upcoming.ts
//
// Priority 12 — pure helpers behind GET /api/planning/upcoming-meetings.
//
// Merges upcoming Taskwise meetings (startTime >= now) with upcoming Google
// Calendar events (allEvents opt-in via fetchGoogleUpcomingEvents), flags
// meetings that still need an agenda, and counts open tasks whose assignee
// matches a meeting attendee (email or normalized-name match — the same
// precedence signals the task routes use).
//
// Everything here is deterministic and side-effect free so it can be unit
// tested without mocks.

import { meetingNeedsAgenda, readMeetingAgenda } from "@/lib/meeting-agenda";
import { normalizePersonNameKey } from "@/lib/transcript-utils";
import type { GoogleUpcomingEvent } from "@/lib/google-calendar-upcoming";

export type UpcomingAttendee = {
  name: string | null;
  email: string | null;
};

export type UpcomingMeetingItem = {
  /** Stable render key: `tw:<meetingId>` or `g:<eventId>`. */
  id: string;
  /** "taskwise" | "google" | "linked" (google event matched to a meeting). */
  source: "taskwise" | "google" | "linked";
  meetingId: string | null;
  googleEventId: string | null;
  title: string;
  startTime: string;
  endTime: string | null;
  attendees: UpcomingAttendee[];
  hangoutLink: string | null;
  needsAgenda: boolean;
  agendaSectionCount: number;
  openTaskCount: number;
  openTaskIds: string[];
};

const MAX_OPEN_TASK_IDS = 10;

/** |a - b| within 45 minutes — title-match dedupe window. */
const TITLE_MATCH_WINDOW_MS = 45 * 60 * 1000;

export const toDateSafe = (value: unknown): Date | null => {
  if (!value) return null;
  const date =
    value instanceof Date ? value : new Date(value as string | number);
  return Number.isNaN(date.getTime()) ? null : date;
};

/**
 * Meeting/event attendees are schemaless: strings, {name,email} objects
 * (PersonSchemaType), or Google attendee objects. Normalize defensively.
 */
export const normalizeUpcomingAttendees = (raw: unknown): UpcomingAttendee[] => {
  if (!Array.isArray(raw)) return [];
  const attendees: UpcomingAttendee[] = [];
  for (const entry of raw) {
    if (typeof entry === "string") {
      const name = entry.trim();
      if (name) attendees.push({ name, email: null });
      continue;
    }
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const name =
      typeof record.name === "string" && record.name.trim()
        ? record.name.trim()
        : typeof record.displayName === "string" && record.displayName.trim()
          ? record.displayName.trim()
          : null;
    const email =
      typeof record.email === "string" && record.email.trim()
        ? record.email.trim().toLowerCase()
        : null;
    if (name || email) attendees.push({ name, email });
  }
  return attendees;
};

type AttendeeKeySets = {
  emails: Set<string>;
  nameKeys: Set<string>;
};

export const buildAttendeeKeySets = (
  attendees: UpcomingAttendee[]
): AttendeeKeySets => {
  const emails = new Set<string>();
  const nameKeys = new Set<string>();
  for (const attendee of attendees) {
    if (attendee.email) emails.add(attendee.email);
    if (attendee.name) {
      const key = normalizePersonNameKey(attendee.name);
      if (key) nameKeys.add(key);
    }
  }
  return { emails, nameKeys };
};

/** Minimal open-task shape needed for attendee matching. */
export type OpenTaskLike = {
  _id?: unknown;
  id?: unknown;
  assignee?: {
    name?: string | null;
    displayName?: string | null;
    email?: string | null;
  } | null;
  assigneeName?: string | null;
  assigneeNameKey?: string | null;
  assigneeEmail?: string | null;
};

const taskMatchesAttendees = (
  task: OpenTaskLike,
  keys: AttendeeKeySets
): boolean => {
  const emails = [task.assignee?.email, task.assigneeEmail]
    .map((value) =>
      typeof value === "string" ? value.trim().toLowerCase() : ""
    )
    .filter(Boolean);
  if (emails.some((email) => keys.emails.has(email))) return true;

  const nameKeys = [
    typeof task.assigneeNameKey === "string" ? task.assigneeNameKey.trim() : "",
    task.assigneeName ? normalizePersonNameKey(task.assigneeName) : "",
    task.assignee?.name ? normalizePersonNameKey(task.assignee.name) : "",
    task.assignee?.displayName
      ? normalizePersonNameKey(task.assignee.displayName)
      : "",
  ].filter(Boolean);
  return nameKeys.some((key) => keys.nameKeys.has(key));
};

export const collectOpenTasksForAttendees = (
  attendees: UpcomingAttendee[],
  openTasks: OpenTaskLike[]
): { count: number; taskIds: string[] } => {
  const keys = buildAttendeeKeySets(attendees);
  if (keys.emails.size === 0 && keys.nameKeys.size === 0) {
    return { count: 0, taskIds: [] };
  }
  const taskIds: string[] = [];
  let count = 0;
  for (const task of openTasks) {
    if (!taskMatchesAttendees(task, keys)) continue;
    count += 1;
    if (taskIds.length < MAX_OPEN_TASK_IDS) {
      const id = String(task._id ?? task.id ?? "").trim();
      if (id) taskIds.push(id);
    }
  }
  return { count, taskIds };
};

const normalizeTitleKey = (title: unknown): string =>
  normalizePersonNameKey(typeof title === "string" ? title : "");

type BuildUpcomingArgs = {
  /** Taskwise meeting docs (already filtered to startTime >= now). */
  taskwiseMeetings: any[];
  /** Google events from fetchGoogleUpcomingEvents (allEvents opt-in). */
  googleEvents: GoogleUpcomingEvent[];
  /** Open tasks (status != done, not archived/expired). */
  openTasks: OpenTaskLike[];
  now: Date;
  limit?: number;
};

/**
 * Merge Taskwise meetings and Google events into one sorted upcoming list.
 *
 * Dedupe rules (a Google event that IS a Taskwise meeting must appear once):
 *  1. google event id === meeting.calendarEventId (or meeting.conferenceId)
 *  2. same normalized title AND start times within 45 minutes
 * A matched pair renders as one "linked" item keyed by the Taskwise meeting
 * (so agenda editing is available) with the Google link attached.
 */
export const buildUpcomingMeetingItems = ({
  taskwiseMeetings,
  googleEvents,
  openTasks,
  now,
  limit = 25,
}: BuildUpcomingArgs): UpcomingMeetingItem[] => {
  const items: UpcomingMeetingItem[] = [];
  const consumedGoogleIds = new Set<string>();

  const upcomingGoogle = googleEvents.filter((event) => {
    const start = toDateSafe(event.startTime);
    return Boolean(start && start.getTime() >= now.getTime());
  });

  for (const meeting of taskwiseMeetings) {
    const start = toDateSafe(meeting?.startTime);
    if (!start || start.getTime() < now.getTime()) continue;

    const meetingId = String(meeting._id ?? meeting.id ?? "").trim();
    if (!meetingId) continue;

    const calendarEventId =
      typeof meeting.calendarEventId === "string"
        ? meeting.calendarEventId.trim()
        : "";
    const conferenceId =
      typeof meeting.conferenceId === "string"
        ? meeting.conferenceId.trim()
        : "";
    const titleKey = normalizeTitleKey(meeting.title);

    const matchedEvent = upcomingGoogle.find((event) => {
      if (consumedGoogleIds.has(event.id)) return false;
      if (calendarEventId && event.id === calendarEventId) return true;
      if (conferenceId && event.id === conferenceId) return true;
      if (!titleKey || normalizeTitleKey(event.title) !== titleKey) {
        return false;
      }
      const eventStart = toDateSafe(event.startTime);
      return Boolean(
        eventStart &&
          Math.abs(eventStart.getTime() - start.getTime()) <=
            TITLE_MATCH_WINDOW_MS
      );
    });
    if (matchedEvent) consumedGoogleIds.add(matchedEvent.id);

    const attendees = normalizeUpcomingAttendees(
      Array.isArray(meeting.attendees) && meeting.attendees.length > 0
        ? meeting.attendees
        : matchedEvent?.attendees
    );
    const openMatch = collectOpenTasksForAttendees(attendees, openTasks);
    const agendaSections = readMeetingAgenda(meeting);
    const end = toDateSafe(meeting.endTime) ?? toDateSafe(matchedEvent?.endTime);

    items.push({
      id: `tw:${meetingId}`,
      source: matchedEvent ? "linked" : "taskwise",
      meetingId,
      googleEventId: matchedEvent?.id ?? null,
      title:
        (typeof meeting.title === "string" && meeting.title.trim()) ||
        matchedEvent?.title ||
        "Meeting",
      startTime: start.toISOString(),
      endTime: end ? end.toISOString() : null,
      attendees,
      hangoutLink: matchedEvent?.hangoutLink ?? null,
      needsAgenda: agendaSections.length === 0,
      agendaSectionCount: agendaSections.length,
      openTaskCount: openMatch.count,
      openTaskIds: openMatch.taskIds,
    });
  }

  for (const event of upcomingGoogle) {
    if (consumedGoogleIds.has(event.id)) continue;
    const start = toDateSafe(event.startTime);
    if (!start) continue;
    const attendees = normalizeUpcomingAttendees(event.attendees);
    const openMatch = collectOpenTasksForAttendees(attendees, openTasks);
    const end = toDateSafe(event.endTime);

    items.push({
      id: `g:${event.id}`,
      source: "google",
      meetingId: null,
      googleEventId: event.id,
      title: event.title || "Untitled Meeting",
      startTime: start.toISOString(),
      endTime: end ? end.toISOString() : null,
      attendees,
      hangoutLink: event.hangoutLink ?? null,
      // Google-only events have no Taskwise doc to hold an agenda yet.
      needsAgenda: true,
      agendaSectionCount: 0,
      openTaskCount: openMatch.count,
      openTaskIds: openMatch.taskIds,
    });
  }

  items.sort(
    (a, b) =>
      new Date(a.startTime).getTime() - new Date(b.startTime).getTime() ||
      a.id.localeCompare(b.id)
  );
  return items.slice(0, Math.max(1, limit));
};

export { meetingNeedsAgenda };
