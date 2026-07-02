import type { ExtractedTaskSchema } from "@/types/chat";

export type MeetingPersonRole = "attendee" | "mentioned";
export type MeetingPerson = {
  name: string;
  email?: string;
  title?: string;
  role: MeetingPersonRole;
};

export const pickFirst = (...values: Array<string | null | undefined>) =>
  values.find((value: any) => value && value.trim()) || null;

export const toDateOrNull = (value: any) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const toNumberOrNull = (value: any) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

export const normalizeMeetingTitleKey = (value: any) => {
  if (typeof value !== "string") return null;
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || null;
};

export const normalizeMeetingUrlKey = (value: any) => {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    parsed.hash = "";
    const path = parsed.pathname.replace(/\/+$/, "");
    const search = parsed.searchParams.toString();
    const normalized = `${parsed.protocol}//${parsed.host}${path || "/"}${
      search ? `?${search}` : ""
    }`.toLowerCase();
    return normalized;
  } catch {
    return raw.replace(/\/+$/, "").toLowerCase();
  }
};

export const normalizeDurationBucket = (durationSeconds: number | null) => {
  if (durationSeconds === null) return null;
  const minutes = Math.max(0, Math.round(durationSeconds / 60));
  return String(minutes);
};

export const toFiveMinuteBucket = (value: Date | null) => {
  if (!value) return null;
  return String(Math.floor(value.getTime() / (5 * 60 * 1000)));
};

export const extractMeetingTitle = (payload: any, fallbackTitle?: string | null) =>
  pickFirst(
    payload?.meeting_title,
    payload?.title,
    payload?.recording?.title,
    payload?.recording_name,
    fallbackTitle
  );

export const extractMeetingRecordingUrl = (payload: any) =>
  pickFirst(payload?.url, payload?.meeting_url, payload?.recording?.url);

export const extractMeetingShareUrl = (payload: any) =>
  pickFirst(payload?.share_url, payload?.meeting_share_url, payload?.recording?.share_url);

export const extractMeetingStartTime = (payload: any) =>
  toDateOrNull(
    payload?.recording_start_time ||
      payload?.start_time ||
      payload?.started_at ||
      payload?.recording?.start_time ||
      payload?.scheduled_start_time
  );

export const extractMeetingEndTime = (payload: any) =>
  toDateOrNull(
    payload?.recording_end_time ||
      payload?.end_time ||
      payload?.ended_at ||
      payload?.recording?.end_time ||
      payload?.scheduled_end_time
  );

export const extractMeetingDurationSeconds = (payload: any) =>
  toNumberOrNull(payload?.duration || payload?.duration_seconds || payload?.recording?.duration);

const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeAttendeeKey = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;
  if (raw.includes("@")) {
    return raw.toLowerCase();
  }
  const normalized = raw
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || null;
};

const collectAttendeeKeys = (values: any[]) => {
  const keys = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    if (Array.isArray(value)) {
      collectAttendeeKeys(value).forEach((key) => keys.add(key));
      continue;
    }
    if (typeof value === "string" || typeof value === "number") {
      const key = normalizeAttendeeKey(value);
      if (key) keys.add(key);
      continue;
    }
    if (typeof value === "object") {
      const candidates = [
        value.name,
        value.fullName,
        value.full_name,
        value.displayName,
        value.display_name,
        value.email,
      ];
      candidates.forEach((candidate) => {
        const key = normalizeAttendeeKey(candidate);
        if (key) keys.add(key);
      });
    }
  }
  return Array.from(keys);
};

export const extractMeetingAttendeeKeysFromPayload = (payload: any) => {
  const sources = [
    payload?.attendees,
    payload?.participants,
    payload?.participant_list,
    payload?.participantList,
    payload?.people,
    payload?.speakers,
    payload?.recording?.attendees,
    payload?.recording?.participants,
    payload?.recording?.participant_list,
    payload?.recording?.participantList,
    payload?.recording?.people,
    payload?.recording?.speakers,
  ];
  return collectAttendeeKeys(sources);
};

export const extractMeetingAttendeeKeysFromDocument = (meeting: any) => {
  const sources = [meeting?.attendees, meeting?.people, meeting?.meetingParticipants];
  return collectAttendeeKeys(sources);
};

export const normalizeEmailValue = (value: unknown) => {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (!email || !email.includes("@")) return null;
  return email;
};

export const normalizeTextValue = (value: unknown) => {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
};

export const toDisplayNameFromEmail = (email: string) => {
  const local = email.split("@")[0] || "Guest";
  const prettified = local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part: any) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
  return prettified || email;
};

const preferPersonName = (current: string, incoming?: string | null) => {
  if (!incoming) return current;
  const currentHasEmail = current.includes("@");
  const incomingHasEmail = incoming.includes("@");
  if (currentHasEmail && !incomingHasEmail) return incoming;
  if (!currentHasEmail && incomingHasEmail) return current;
  return current.length >= incoming.length ? current : incoming;
};

export const normalizeMeetingPerson = (value: any, role: MeetingPersonRole): MeetingPerson | null => {
  if (!value) return null;

  if (typeof value === "string" || typeof value === "number") {
    const raw = String(value).trim();
    if (!raw) return null;
    const email = normalizeEmailValue(raw);
    const name = email ? toDisplayNameFromEmail(email) : normalizeTextValue(raw);
    if (!name) return null;
    return {
      name,
      ...(email ? { email } : {}),
      role,
    };
  }

  if (typeof value !== "object") return null;

  const email = normalizeEmailValue(
    value.email || value.emailAddress || value.email_address || value.mail
  );
  const name =
    normalizeTextValue(
      value.name ||
        value.fullName ||
        value.full_name ||
        value.displayName ||
        value.display_name
    ) || (email ? toDisplayNameFromEmail(email) : null);
  const title = normalizeTextValue(value.title || value.jobTitle || value.job_title);

  if (!name) return null;
  return {
    name,
    ...(email ? { email } : {}),
    ...(title ? { title } : {}),
    role,
  };
};

const getMeetingPersonMergeKey = (person: Partial<MeetingPerson>) => {
  const normalizedName = normalizeAttendeeKey(person.name);
  if (normalizedName) return `name:${normalizedName}`;
  const normalizedEmail = normalizeEmailValue(person.email);
  if (normalizedEmail) return `email:${normalizedEmail}`;
  return null;
};

export const mergeMeetingPeopleLists = (
  ...lists: Array<any[] | null | undefined>
): MeetingPerson[] => {
  const merged = new Map<string, MeetingPerson>();

  lists.forEach((list) => {
    (list || []).forEach((rawPerson) => {
      const normalized = normalizeMeetingPerson(
        rawPerson,
        rawPerson?.role === "mentioned" ? "mentioned" : "attendee"
      );
      if (!normalized) return;
      const key = getMeetingPersonMergeKey(normalized);
      if (!key) return;

      const existing = merged.get(key);
      if (!existing) {
        merged.set(key, normalized);
        return;
      }

      merged.set(key, {
        name: preferPersonName(existing.name, normalized.name),
        email: existing.email || normalized.email,
        title: existing.title || normalized.title,
        role:
          existing.role === "attendee" || normalized.role === "attendee"
            ? "attendee"
            : "mentioned",
      });
    });
  });

  return Array.from(merged.values());
};

export const extractMeetingAttendeesFromPayload = (payload: any): MeetingPerson[] => {
  const sources = [
    payload?.attendees,
    payload?.participants,
    payload?.participant_list,
    payload?.participantList,
    payload?.people,
    payload?.recording?.attendees,
    payload?.recording?.participants,
    payload?.recording?.participant_list,
    payload?.recording?.participantList,
    payload?.recording?.people,
  ];

  const attendees: MeetingPerson[] = [];
  const walk = (value: any) => {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    const normalized = normalizeMeetingPerson(value, "attendee");
    if (normalized) attendees.push(normalized);
  };

  sources.forEach(walk);
  return mergeMeetingPeopleLists(attendees);
};

export const buildUniqueMeetingPeople = (analysisResult: any, payload: any) => {
  const attendeesFromAnalysis = (analysisResult.attendees || []).map((person: any) => ({
    ...person,
    role: "attendee" as const,
  }));
  const payloadAttendees = extractMeetingAttendeesFromPayload(payload);
  const mentionedFromAnalysis = (analysisResult.mentionedPeople || []).map((person: any) => ({
    ...person,
    role: "mentioned" as const,
  }));

  return mergeMeetingPeopleLists(
    attendeesFromAnalysis,
    payloadAttendees,
    mentionedFromAnalysis
  );
};

export const computeAttendeeOverlapRatio = (a: string[], b: string[]) => {
  if (!a.length || !b.length) return 0;
  const aSet = new Set(a);
  const bSet = new Set(b);
  let intersection = 0;
  aSet.forEach((key) => {
    if (bSet.has(key)) intersection += 1;
  });
  return intersection / Math.min(aSet.size, bSet.size);
};

export const selectBestAttendeeOverlapCandidate = (candidates: any[], incomingAttendeeKeys: string[]) => {
  let bestCandidate: any = null;
  let bestRatio = 0;
  for (const candidate of candidates) {
    const candidateAttendeeKeys = extractMeetingAttendeeKeysFromDocument(candidate);
    if (!candidateAttendeeKeys.length) continue;
    const ratio = computeAttendeeOverlapRatio(incomingAttendeeKeys, candidateAttendeeKeys);
    if (ratio > bestRatio) {
      bestRatio = ratio;
      bestCandidate = candidate;
    }
  }
  return { candidate: bestCandidate, ratio: bestRatio };
};

export const hasStrongFingerprint = (fingerprint: string) =>
  fingerprint.startsWith("recording_url:") || fingerprint.startsWith("share_url:");

export type MeetingDedupeFingerprintInput = {
  title?: string | null;
  recordingUrl?: string | null;
  shareUrl?: string | null;
  startTime?: Date | null;
  endTime?: Date | null;
  durationSeconds?: number | null;
};

export const buildMeetingDedupeFingerprints = ({
  title,
  recordingUrl,
  shareUrl,
  startTime,
  endTime,
  durationSeconds,
}: MeetingDedupeFingerprintInput) => {
  const keys = new Set<string>();
  const titleKey = normalizeMeetingTitleKey(title);
  const recordingUrlKey = normalizeMeetingUrlKey(recordingUrl);
  const shareUrlKey = normalizeMeetingUrlKey(shareUrl);
  const durationBucket = normalizeDurationBucket(durationSeconds ?? null);
  const anchors = Array.from(
    new Set([toFiveMinuteBucket(startTime || null), toFiveMinuteBucket(endTime || null)].filter(Boolean))
  ) as string[];

  anchors.forEach((anchor) => {
    if (titleKey) {
      keys.add(`title:${titleKey}|t:${anchor}`);
      if (durationBucket) {
        keys.add(`title:${titleKey}|t:${anchor}|d:${durationBucket}`);
      }
    }
    if (recordingUrlKey) {
      keys.add(`recording_url:${recordingUrlKey}|t:${anchor}`);
    }
    if (shareUrlKey) {
      keys.add(`share_url:${shareUrlKey}|t:${anchor}`);
    }
  });

  return Array.from(keys);
};

export const buildMeetingScopeFilter = ({
  userId,
  workspaceId,
}: {
  userId: string;
  workspaceId: string | null;
}) => {
  if (!workspaceId) {
    return { userId };
  }
  return {
    userId,
    $or: [
      { workspaceId },
      { workspaceId: null },
      { workspaceId: { $exists: false } },
    ],
  };
};
