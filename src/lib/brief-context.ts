import type { ExtractedTaskSchema } from "@/types/chat";
import type { Meeting } from "@/types/meeting";
import type { Person } from "@/types/person";

export type BriefContext = {
  primaryTranscript?: string | null;
  relatedTranscripts?: string[];
  meetingTimeline?: string[];
};

const MAX_PRIMARY_TRANSCRIPT_CHARS = 7000;
const MAX_RELATED_TRANSCRIPT_CHARS = 2800;
const MAX_TIMELINE_ENTRY_CHARS = 460;
const MAX_TIMELINE_TOTAL_CHARS = 2800;
const MAX_TIMELINE_ITEMS = 8;

const normalize = (value?: string | null) =>
  (value || "").trim().toLowerCase();

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
  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  ) {
    const dateFromTimestamp = (value as { toDate: () => Date }).toDate();
    return dateFromTimestamp.getTime();
  }
  const date = new Date(value as string | number | Date);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
};

const formatMeetingDate = (meeting: Meeting) => {
  const timestamp = toTime(
    meeting.startTime ?? meeting.lastActivityAt ?? meeting.createdAt
  );
  if (!timestamp) return "unknown";
  return new Date(timestamp).toISOString().slice(0, 10);
};

const clipText = (value: string, maxChars: number) => {
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) return "";
  if (compact.length <= maxChars) return compact;
  return `${compact.slice(0, maxChars).trim()} ...`;
};

const getTaskKeywords = (task: ExtractedTaskSchema) => {
  const source = `${task.title || ""} ${task.description || ""} ${task.assignee?.name || ""} ${task.assigneeName || ""}`
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((token: any) => token.trim())
    .filter((token: any) => token.length >= 4);

  const unique = new Set<string>();
  source.forEach((token: any) => {
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
      ? people.find((person: any) => person.id === assigneeId) || null
      : null) ||
    (rawEmail
      ? people.find((person: any) => {
          const email = person.email?.toLowerCase?.();
          if (email && email === normalize(rawEmail)) return true;
          return (person.aliases || []).some(
            (alias: any) => normalize(alias) === normalize(rawEmail)
          );
        }) || null
      : null) ||
    (rawName
      ? people.find((person: any) => normalize(person.name) === normalize(rawName)) ||
        null
      : null);

  if (personMatch) {
    if (personMatch.name) names.add(normalize(personMatch.name));
    if (personMatch.email) emails.add(normalize(personMatch.email));
    (personMatch.aliases || []).forEach((alias: any) => {
      const normalized = normalize(alias);
      if (normalized) emails.add(normalized);
    });
  }

  return { names, emails };
};

const meetingTaskMatchesAssignee = (
  task: ExtractedTaskSchema,
  keys: { names: Set<string>; emails: Set<string> }
) => {
  if (!keys.names.size && !keys.emails.size) return false;
  const assigneeName = normalize(task.assignee?.name || task.assigneeName || "");
  const assigneeEmail = normalize(task.assignee?.email || "");
  return keys.names.has(assigneeName) || keys.emails.has(assigneeEmail);
};

const meetingMatchesAssignee = (
  meeting: Meeting,
  keys: { names: Set<string>; emails: Set<string> }
) => {
  if (!keys.names.size && !keys.emails.size) return false;
  return (meeting.attendees || []).some((attendee: any) => {
    const nameMatch = keys.names.has(normalize(attendee.name));
    const emailMatch = keys.emails.has(normalize(attendee.email));
    return nameMatch || emailMatch;
  });
};

const getMeetingTasks = (meeting: Meeting): ExtractedTaskSchema[] => {
  const collected: ExtractedTaskSchema[] = [];
  const visit = (candidate: any) => {
    if (!candidate || typeof candidate !== "object") return;
    if (typeof candidate.id === "string" && typeof candidate.title === "string") {
      collected.push(candidate as ExtractedTaskSchema);
    }
    if (Array.isArray(candidate.subtasks)) {
      candidate.subtasks.forEach(visit);
    }
  };
  (meeting.extractedTasks || []).forEach(visit);
  return collected;
};

const meetingTaskMatchesKeywords = (
  task: ExtractedTaskSchema,
  keywords: string[]
) => {
  if (!keywords.length) return false;
  const haystack = `${task.title || ""} ${task.description || ""} ${task.assignee?.name || ""} ${task.assigneeName || ""}`
    .toLowerCase();
  const keywordHits = keywords.filter((keyword: any) => haystack.includes(keyword))
    .length;
  if (!keywordHits) return false;
  return keywordHits >= (keywords.length > 6 ? 2 : 1);
};

const getRelatedMeetingTasks = (
  meeting: Meeting,
  keywords: string[],
  assigneeKeys: { names: Set<string>; emails: Set<string> }
) =>
  getMeetingTasks(meeting).filter(
    (candidate: any) =>
      meetingTaskMatchesAssignee(candidate, assigneeKeys) ||
      meetingTaskMatchesKeywords(candidate, keywords)
  );

const meetingHasTaskSignals = (
  meeting: Meeting,
  keywords: string[],
  assigneeKeys: { names: Set<string>; emails: Set<string> }
) => getRelatedMeetingTasks(meeting, keywords, assigneeKeys).length > 0;

const statusLabel = (status?: string | null) => {
  if (status === "todo") return "to do";
  if (status === "inprogress") return "in progress";
  if (status === "done") return "done";
  if (status === "recurring") return "recurring";
  return "unknown";
};

const formatTimelineEntry = (
  meeting: Meeting,
  matchedTasks: ExtractedTaskSchema[]
) => {
  const dateLabel = formatMeetingDate(meeting);
  const meetingLabel = clipText(meeting.title || "Untitled meeting", 120);
  const summary = clipText(meeting.summary || "", 170);

  if (!matchedTasks.length) {
    const line = `[${dateLabel}] ${meetingLabel}${
      summary ? ` - ${summary}` : ""
    }`;
    return clipText(line, MAX_TIMELINE_ENTRY_CHARS);
  }

  const taskSignals = matchedTasks
    .slice(0, 3)
    .map((task: any) => {
      const title = clipText(task.title || "Untitled task", 70);
      const dueAt = task.dueAt ? `, due ${clipText(String(task.dueAt), 24)}` : "";
      return `${title} (${statusLabel(task.status)}${dueAt})`;
    })
    .join("; ");

  const countLabel = `${matchedTasks.length} related task${
    matchedTasks.length === 1 ? "" : "s"
  }`;
  const line = `[${dateLabel}] ${meetingLabel} - ${countLabel}. ${taskSignals}${
    summary ? ` | Summary: ${summary}` : ""
  }`;
  return clipText(line, MAX_TIMELINE_ENTRY_CHARS);
};

const sortMeetingsByRecency = (items: Meeting[]) => {
  return [...items].sort((a: any, b: any) => {
    const aTime = toTime(a.lastActivityAt ?? a.createdAt);
    const bTime = toTime(b.lastActivityAt ?? b.createdAt);
    return bTime - aTime;
  });
};

export const buildBriefContext = (
  task: ExtractedTaskSchema,
  meetings: Meeting[],
  people: Person[] = [],
  options: {
    primaryMeetingId?: string | null;
    maxRelated?: number;
    maxTimeline?: number;
  } = {}
): BriefContext => {
  const keywords = getTaskKeywords(task);
  const maxRelated = options.maxRelated ?? 5;
  const maxTimeline = options.maxTimeline ?? MAX_TIMELINE_ITEMS;
  const primaryMeetingId = options.primaryMeetingId || task.sourceSessionId;
  const primaryMeeting =
    primaryMeetingId
      ? meetings.find((meeting: any) => meeting.id === primaryMeetingId) || null
      : null;

  const primaryTranscript = clipTranscript(
    getMeetingTranscript(primaryMeeting),
    MAX_PRIMARY_TRANSCRIPT_CHARS,
    keywords
  );

  const assigneeKeys = collectAssigneeKeys(task, people);
  const assigneeMatchedMeetings = sortMeetingsByRecency(
    meetings.filter((meeting: any) => meetingMatchesAssignee(meeting, assigneeKeys))
  );
  const taskSignalMeetings = sortMeetingsByRecency(
    meetings.filter((meeting: any) =>
      meetingHasTaskSignals(meeting, keywords, assigneeKeys)
    )
  );

  const candidateMeetings = sortMeetingsByRecency(
    Array.from(
      new Map(
        [primaryMeeting, ...taskSignalMeetings, ...assigneeMatchedMeetings]
          .filter(Boolean)
          .map((meeting: any) => [meeting.id, meeting])
      ).values()
    )
  );

  const fallbackRecentMeetings = sortMeetingsByRecency(meetings);
  const transcriptCandidates = candidateMeetings.length
    ? candidateMeetings
    : fallbackRecentMeetings;

  const relatedTranscripts: string[] = [];
  const usedMeetingIds = new Set<string>();

  if (primaryMeeting?.id) {
    usedMeetingIds.add(primaryMeeting.id);
  }

  let fallbackPrimary: string | null = null;
  transcriptCandidates.forEach((meeting: any) => {
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

  const timelineCandidates = [
    ...(primaryMeeting ? [primaryMeeting] : []),
    ...candidateMeetings,
    ...fallbackRecentMeetings,
  ];
  const timelineMeetingIds = new Set<string>();
  const meetingTimeline: string[] = [];
  let timelineChars = 0;

  timelineCandidates.forEach((meeting: any) => {
    if (!meeting || timelineMeetingIds.has(meeting.id)) return;
    if (meetingTimeline.length >= maxTimeline) return;
    if (timelineChars >= MAX_TIMELINE_TOTAL_CHARS) return;
    timelineMeetingIds.add(meeting.id);

    const matchedTasks = getRelatedMeetingTasks(meeting, keywords, assigneeKeys);
    if (!matchedTasks.length && meetingTimeline.length >= Math.ceil(maxTimeline / 2)) {
      return;
    }
    const timelineEntry = formatTimelineEntry(meeting, matchedTasks);
    if (!timelineEntry) return;

    const remaining = MAX_TIMELINE_TOTAL_CHARS - timelineChars;
    if (remaining <= 0) return;
    if (timelineEntry.length > remaining) {
      meetingTimeline.push(`${timelineEntry.slice(0, remaining).trim()} ...`);
      timelineChars = MAX_TIMELINE_TOTAL_CHARS;
      return;
    }
    meetingTimeline.push(timelineEntry);
    timelineChars += timelineEntry.length;
  });

  return {
    primaryTranscript: primaryTranscript || fallbackPrimary,
    relatedTranscripts,
    meetingTimeline,
  };
};


