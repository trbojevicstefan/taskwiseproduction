// src/lib/calendar-event-matching.ts
/**
 * Priority 10 — pure matching between Google Calendar events and Taskwise
 * meetings. Used by the calendar event detail drawer to decide whether an
 * overlay event already has an in-app meeting.
 *
 * Precedence:
 *  1. Stored external event id (`meetings.calendarEventId` === event id).
 *  2. Time proximity (same local day AND start times within
 *     TIME_PROXIMITY_WINDOW_MS) combined with either a normalized-title match
 *     or an organizer/attendee email overlap. When several meetings qualify,
 *     the closest start time wins; title matches beat attendee-only matches.
 *
 * No I/O, no imports — deliberately dependency-free so it is trivially
 * unit-testable and usable from both client and server code.
 */

export interface MatchableEventPerson {
  email?: string | null;
  name?: string | null;
}

export interface MatchableGoogleEvent {
  id: string;
  title: string;
  startTime: string | null;
  organizer?: string | null;
  attendees?: MatchableEventPerson[] | null;
}

export interface MatchableMeeting {
  id: string;
  title: string;
  startTime: string | null;
  calendarEventId?: string | null;
  organizerEmail?: string | null;
  attendees?: MatchableEventPerson[] | null;
}

export type EventMeetingMatchType = "external_id" | "title_time" | "attendee_time";

export interface EventMeetingMatch {
  meetingId: string;
  matchType: EventMeetingMatchType;
}

/** Start times must be within this window (besides the same-day requirement). */
export const TIME_PROXIMITY_WINDOW_MS = 45 * 60 * 1000;

/** Containment-based title matching only kicks in above this length. */
const MIN_TITLE_CONTAINMENT_LENGTH = 4;

const toTime = (value: string | null | undefined): number | null => {
  if (!value || typeof value !== "string") return null;
  const parsed = new Date(value);
  const time = parsed.getTime();
  return Number.isNaN(time) ? null : time;
};

const sameLocalDay = (a: number, b: number): boolean => {
  const dateA = new Date(a);
  const dateB = new Date(b);
  return (
    dateA.getFullYear() === dateB.getFullYear() &&
    dateA.getMonth() === dateB.getMonth() &&
    dateA.getDate() === dateB.getDate()
  );
};

/** Lowercase, strip punctuation, collapse whitespace. Exported for tests. */
export const normalizeEventTitle = (title: string | null | undefined): string => {
  if (!title || typeof title !== "string") return "";
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const titlesMatch = (a: string, b: string): boolean => {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= MIN_TITLE_CONTAINMENT_LENGTH && b.includes(a)) return true;
  if (b.length >= MIN_TITLE_CONTAINMENT_LENGTH && a.includes(b)) return true;
  return false;
};

const collectEmails = (
  people: MatchableEventPerson[] | null | undefined,
  extra?: string | null
): Set<string> => {
  const emails = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value !== "string") return;
    const normalized = value.trim().toLowerCase();
    if (normalized && normalized.includes("@")) emails.add(normalized);
  };
  (people ?? []).forEach((person) => add(person?.email));
  add(extra);
  return emails;
};

const emailsOverlap = (a: Set<string>, b: Set<string>): boolean => {
  if (a.size === 0 || b.size === 0) return false;
  for (const email of a) {
    if (b.has(email)) return true;
  }
  return false;
};

/**
 * Finds the Taskwise meeting that corresponds to a Google Calendar event, or
 * null when nothing matches confidently enough.
 */
export function matchGoogleEventToMeeting(
  event: MatchableGoogleEvent,
  meetings: MatchableMeeting[]
): EventMeetingMatch | null {
  if (!event || !Array.isArray(meetings) || meetings.length === 0) return null;

  const eventId = typeof event.id === "string" ? event.id.trim() : "";
  if (eventId) {
    const byExternalId = meetings.find(
      (meeting) =>
        typeof meeting.calendarEventId === "string" &&
        meeting.calendarEventId.trim() === eventId
    );
    if (byExternalId) {
      return { meetingId: byExternalId.id, matchType: "external_id" };
    }
  }

  const eventTime = toTime(event.startTime);
  if (eventTime === null) return null;

  const eventTitle = normalizeEventTitle(event.title);
  const eventEmails = collectEmails(event.attendees, event.organizer);

  let best: {
    meetingId: string;
    matchType: EventMeetingMatchType;
    distance: number;
  } | null = null;

  for (const meeting of meetings) {
    const meetingTime = toTime(meeting.startTime);
    if (meetingTime === null) continue;
    const distance = Math.abs(meetingTime - eventTime);
    if (distance > TIME_PROXIMITY_WINDOW_MS) continue;
    if (!sameLocalDay(meetingTime, eventTime)) continue;

    const titleHit = titlesMatch(eventTitle, normalizeEventTitle(meeting.title));
    const attendeeHit =
      !titleHit &&
      emailsOverlap(
        eventEmails,
        collectEmails(meeting.attendees, meeting.organizerEmail)
      );
    if (!titleHit && !attendeeHit) continue;

    const matchType: EventMeetingMatchType = titleHit
      ? "title_time"
      : "attendee_time";
    const candidate = { meetingId: meeting.id, matchType, distance };
    if (!best) {
      best = candidate;
      continue;
    }
    // Title matches outrank attendee-only matches; otherwise closest wins.
    const bestIsTitle = best.matchType === "title_time";
    if (titleHit && !bestIsTitle) {
      best = candidate;
    } else if (titleHit === bestIsTitle && distance < best.distance) {
      best = candidate;
    }
  }

  return best ? { meetingId: best.meetingId, matchType: best.matchType } : null;
}
