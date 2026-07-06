// src/lib/agenda-suggestions.ts
//
// Priority 12 — deterministic suggested agenda topics for a future meeting.
// No LLM: topics come from (a) open tasks assigned to the meeting attendees
// and (b) carry-over items from the most recent past meeting with the same
// title or overlapping attendees (its agenda sections + its still-open
// extracted tasks). Pure functions — unit tested without mocks.

import { readMeetingAgenda } from "@/lib/meeting-agenda";
import {
  buildAttendeeKeySets,
  normalizeUpcomingAttendees,
  toDateSafe,
} from "@/lib/planning-upcoming";
import { normalizePersonNameKey } from "@/lib/transcript-utils";

export const MAX_SUGGESTED_TOPICS = 10;

export type SuggestedAgendaTopic = {
  id: string;
  title: string;
  notes: string;
  source: "open_task" | "carry_over";
};

export type SuggestionOpenTask = {
  id: string;
  title: string;
  dueAt?: string | null;
  assigneeName?: string | null;
};

export type CarryOverSource = {
  meetingId: string;
  meetingTitle: string;
  startTime?: string | null;
  /** Agenda section titles from the previous meeting. */
  agendaTitles: string[];
  /** Titles of that meeting's tasks that are still open. */
  openTaskTitles: string[];
};

const normalizeTitleKey = (title: unknown): string =>
  normalizePersonNameKey(typeof title === "string" ? title : "");

/**
 * Pick the carry-over source among past-meeting candidates: the most recent
 * (startTime, falling back to createdAt) meeting whose normalized title
 * matches, or — failing that — whose attendees overlap the upcoming
 * meeting's attendees by at least half of the smaller list.
 */
export const findCarryOverMeeting = (
  candidates: any[],
  target: { title?: unknown; attendees?: unknown }
): any | null => {
  const titleKey = normalizeTitleKey(target.title);
  const targetAttendees = normalizeUpcomingAttendees(target.attendees);
  const targetKeys = buildAttendeeKeySets(targetAttendees);

  const withDates = candidates
    .map((candidate) => ({
      candidate,
      date:
        toDateSafe(candidate?.startTime) ??
        toDateSafe(candidate?.createdAt) ??
        null,
    }))
    .sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0));

  if (titleKey) {
    const byTitle = withDates.find(
      ({ candidate }) => normalizeTitleKey(candidate?.title) === titleKey
    );
    if (byTitle) return byTitle.candidate;
  }

  if (targetKeys.emails.size === 0 && targetKeys.nameKeys.size === 0) {
    return null;
  }

  for (const { candidate } of withDates) {
    const attendees = normalizeUpcomingAttendees(candidate?.attendees);
    if (attendees.length === 0) continue;
    let shared = 0;
    for (const attendee of attendees) {
      const matchesEmail = attendee.email
        ? targetKeys.emails.has(attendee.email)
        : false;
      const nameKey = attendee.name
        ? normalizePersonNameKey(attendee.name)
        : "";
      const matchesName = nameKey ? targetKeys.nameKeys.has(nameKey) : false;
      if (matchesEmail || matchesName) shared += 1;
    }
    const smaller = Math.min(attendees.length, targetAttendees.length || 1);
    if (shared > 0 && shared >= Math.ceil(smaller / 2)) {
      return candidate;
    }
  }
  return null;
};

/** Build the CarryOverSource payload from a chosen past meeting doc. */
export const buildCarryOverSource = (
  meeting: any,
  openTaskTitles: string[]
): CarryOverSource => {
  const start = toDateSafe(meeting?.startTime);
  return {
    meetingId: String(meeting?._id ?? meeting?.id ?? ""),
    meetingTitle:
      (typeof meeting?.title === "string" && meeting.title.trim()) || "Meeting",
    startTime: start ? start.toISOString() : null,
    agendaTitles: readMeetingAgenda(meeting).map((section) => section.title),
    openTaskTitles: openTaskTitles
      .map((title) => (typeof title === "string" ? title.trim() : ""))
      .filter(Boolean),
  };
};

const formatDueDate = (value?: string | null): string | null => {
  const date = toDateSafe(value);
  if (!date) return null;
  return date.toISOString().slice(0, 10);
};

/**
 * Deterministic suggested topics:
 *  - "Review: <task>" for each open task assigned to an attendee.
 *  - "Carry-over: <item>" for the previous meeting's agenda sections and
 *    still-open tasks.
 * Deduped by normalized title, capped at MAX_SUGGESTED_TOPICS. IDs are
 * stable (`suggest-open-task-<taskId>` / `suggest-carry-<n>`) so a
 * confirm-checklist UI can key on them.
 */
export const buildSuggestedAgendaTopics = ({
  openTasks,
  carryOver,
}: {
  openTasks: SuggestionOpenTask[];
  carryOver?: CarryOverSource | null;
}): SuggestedAgendaTopic[] => {
  const topics: SuggestedAgendaTopic[] = [];
  const seen = new Set<string>();

  const push = (topic: SuggestedAgendaTopic) => {
    const key = normalizeTitleKey(topic.title);
    if (!key || seen.has(key)) return;
    seen.add(key);
    topics.push(topic);
  };

  for (const task of openTasks) {
    const title = (task.title || "").trim();
    if (!title) continue;
    const due = formatDueDate(task.dueAt);
    const noteParts = ["Open task"];
    if (task.assigneeName?.trim()) {
      noteParts.push(`for ${task.assigneeName.trim()}`);
    }
    if (due) noteParts.push(`due ${due}`);
    push({
      id: `suggest-open-task-${task.id}`,
      title: `Review: ${title}`,
      notes: noteParts.join(" "),
      source: "open_task",
    });
  }

  if (carryOver) {
    const fromNote = `Carried over from "${carryOver.meetingTitle}"`;
    let index = 0;
    for (const item of [
      ...carryOver.agendaTitles,
      ...carryOver.openTaskTitles,
    ]) {
      const title = (item || "").trim();
      if (!title) continue;
      push({
        id: `suggest-carry-${carryOver.meetingId}-${index}`,
        title: `Carry-over: ${title}`,
        notes: fromNote,
        source: "carry_over",
      });
      index += 1;
    }
  }

  return topics.slice(0, MAX_SUGGESTED_TOPICS);
};
