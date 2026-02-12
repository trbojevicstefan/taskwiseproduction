import type { ExtractedTaskSchema } from "@/types/chat";
import type { Meeting } from "@/types/meeting";
import type { Person } from "@/types/person";

export type BriefContext = {
  primaryTranscript?: string | null;
  relatedTranscripts?: string[];
};

const MAX_PRIMARY_TRANSCRIPT_CHARS = 7000;
const MAX_RELATED_TRANSCRIPT_CHARS = 2800;

const normalize = (value?: string | null) =>
  (value || "").trim().toLowerCase();

const getTaskKeywords = (task: ExtractedTaskSchema) => {
  const source = `${task.title || ""} ${task.description || ""} ${task.assignee?.name || ""} ${task.assigneeName || ""}`
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4);

  const unique = new Set<string>();
  source.forEach((token) => {
    if (!unique.has(token) && unique.size < 12) unique.add(token);
  });
  return Array.from(unique);
};

const clipTranscript = (
  transcript: string | null | undefined,
  maxChars: number,
  keywords: string[]
) => {
  const value = transcript?.trim();
  if (!value) return null;
  if (value.length <= maxChars) return value;

  const lower = value.toLowerCase();
  let focusIndex = -1;
  for (const keyword of keywords) {
    const idx = lower.indexOf(keyword);
    if (idx >= 0) {
      focusIndex = idx;
      break;
    }
  }

  if (focusIndex < 0) {
    return `${value.slice(0, maxChars).trim()} ...`;
  }

  const preWindow = Math.floor(maxChars * 0.35);
  let start = Math.max(0, focusIndex - preWindow);
  const end = Math.min(value.length, start + maxChars);
  start = Math.max(0, end - maxChars);

  let excerpt = value.slice(start, end).trim();
  if (start > 0) excerpt = `... ${excerpt}`;
  if (end < value.length) excerpt = `${excerpt} ...`;
  return excerpt;
};

const getMeetingTranscript = (meeting?: Meeting | null) => {
  if (!meeting) return null;
  const direct = meeting.originalTranscript?.trim();
  if (direct) return direct;
  const artifact = meeting.artifacts?.find(
    (item) => item.type === "transcript" && item.processedText?.trim()
  );
  return artifact?.processedText?.trim() || null;
};

const collectAssigneeKeys = (
  task: ExtractedTaskSchema,
  people: Person[] = []
) => {
  const names = new Set<string>();
  const emails = new Set<string>();
  const rawName = task.assignee?.name || task.assigneeName || null;
  const rawEmail = task.assignee?.email || null;
  if (rawName) names.add(normalize(rawName));
  if (rawEmail) emails.add(normalize(rawEmail));

  const assigneeId = task.assignee?.uid || task.assignee?.id;
  const personMatch =
    (assigneeId
      ? people.find((person) => person.id === assigneeId) || null
      : null) ||
    (rawEmail
      ? people.find((person) => {
          const email = person.email?.toLowerCase?.();
          if (email && email === normalize(rawEmail)) return true;
          return (person.aliases || []).some(
            (alias) => normalize(alias) === normalize(rawEmail)
          );
        }) || null
      : null) ||
    (rawName
      ? people.find((person) => normalize(person.name) === normalize(rawName)) ||
        null
      : null);

  if (personMatch) {
    if (personMatch.name) names.add(normalize(personMatch.name));
    if (personMatch.email) emails.add(normalize(personMatch.email));
    (personMatch.aliases || []).forEach((alias) => {
      const normalized = normalize(alias);
      if (normalized) emails.add(normalized);
    });
  }

  return { names, emails };
};

const meetingMatchesAssignee = (
  meeting: Meeting,
  keys: { names: Set<string>; emails: Set<string> }
) => {
  if (!keys.names.size && !keys.emails.size) return false;
  return (meeting.attendees || []).some((attendee) => {
    const nameMatch = keys.names.has(normalize(attendee.name));
    const emailMatch = keys.emails.has(normalize(attendee.email));
    return nameMatch || emailMatch;
  });
};

const sortMeetingsByRecency = (items: Meeting[]) => {
  const toTime = (value: unknown) => {
    if (!value) return 0;
    if (
      typeof value === "object" &&
      value !== null &&
      "toMillis" in value &&
      typeof (value as { toMillis?: unknown }).toMillis === "function"
    ) {
      return (value as { toMillis: () => number }).toMillis();
    }
    const date = new Date(value as string | number | Date);
    return Number.isNaN(date.getTime()) ? 0 : date.getTime();
  };
  return [...items].sort((a, b) => {
    const aTime = toTime(a.lastActivityAt ?? a.createdAt);
    const bTime = toTime(b.lastActivityAt ?? b.createdAt);
    return bTime - aTime;
  });
};

export const buildBriefContext = (
  task: ExtractedTaskSchema,
  meetings: Meeting[],
  people: Person[] = [],
  options: { primaryMeetingId?: string | null; maxRelated?: number } = {}
): BriefContext => {
  const keywords = getTaskKeywords(task);
  const maxRelated = options.maxRelated ?? 5;
  const primaryMeetingId = options.primaryMeetingId || task.sourceSessionId;
  const primaryMeeting =
    primaryMeetingId
      ? meetings.find((meeting) => meeting.id === primaryMeetingId) || null
      : null;

  const primaryTranscript = clipTranscript(
    getMeetingTranscript(primaryMeeting),
    MAX_PRIMARY_TRANSCRIPT_CHARS,
    keywords
  );

  const assigneeKeys = collectAssigneeKeys(task, people);
  const matchedMeetings = sortMeetingsByRecency(
    meetings.filter((meeting) => meetingMatchesAssignee(meeting, assigneeKeys))
  );

  const relatedTranscripts: string[] = [];
  const usedMeetingIds = new Set<string>();

  if (primaryMeeting?.id) {
    usedMeetingIds.add(primaryMeeting.id);
  }

  let fallbackPrimary: string | null = null;
  matchedMeetings.forEach((meeting) => {
    if (usedMeetingIds.has(meeting.id)) return;
    const transcript = clipTranscript(
      getMeetingTranscript(meeting),
      MAX_RELATED_TRANSCRIPT_CHARS,
      keywords
    );
    if (!transcript) return;
    if (!primaryTranscript && !fallbackPrimary) {
      fallbackPrimary = transcript;
      usedMeetingIds.add(meeting.id);
      return;
    }
    if (relatedTranscripts.length < maxRelated) {
      relatedTranscripts.push(transcript);
      usedMeetingIds.add(meeting.id);
    }
  });

  return {
    primaryTranscript: primaryTranscript || fallbackPrimary,
    relatedTranscripts,
  };
};
