import { randomUUID } from "crypto";
import { analyzeMeeting } from "@/ai/flows/analyze-meeting-flow";
import { getDb } from "@/lib/db";
import {
  getFathomRecordingHashScope,
  fetchFathomSummary,
  fetchFathomTranscript,
  formatFathomTranscript,
  hashFathomRecordingId,
} from "@/lib/fathom";
import { normalizeTask } from "@/lib/data";
import type { ExtractedTaskSchema } from "@/types/chat";
import type { DbUser } from "@/lib/db/users";
import {
  applyCompletionTargets,
  buildCompletionSuggestions,
  mergeCompletionSuggestions,
} from "@/lib/task-completion";
import { findFathomConnectionById } from "@/lib/fathom-connections";
import { runMeetingIngestionCommand } from "@/lib/services/meeting-ingestion-command";
import { postMeetingAutomationToSlack } from "@/lib/slack-automation";

type FathomIngestResult =
  | { status: "created"; meetingId: string }
  | { status: "duplicate"; meetingId: string }
  | { status: "no_transcript" };

const pickFirst = (...values: Array<string | null | undefined>) =>
  values.find((value: any) => value && value.trim()) || null;

const toDateOrNull = (value: any) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const toNumberOrNull = (value: any) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const normalizeMeetingTitleKey = (value: any) => {
  if (typeof value !== "string") return null;
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || null;
};

const normalizeMeetingUrlKey = (value: any) => {
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

const normalizeDurationBucket = (durationSeconds: number | null) => {
  if (durationSeconds === null) return null;
  const minutes = Math.max(0, Math.round(durationSeconds / 60));
  return String(minutes);
};

const toFiveMinuteBucket = (value: Date | null) => {
  if (!value) return null;
  return String(Math.floor(value.getTime() / (5 * 60 * 1000)));
};

const extractMeetingTitle = (payload: any, fallbackTitle?: string | null) =>
  pickFirst(
    payload?.meeting_title,
    payload?.title,
    payload?.recording?.title,
    payload?.recording_name,
    fallbackTitle
  );

const extractMeetingRecordingUrl = (payload: any) =>
  pickFirst(payload?.url, payload?.meeting_url, payload?.recording?.url);

const extractMeetingShareUrl = (payload: any) =>
  pickFirst(payload?.share_url, payload?.meeting_share_url, payload?.recording?.share_url);

const extractMeetingStartTime = (payload: any) =>
  toDateOrNull(
    payload?.recording_start_time ||
      payload?.start_time ||
      payload?.started_at ||
      payload?.recording?.start_time ||
      payload?.scheduled_start_time
  );

const extractMeetingEndTime = (payload: any) =>
  toDateOrNull(
    payload?.recording_end_time ||
      payload?.end_time ||
      payload?.ended_at ||
      payload?.recording?.end_time ||
      payload?.scheduled_end_time
  );

const extractMeetingDurationSeconds = (payload: any) =>
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

const extractMeetingAttendeeKeysFromPayload = (payload: any) => {
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

const extractMeetingAttendeeKeysFromDocument = (meeting: any) => {
  const sources = [meeting?.attendees, meeting?.people, meeting?.meetingParticipants];
  return collectAttendeeKeys(sources);
};

type MeetingPersonRole = "attendee" | "mentioned";
type MeetingPerson = {
  name: string;
  email?: string;
  title?: string;
  role: MeetingPersonRole;
};

const normalizeEmailValue = (value: unknown) => {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (!email || !email.includes("@")) return null;
  return email;
};

const normalizeTextValue = (value: unknown) => {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
};

const toDisplayNameFromEmail = (email: string) => {
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

const normalizeMeetingPerson = (value: any, role: MeetingPersonRole): MeetingPerson | null => {
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

const mergeMeetingPeopleLists = (...lists: Array<any[] | null | undefined>): MeetingPerson[] => {
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

const extractMeetingAttendeesFromPayload = (payload: any): MeetingPerson[] => {
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

const buildUniqueMeetingPeople = (analysisResult: any, payload: any) => {
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

const extractMeetingOrganizerEmail = (payload: any) => {
  const candidate = pickFirst(
    payload?.organizer_email,
    payload?.organizer?.email,
    payload?.host?.email,
    payload?.owner?.email,
    payload?.recording?.organizer_email,
    payload?.recording?.organizer?.email,
    payload?.recording?.host?.email,
    payload?.recording?.owner?.email
  );
  return normalizeEmailValue(candidate);
};

const computeAttendeeOverlapRatio = (a: string[], b: string[]) => {
  if (!a.length || !b.length) return 0;
  const aSet = new Set(a);
  const bSet = new Set(b);
  let intersection = 0;
  aSet.forEach((key) => {
    if (bSet.has(key)) intersection += 1;
  });
  return intersection / Math.min(aSet.size, bSet.size);
};

const selectBestAttendeeOverlapCandidate = (candidates: any[], incomingAttendeeKeys: string[]) => {
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

const hasStrongFingerprint = (fingerprint: string) =>
  fingerprint.startsWith("recording_url:") || fingerprint.startsWith("share_url:");

type MeetingDedupeFingerprintInput = {
  title?: string | null;
  recordingUrl?: string | null;
  shareUrl?: string | null;
  startTime?: Date | null;
  endTime?: Date | null;
  durationSeconds?: number | null;
};

const buildMeetingDedupeFingerprints = ({
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

const buildMeetingScopeFilter = ({
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

const CROSS_NOTETAKER_DEDUPE_WINDOW_MS = Math.max(
  5 * 60 * 1000,
  Number(process.env.FATHOM_CROSS_NOTETAKER_DEDUPE_WINDOW_MS || 20 * 60 * 1000)
);

const CROSS_NOTETAKER_DEDUPE_DURATION_TOLERANCE_SECONDS = Math.max(
  0,
  Number(process.env.FATHOM_CROSS_NOTETAKER_DEDUPE_DURATION_TOLERANCE_SECONDS || 180)
);

const CROSS_NOTETAKER_ATTENDEE_OVERLAP_MIN = Math.min(
  1,
  Math.max(
    0,
    Number(process.env.FATHOM_CROSS_NOTETAKER_ATTENDEE_OVERLAP_MIN || 0.5)
  )
);

const findCanonicalFathomDuplicate = async ({
  db,
  userId,
  workspaceId,
  dedupeFingerprints,
  incomingAttendeeKeys,
  title,
  startTime,
  durationSeconds,
}: {
  db: any;
  userId: string;
  workspaceId: string | null;
  dedupeFingerprints: string[];
  incomingAttendeeKeys: string[];
  title: string | null;
  startTime: Date | null;
  durationSeconds: number | null;
}) => {
  const meetings = db.collection("meetings");
  const scopeFilter = buildMeetingScopeFilter({ userId, workspaceId });

  if (dedupeFingerprints.length) {
    const incomingFingerprintSet = new Set(dedupeFingerprints);
    const fingerprintCandidates = await meetings
      .find({
      $and: [
        scopeFilter,
        { ingestSource: "fathom" },
        { dedupeFingerprints: { $in: dedupeFingerprints } },
      ],
      })
      .sort({ lastActivityAt: -1, _id: -1 })
      .limit(12)
      .toArray();
    if (fingerprintCandidates.length) {
      const strongMatches: any[] = [];
      const weakMatches: any[] = [];
      for (const candidate of fingerprintCandidates) {
        const candidateFingerprints = Array.isArray(candidate?.dedupeFingerprints)
          ? candidate.dedupeFingerprints.filter((value: any) => typeof value === "string")
          : [];
        const matchedFingerprints = candidateFingerprints.filter((fingerprint: string) =>
          incomingFingerprintSet.has(fingerprint)
        );
        if (!matchedFingerprints.length) continue;
        if (matchedFingerprints.some((fingerprint: string) => hasStrongFingerprint(fingerprint))) {
          strongMatches.push(candidate);
        } else {
          weakMatches.push(candidate);
        }
      }

      if (strongMatches.length > 0) {
        if (strongMatches.length === 1) {
          return strongMatches[0];
        }
        if (incomingAttendeeKeys.length) {
          const bestStrong = selectBestAttendeeOverlapCandidate(
            strongMatches,
            incomingAttendeeKeys
          );
          if (
            bestStrong.candidate &&
            bestStrong.ratio >= CROSS_NOTETAKER_ATTENDEE_OVERLAP_MIN
          ) {
            return bestStrong.candidate;
          }
        }
        return strongMatches[0];
      }

      if (weakMatches.length > 0 && incomingAttendeeKeys.length) {
        const bestWeak = selectBestAttendeeOverlapCandidate(
          weakMatches,
          incomingAttendeeKeys
        );
        if (
          bestWeak.candidate &&
          bestWeak.ratio >= CROSS_NOTETAKER_ATTENDEE_OVERLAP_MIN
        ) {
          return bestWeak.candidate;
        }
      }
    }
  }

  if (!startTime || !title) {
    return null;
  }

  const rangeStart = new Date(startTime.getTime() - CROSS_NOTETAKER_DEDUPE_WINDOW_MS);
  const rangeEnd = new Date(startTime.getTime() + CROSS_NOTETAKER_DEDUPE_WINDOW_MS);
  const titleRegex = new RegExp(`^${escapeRegex(title.trim())}$`, "i");

  const titleTimeMatches = await meetings
    .find({
    $and: [
      scopeFilter,
      { ingestSource: "fathom" },
      { title: titleRegex },
      { startTime: { $gte: rangeStart, $lte: rangeEnd } },
      ...(durationSeconds === null
        ? []
        : [
            {
              duration: {
                $gte: durationSeconds - CROSS_NOTETAKER_DEDUPE_DURATION_TOLERANCE_SECONDS,
                $lte: durationSeconds + CROSS_NOTETAKER_DEDUPE_DURATION_TOLERANCE_SECONDS,
              },
            },
          ]),
    ],
    })
    .sort({ lastActivityAt: -1, _id: -1 })
    .limit(12)
    .toArray();

  if (!titleTimeMatches.length || !incomingAttendeeKeys.length) {
    return null;
  }

  const bestTitleTimeMatch = selectBestAttendeeOverlapCandidate(
    titleTimeMatches,
    incomingAttendeeKeys
  );
  if (
    bestTitleTimeMatch.candidate &&
    bestTitleTimeMatch.ratio >= CROSS_NOTETAKER_ATTENDEE_OVERLAP_MIN
  ) {
    return bestTitleTimeMatch.candidate;
  }

  return null;
};

const sanitizeLevels = (levels: any) =>
  levels
    ? {
        light: (levels.light || []).map((task: any) =>
          normalizeTask(task as ExtractedTaskSchema)
        ),
        medium: (levels.medium || []).map((task: any) =>
          normalizeTask(task as ExtractedTaskSchema)
        ),
        detailed: (levels.detailed || []).map((task: any) =>
          normalizeTask(task as ExtractedTaskSchema)
        ),
      }
    : null;

const resolveDetailLevel = (user: DbUser): "light" | "medium" | "detailed" => {
  const preference = user.taskGranularityPreference;
  if (preference === "light" || preference === "medium" || preference === "detailed") {
    return preference;
  }
  return "medium";
};

const resolveCompletionMatchThreshold = (user: DbUser): number => {
  const value = user.completionMatchThreshold;
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.min(0.95, Math.max(0.4, value));
  }
  return 0.6;
};

const resolveCompletionAuditModel = () =>
  process.env.COMPLETION_AUDIT_MODEL ||
  process.env.OPENAI_COMPLETION_AUDIT_MODEL ||
  process.env.OPENAI_MODEL ||
  "gpt-4o-mini";

const DUPLICATE_REANALYZE_MAX_AGE_MS = Math.max(
  0,
  Number(process.env.FATHOM_DUPLICATE_REANALYZE_MAX_AGE_MS || 1000 * 60 * 60 * 24)
);

let meetingRecordingHashIndexPromise: Promise<void> | null = null;

const isDuplicateKeyError = (error: any) => {
  if (!error) return false;
  if (error.code === 11000) return true;
  if (Array.isArray(error.writeErrors)) {
    return error.writeErrors.some((entry: any) => entry?.code === 11000);
  }
  const message = String(error.message || "");
  return message.includes("E11000 duplicate key error");
};

const ensureMeetingRecordingHashIndex = async (db: any) => {
  if (meetingRecordingHashIndexPromise) {
    await meetingRecordingHashIndexPromise;
    return;
  }

  meetingRecordingHashIndexPromise = (async () => {
    const meetings = db.collection("meetings");
    if (!meetings || typeof meetings.createIndex !== "function") {
      return;
    }

    try {
      await meetings.createIndex(
        { userId: 1, recordingIdHash: 1 },
        {
          unique: true,
          name: "meetings_user_recording_hash_unique",
          partialFilterExpression: { recordingIdHash: { $type: "string" } },
        }
      );
    } catch (error) {
      // Keep ingestion available even if index creation fails (e.g. existing dupes).
      console.warn("Failed to ensure meeting recording hash unique index:", error);
    }

    try {
      await meetings.createIndex(
        { userId: 1, recordingIdHashes: 1 },
        {
          name: "meetings_user_recording_hashes_idx",
          sparse: true,
          partialFilterExpression: { recordingIdHashes: { $exists: true } },
        }
      );
    } catch (error) {
      console.warn("Failed to ensure meeting recording hash aliases index:", error);
    }

    try {
      await meetings.createIndex(
        { userId: 1, workspaceId: 1, startTime: -1, ingestSource: 1 },
        { name: "meetings_user_workspace_start_ingest_idx" }
      );
    } catch (error) {
      console.warn("Failed to ensure meeting start-time dedupe index:", error);
    }

    try {
      await meetings.createIndex(
        { userId: 1, dedupeFingerprints: 1 },
        {
          name: "meetings_user_dedupe_fingerprints_idx",
          sparse: true,
          partialFilterExpression: { dedupeFingerprints: { $exists: true } },
        }
      );
    } catch (error) {
      console.warn("Failed to ensure meeting dedupe fingerprint index:", error);
    }
  })();

  await meetingRecordingHashIndexPromise;
};

const resolveSummaryText = (payload: any, summaryPayload: any) => {
  const payloadSummary =
    payload?.default_summary?.markdown_formatted ||
    payload?.default_summary?.markdownFormatted ||
    payload?.summary ||
    payload?.recording?.summary;
  const payloadSummaryText =
    typeof payloadSummary === "string"
      ? payloadSummary
      : payloadSummary?.markdown_formatted ||
        payloadSummary?.markdownFormatted ||
        payloadSummary?.text ||
        payloadSummary?.summary ||
        null;
  const summaryText =
    typeof summaryPayload === "string"
      ? summaryPayload
      : summaryPayload?.markdown_formatted ||
        summaryPayload?.markdownFormatted ||
        summaryPayload?.text ||
        summaryPayload?.summary ||
        null;
  return pickFirst(payloadSummaryText, summaryText);
};

const selectTasksForLevel = (
  allTaskLevels: any,
  detailLevel: "light" | "medium" | "detailed"
) => {
  if (!allTaskLevels) return [];
  return (
    allTaskLevels[detailLevel] ||
    allTaskLevels.medium ||
    allTaskLevels.light ||
    allTaskLevels.detailed ||
    []
  );
};

const shouldAutoApproveSuggestion = (
  task: ExtractedTaskSchema,
  minMatchRatio: number
) => {
  if (!task.completionSuggested) return false;
  const confidence =
    typeof task.completionConfidence === "number" &&
    Number.isFinite(task.completionConfidence)
      ? task.completionConfidence
      : null;
  if (confidence === null) return false;
  return confidence >= minMatchRatio;
};

const applyAutoApprovalFlags = (
  tasks: ExtractedTaskSchema[],
  minMatchRatio: number
) => {
  const walk = (items: ExtractedTaskSchema[]): ExtractedTaskSchema[] =>
    items.map((task: any) => {
      const nextTask = {
        ...task,
        subtasks: task.subtasks ? walk(task.subtasks) : task.subtasks,
      };
      if (shouldAutoApproveSuggestion(nextTask, minMatchRatio)) {
        return { ...nextTask, status: "done", completionSuggested: false };
      }
      return nextTask;
    });
  return walk(tasks);
};

export const ingestFathomMeeting = async ({
  user,
  recordingId,
  connectionId,
  providerSourceId,
  data,
  accessToken,
}: {
  user: DbUser;
  recordingId: string;
  connectionId?: string | null;
  providerSourceId?: string | null;
  data?: any;
  accessToken: string;
}): Promise<FathomIngestResult> => {
  const db = await getDb();
  await ensureMeetingRecordingHashIndex(db);
  const userId = user._id.toString();
  const connection = connectionId
    ? await findFathomConnectionById(db as any, connectionId)
    : null;
  const connectionWorkspaceId = connection?.workspaceId || null;
  const ingestWorkspaceId =
    connectionWorkspaceId || user.activeWorkspaceId || user.workspace?.id || null;
  const workspaceScopeFilter = buildMeetingScopeFilter({
    userId,
    workspaceId: ingestWorkspaceId,
  });
  const payload = data || {};
  const meetingTitleFromPayload = extractMeetingTitle(payload);
  const recordingUrlFromPayload = extractMeetingRecordingUrl(payload);
  const shareUrlFromPayload = extractMeetingShareUrl(payload);
  const startTimeFromPayload = extractMeetingStartTime(payload);
  const endTimeFromPayload = extractMeetingEndTime(payload);
  const durationSecondsFromPayload = extractMeetingDurationSeconds(payload);
  const organizerEmailFromPayload = extractMeetingOrganizerEmail(payload);
  const payloadAttendees = extractMeetingAttendeesFromPayload(payload);
  const incomingAttendeeKeys = extractMeetingAttendeeKeysFromPayload(payload);
  const dedupeFingerprintsFromPayload = buildMeetingDedupeFingerprints({
    title: meetingTitleFromPayload,
    recordingUrl: recordingUrlFromPayload,
    shareUrl: shareUrlFromPayload,
    startTime: startTimeFromPayload,
    endTime: endTimeFromPayload,
    durationSeconds: durationSecondsFromPayload,
  });
  const recordingHashScope = getFathomRecordingHashScope({ userId, connectionId });
  const legacyRecordingHashScope = getFathomRecordingHashScope({ userId });
  const recordingIdHash = hashFathomRecordingId(recordingHashScope, recordingId);
  const legacyRecordingIdHash = connectionId
    ? hashFathomRecordingId(legacyRecordingHashScope, recordingId)
    : null;
  const candidateRecordingHashes = Array.from(
    new Set([recordingIdHash, legacyRecordingIdHash].filter(Boolean))
  ) as string[];
  const recordingHashMatcher =
    candidateRecordingHashes.length > 1
      ? { recordingIdHash: { $in: candidateRecordingHashes } }
      : { recordingIdHash: candidateRecordingHashes[0] };

  let existing = await db
    .collection("meetings")
    .findOne({
      $and: [
        workspaceScopeFilter,
        {
          $or: [
            recordingHashMatcher,
            { recordingIdHashes: { $in: candidateRecordingHashes } },
            { recordingId },
          ],
        },
      ],
    });
  if (!existing) {
    existing = await findCanonicalFathomDuplicate({
      db,
      userId,
      workspaceId: ingestWorkspaceId,
      dedupeFingerprints: dedupeFingerprintsFromPayload,
      incomingAttendeeKeys,
      title: meetingTitleFromPayload,
      startTime: startTimeFromPayload,
      durationSeconds: durationSecondsFromPayload,
    });
  }
  if (existing) {
    const existingRecordingIdHashes = Array.isArray(existing.recordingIdHashes)
      ? existing.recordingIdHashes.filter((value: any) => typeof value === "string")
      : [];
    const mergedRecordingIdHashes = Array.from(
      new Set([...existingRecordingIdHashes, ...candidateRecordingHashes])
    );
    const existingDedupeFingerprints = Array.isArray(existing.dedupeFingerprints)
      ? existing.dedupeFingerprints.filter((value: any) => typeof value === "string")
      : [];
    const mergedDedupeFingerprints = Array.from(
      new Set([...existingDedupeFingerprints, ...dedupeFingerprintsFromPayload])
    );
    const update: Record<string, any> = {
      lastActivityAt: new Date(),
      ingestSource: existing.ingestSource || "fathom",
    };
    if (!existing.recordingIdHash) {
      update.recordingIdHash = recordingIdHash;
    }
    if (mergedRecordingIdHashes.length) {
      update.recordingIdHashes = mergedRecordingIdHashes;
    }
    if (mergedDedupeFingerprints.length) {
      update.dedupeFingerprints = mergedDedupeFingerprints;
    }
    if (connectionId && existing.connectionId !== connectionId) {
      update.connectionId = connectionId;
    }
    if (connectionWorkspaceId && !existing.workspaceId) {
      update.workspaceId = connectionWorkspaceId;
    }
    if (providerSourceId && existing.providerSourceId !== providerSourceId) {
      update.providerSourceId = providerSourceId;
    }
    const existingTranscript =
      typeof existing.originalTranscript === "string"
        ? existing.originalTranscript.trim()
        : "";
    let transcriptText = "";

    if (!existingTranscript) {
      let transcriptPayload =
        payload.transcript ||
        payload.transcript_segments ||
        payload?.recording?.transcript ||
        payload?.recording?.transcript_segments;
      if (!transcriptPayload) {
        transcriptPayload = await fetchFathomTranscript(recordingId, accessToken).catch(
          () => null
        );
      }
      transcriptText = formatFathomTranscript(transcriptPayload);
      if (transcriptText) {
        update.originalTranscript = transcriptText;
      }
    } else {
      transcriptText = existingTranscript;
    }

    const existingSummary =
      typeof existing.summary === "string" ? existing.summary.trim() : "";
    if (!existingSummary) {
      const summaryPayload =
        payload.summary ||
        payload?.recording?.summary ||
        (await fetchFathomSummary(recordingId, accessToken).catch(() => null));
      const summaryText = resolveSummaryText(payload, summaryPayload);
      if (summaryText) {
        update.summary = summaryText;
      }
    }

    const recordingUrl = recordingUrlFromPayload;
    if (recordingUrl && !existing.recordingUrl) {
      update.recordingUrl = recordingUrl;
    }
    const shareUrl = shareUrlFromPayload;
    if (shareUrl && !existing.shareUrl) {
      update.shareUrl = shareUrl;
    }

    const startTime = startTimeFromPayload;
    if (startTime && !existing.startTime) {
      update.startTime = startTime;
    }
    const endTime = endTimeFromPayload;
    if (endTime && !existing.endTime) {
      update.endTime = endTime;
    }
    const duration = durationSecondsFromPayload;
    if (duration && !existing.duration) {
      update.duration = duration;
    }
    if (organizerEmailFromPayload && !existing.organizerEmail) {
      update.organizerEmail = organizerEmailFromPayload;
    }
    if (payloadAttendees.length) {
      const mergedAttendees = mergeMeetingPeopleLists(existing.attendees, payloadAttendees);
      if (mergedAttendees.length) {
        update.attendees = mergedAttendees;
      }
    }

    const updateOps: Record<string, any> = { $set: update };
    if (existing.recordingId) {
      updateOps.$unset = { recordingId: "" };
    }

    await db.collection("meetings").updateOne(
      { _id: existing._id },
      updateOps
    );

    const workspaceId = existing.workspaceId || ingestWorkspaceId || null;
    const hasExistingExtractedTasks =
      Array.isArray(existing.extractedTasks) && existing.extractedTasks.length > 0;
    const hasAlreadyBeenAnalyzed =
      Boolean(existing.analysisAttemptedAt) || existing.state === "tasks_ready";
    const createdAtMs = new Date(existing.createdAt || 0).getTime();
    const isStaleDuplicateMeeting =
      Number.isFinite(createdAtMs) &&
      createdAtMs > 0 &&
      Date.now() - createdAtMs > DUPLICATE_REANALYZE_MAX_AGE_MS;
    const shouldReanalyze =
      !existingTranscript ||
      (!isStaleDuplicateMeeting &&
        !hasAlreadyBeenAnalyzed &&
        (!hasExistingExtractedTasks || !existing.allTaskLevels || !existing.planningSessionId));

    if (shouldReanalyze) {
      if (!transcriptText) {
        return { status: "no_transcript" };
      }

      const summaryPayload =
        payload.summary ||
        payload?.recording?.summary ||
        (await fetchFathomSummary(recordingId, accessToken).catch(() => null));
      const summaryText = resolveSummaryText(payload, summaryPayload);
      const detailLevel = resolveDetailLevel(user);

      const analysisResult = await analyzeMeeting({
        transcript: transcriptText,
        requestedDetailLevel: detailLevel,
      });

      const allTaskLevels = analysisResult.allTaskLevels || null;
      const selectedTasks = selectTasksForLevel(allTaskLevels, detailLevel);

      const sanitizedTasks = selectedTasks.map((task: any) =>
        normalizeTask(task as ExtractedTaskSchema)
      );
      let sanitizedTaskLevels = sanitizeLevels(allTaskLevels);

      const uniquePeople = buildUniqueMeetingPeople(analysisResult, payload);

      const completionMatchThreshold = resolveCompletionMatchThreshold(user);
      // Completion detection is intentionally creation-only.
      // Reanalysis of an existing (duplicate) meeting should not trigger it.
      const completionSuggestions: ExtractedTaskSchema[] = [];

      const shouldAutoApprove = Boolean(user.autoApproveCompletedTasks);
      if (shouldAutoApprove && completionSuggestions.length) {
        const autoApproveSuggestions = completionSuggestions.filter((task: any) =>
          shouldAutoApproveSuggestion(task, completionMatchThreshold)
        );
        if (autoApproveSuggestions.length) {
          await applyCompletionTargets(db, userId, autoApproveSuggestions);
        }
      }

      const mergedTasks = mergeCompletionSuggestions(
        sanitizedTasks,
        completionSuggestions
      );
      const finalizedTasks = shouldAutoApprove
        ? applyAutoApprovalFlags(mergedTasks, completionMatchThreshold)
        : mergedTasks;

      if (sanitizedTaskLevels) {
        sanitizedTaskLevels = {
          light: mergeCompletionSuggestions(
            sanitizedTaskLevels.light || [],
            completionSuggestions
          ),
          medium: mergeCompletionSuggestions(
            sanitizedTaskLevels.medium || [],
            completionSuggestions
          ),
          detailed: mergeCompletionSuggestions(
            sanitizedTaskLevels.detailed || [],
            completionSuggestions
          ),
        };
        if (shouldAutoApprove) {
          sanitizedTaskLevels = {
            light: applyAutoApprovalFlags(
              sanitizedTaskLevels.light || [],
              completionMatchThreshold
            ),
            medium: applyAutoApprovalFlags(
              sanitizedTaskLevels.medium || [],
              completionMatchThreshold
            ),
            detailed: applyAutoApprovalFlags(
              sanitizedTaskLevels.detailed || [],
              completionMatchThreshold
            ),
          };
        }
      }

      const meetingTitle = pickFirst(
        existing.title,
        meetingTitleFromPayload,
        analysisResult.sessionTitle,
        "Fathom Meeting"
      );

      const meetingSummary =
        pickFirst(
          existingSummary,
          analysisResult.meetingSummary,
          analysisResult.chatResponseText,
          summaryText
        ) || "";

      const now = new Date();
      const meetingUpdate: Record<string, any> = {
        lastActivityAt: now,
        title: meetingTitle,
        summary: meetingSummary,
        analysisAttemptedAt: now,
        organizerEmail: existing.organizerEmail || organizerEmailFromPayload || null,
        attendees: uniquePeople,
        extractedTasks: finalizedTasks,
        allTaskLevels: sanitizedTaskLevels,
        originalAiTasks: sanitizedTasks,
        originalAllTaskLevels: sanitizedTaskLevels,
        keyMoments: analysisResult.keyMoments || [],
        overallSentiment: analysisResult.overallSentiment ?? null,
        speakerActivity: analysisResult.speakerActivity || [],
        meetingMetadata: analysisResult.meetingMetadata || undefined,
        state: "tasks_ready",
      };
      const refreshedDedupeFingerprints = buildMeetingDedupeFingerprints({
        title: meetingTitle,
        recordingUrl: recordingUrl || existing.recordingUrl || null,
        shareUrl: shareUrl || existing.shareUrl || null,
        startTime: startTime || existing.startTime || null,
        endTime: endTime || existing.endTime || null,
        durationSeconds:
          (typeof duration === "number" ? duration : null) ??
          toNumberOrNull(existing.duration) ??
          null,
      });
      if (refreshedDedupeFingerprints.length) {
        meetingUpdate.dedupeFingerprints = Array.from(
          new Set([...mergedDedupeFingerprints, ...refreshedDedupeFingerprints])
        );
      }

      // Defer updating chat sessions until after tasks are synced and board items ensured
      const chatSessionId = existing.chatSessionId
        ? String(existing.chatSessionId)
        : null;

      let planningSessionId = existing.planningSessionId
        ? String(existing.planningSessionId)
        : null;
      if (!planningSessionId) {
        planningSessionId = randomUUID();
        meetingUpdate.planningSessionId = planningSessionId;
        await db.collection("planningSessions").insertOne({
          _id: planningSessionId,
          userId,
          workspaceId,
          connectionId: connectionId || existing.connectionId || null,
          providerSourceId: providerSourceId || existing.providerSourceId || null,
          title: `Plan from "${meetingTitle}"`,
          inputText: meetingSummary,
          extractedTasks: finalizedTasks,
          originalAiTasks: sanitizedTasks,
          originalAllTaskLevels: sanitizedTaskLevels,
          taskRevisions: [],
          folderId: null,
          sourceMeetingId: existing._id.toString(),
          allTaskLevels: sanitizedTaskLevels,
          meetingMetadata: analysisResult.meetingMetadata || undefined,
          createdAt: now,
          lastActivityAt: now,
        });
      } else {
        await db.collection("planningSessions").updateMany(
          {
            userId,
            $or: [
              { _id: planningSessionId },
              { id: planningSessionId },
            ],
          },
          {
            $set: {
              connectionId: connectionId || existing.connectionId || null,
              providerSourceId: providerSourceId || existing.providerSourceId || null,
              title: `Plan from "${meetingTitle}"`,
              inputText: meetingSummary,
              extractedTasks: finalizedTasks,
              originalAiTasks: sanitizedTasks,
              originalAllTaskLevels: sanitizedTaskLevels,
              allTaskLevels: sanitizedTaskLevels,
              meetingMetadata: analysisResult.meetingMetadata || undefined,
              lastActivityAt: now,
            },
          }
        );
      }

      await db.collection("meetings").updateOne(
        { _id: existing._id },
        { $set: meetingUpdate }
      );

      await runMeetingIngestionCommand(db, {
        mode: "flagged-event",
        eventType: "meeting.updated",
        userId,
        payload: {
          meetingId: String(existing._id),
          workspaceId,
          title: meetingTitle,
          attendees: uniquePeople,
          extractedTasks: finalizedTasks,
        },
      });

      // Now that tasks are synced and board items exist, attach canonical ids to chat session suggested tasks
      if (chatSessionId) {
        try {
          const sourceIds = finalizedTasks
            .map((t: any) => t.id)
            .filter(Boolean);
          if (sourceIds.length) {
            const tasks = await db
              .collection("tasks")
              .find({ userId, sourceTaskId: { $in: sourceIds } })
              .project({ _id: 1, sourceTaskId: 1 })
              .toArray();
            const map = new Map(tasks.map((r: any) => [String(r.sourceTaskId), String(r._id)]));
            const augmented = finalizedTasks.map((t: any) => ({
              ...t,
              taskCanonicalId: map.get(t.id) || undefined,
            }));
            await db.collection("chatSessions").updateMany(
              {
                userId,
                $or: [{ _id: chatSessionId }, { id: chatSessionId }],
              },
              {
                $set: {
                  title: `Chat about "${meetingTitle}"`,
                  suggestedTasks: augmented,
                  originalAiTasks: sanitizedTasks,
                  originalAllTaskLevels: sanitizedTaskLevels,
                  people: uniquePeople,
                  allTaskLevels: sanitizedTaskLevels,
                  meetingMetadata: analysisResult.meetingMetadata || undefined,
                  lastActivityAt: now,
                },
              }
            );
          }
        } catch (error) {
          console.error("Failed to attach canonical ids to chat sessions:", error);
        }
      }

      await postMeetingAutomationToSlack({
        user,
        meetingTitle: meetingTitle || "Meeting",
        meetingSummary,
        tasks: finalizedTasks,
      });
    } else if (Array.isArray(existing.extractedTasks) && existing.extractedTasks.length) {
      const attendeesForUpdate = mergeMeetingPeopleLists(
        existing.attendees,
        payloadAttendees
      );
      await runMeetingIngestionCommand(db, {
        mode: "flagged-event",
        eventType: "meeting.updated",
        userId,
        payload: {
          meetingId: String(existing._id),
          workspaceId,
          title: existing.title || "Meeting",
          attendees: attendeesForUpdate,
          extractedTasks: existing.extractedTasks as ExtractedTaskSchema[],
        },
      });
    }
    return { status: "duplicate", meetingId: existing._id.toString() };
  }

  let transcriptPayload =
    payload.transcript ||
    payload.transcript_segments ||
    payload?.recording?.transcript ||
    payload?.recording?.transcript_segments;
  if (!transcriptPayload) {
    transcriptPayload = await fetchFathomTranscript(recordingId, accessToken);
  }

  const transcriptText = formatFathomTranscript(transcriptPayload);
  if (!transcriptText) {
    return { status: "no_transcript" };
  }

  const summaryPayload =
    payload.summary ||
    payload?.recording?.summary ||
    (await fetchFathomSummary(recordingId, accessToken).catch(() => null));
  const summaryText = resolveSummaryText(payload, summaryPayload);

  const detailLevel = resolveDetailLevel(user);
  const workspaceId = ingestWorkspaceId;
  const analysisResult = await analyzeMeeting({
    transcript: transcriptText,
    requestedDetailLevel: detailLevel,
  });

  const allTaskLevels = analysisResult.allTaskLevels || null;
  const selectedTasks = selectTasksForLevel(allTaskLevels, detailLevel);

  const sanitizedTasks = selectedTasks.map((task: any) =>
    normalizeTask(task as ExtractedTaskSchema)
  );
  let sanitizedTaskLevels = sanitizeLevels(allTaskLevels);

  const uniquePeople = buildUniqueMeetingPeople(analysisResult, payload);

  const completionMatchThreshold = resolveCompletionMatchThreshold(user);
  const completionSummary =
    pickFirst(
      analysisResult.meetingSummary,
      analysisResult.chatResponseText,
      summaryText
    ) || "";
  const completionSuggestions = await buildCompletionSuggestions({
    userId,
    transcript: transcriptText,
    summary: completionSummary,
    attendees: uniquePeople,
    workspaceId,
    requireAttendeeMatch: false,
    minMatchRatio: completionMatchThreshold,
  });

  const shouldAutoApprove = Boolean(user.autoApproveCompletedTasks);
  if (shouldAutoApprove && completionSuggestions.length) {
    const autoApproveSuggestions = completionSuggestions.filter((task: any) =>
      shouldAutoApproveSuggestion(task, completionMatchThreshold)
    );
    if (autoApproveSuggestions.length) {
      await applyCompletionTargets(db, userId, autoApproveSuggestions);
    }
  }

  const mergedTasks = mergeCompletionSuggestions(
    sanitizedTasks,
    completionSuggestions
  );
  const finalizedTasks = shouldAutoApprove
    ? applyAutoApprovalFlags(mergedTasks, completionMatchThreshold)
    : mergedTasks;

  if (sanitizedTaskLevels) {
    sanitizedTaskLevels = {
      light: mergeCompletionSuggestions(
        sanitizedTaskLevels.light || [],
        completionSuggestions
      ),
      medium: mergeCompletionSuggestions(
        sanitizedTaskLevels.medium || [],
        completionSuggestions
      ),
      detailed: mergeCompletionSuggestions(
        sanitizedTaskLevels.detailed || [],
        completionSuggestions
      ),
    };
    if (shouldAutoApprove) {
      sanitizedTaskLevels = {
        light: applyAutoApprovalFlags(
          sanitizedTaskLevels.light || [],
          completionMatchThreshold
        ),
        medium: applyAutoApprovalFlags(
          sanitizedTaskLevels.medium || [],
          completionMatchThreshold
        ),
        detailed: applyAutoApprovalFlags(
          sanitizedTaskLevels.detailed || [],
          completionMatchThreshold
        ),
      };
    }
  }

  const meetingTitle = pickFirst(
    meetingTitleFromPayload,
    analysisResult.sessionTitle,
    "Fathom Meeting"
  );

  const meetingSummary =
    pickFirst(
      analysisResult.meetingSummary,
      analysisResult.chatResponseText,
      summaryText
    ) || "";

  const now = new Date();
  const meetingId = randomUUID();
  const planId = randomUUID();

  const meeting = {
    _id: meetingId,
    userId,
    workspaceId,
    connectionId: connectionId || null,
    providerSourceId: providerSourceId || null,
    title: meetingTitle,
    originalTranscript: transcriptText,
    summary: meetingSummary,
    attendees: uniquePeople,
    extractedTasks: finalizedTasks,
    originalAiTasks: sanitizedTasks,
    originalAllTaskLevels: sanitizedTaskLevels,
    taskRevisions:
      sanitizedTasks.length > 0
        ? [
            {
              id: randomUUID(),
              createdAt: Date.now(),
              source: "ai",
              summary: "Initial AI extraction",
              tasksSnapshot: sanitizedTasks,
            },
          ]
        : [],
    chatSessionId: null,
    planningSessionId: planId,
    allTaskLevels: sanitizedTaskLevels,
    keyMoments: analysisResult.keyMoments || [],
    overallSentiment: analysisResult.overallSentiment ?? null,
    speakerActivity: analysisResult.speakerActivity || [],
    meetingMetadata: analysisResult.meetingMetadata || undefined,
    recordingIdHash,
    recordingIdHashes: candidateRecordingHashes,
    dedupeFingerprints: dedupeFingerprintsFromPayload,
    recordingUrl: recordingUrlFromPayload,
    organizerEmail: organizerEmailFromPayload,
    ingestSource: "fathom",
    fathomNotificationReadAt: null,
    shareUrl: shareUrlFromPayload,
    startTime: startTimeFromPayload,
    endTime: endTimeFromPayload,
    duration: durationSecondsFromPayload,
    state: "tasks_ready",
    analysisAttemptedAt: now,
    completionAuditAttemptedAt: now,
    completionAuditModel: resolveCompletionAuditModel(),
    completionAuditSuggestionCount: completionSuggestions.length,
    createdAt: now,
    lastActivityAt: now,
  };

  const planningSession = {
    _id: planId,
    userId,
    workspaceId,
    connectionId: connectionId || null,
    providerSourceId: providerSourceId || null,
    title: `Plan from "${meetingTitle}"`,
    inputText: meetingSummary,
    extractedTasks: finalizedTasks,
    originalAiTasks: sanitizedTasks,
    originalAllTaskLevels: sanitizedTaskLevels,
    taskRevisions: [],
    folderId: null,
    sourceMeetingId: meetingId as string,
    allTaskLevels: sanitizedTaskLevels,
    meetingMetadata: analysisResult.meetingMetadata || undefined,
    createdAt: now,
    lastActivityAt: now,
  };

  const meetingsCollection = db.collection("meetings");
  let insertedMeeting = false;
  let canonicalMeetingId: string = meetingId;

  // Ensure idempotent insertion: upsert by userId + recordingIdHash to avoid duplicates
  if (meeting.recordingIdHash) {
    const recordingHashFilter =
      candidateRecordingHashes.length > 1
        ? { recordingIdHash: { $in: candidateRecordingHashes } }
        : { recordingIdHash: candidateRecordingHashes[0] };
    const filter = {
      $and: [
        workspaceScopeFilter,
        {
          $or: [
            recordingHashFilter,
            { recordingIdHashes: { $in: candidateRecordingHashes } },
            { recordingId },
          ],
        },
      ],
    };
    const resolveCanonicalMeetingId = async () => {
      const existingMeeting = await meetingsCollection.findOne(filter, {
        projection: { _id: 1 },
      });
      return existingMeeting?._id ? String(existingMeeting._id) : null;
    };

    try {
      const { _id: insertId } = meeting;
      const setFields: Record<string, any> = { ...meeting };
      delete setFields._id;
      // Avoid conflicting updates when using $setOnInsert for createdAt
      delete setFields.createdAt;
      const upsertResult = await meetingsCollection.updateOne(
        filter,
        { $set: setFields, $setOnInsert: { createdAt: meeting.createdAt, _id: insertId } },
        { upsert: true }
      );

      if (upsertResult.upsertedId) {
        insertedMeeting = true;
        canonicalMeetingId = String(upsertResult.upsertedId);
      } else {
        canonicalMeetingId = (await resolveCanonicalMeetingId()) || canonicalMeetingId;
      }
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        canonicalMeetingId = (await resolveCanonicalMeetingId()) || canonicalMeetingId;
      } else {
        // Fallback to a plain insert if something unexpected happens
        console.error("Meeting upsert failed, falling back to insert:", error);
        await meetingsCollection.insertOne(meeting);
        insertedMeeting = true;
      }
    }
  } else {
    await meetingsCollection.insertOne(meeting);
    insertedMeeting = true;
  }

  if (!insertedMeeting) {
    return { status: "duplicate", meetingId: canonicalMeetingId };
  }

  planningSession.sourceMeetingId = canonicalMeetingId;

  await db.collection("planningSessions").insertOne(planningSession);
  await runMeetingIngestionCommand(db, {
    mode: "flagged-event",
    eventType: "meeting.ingested",
    userId,
    payload: {
      meetingId: canonicalMeetingId,
      workspaceId,
      title: meetingTitle,
      attendees: uniquePeople,
      extractedTasks: finalizedTasks,
    },
  });

  await postMeetingAutomationToSlack({
    user,
    meetingTitle: meetingTitle || "Meeting",
    meetingSummary,
    tasks: finalizedTasks,
  });

  return { status: "created", meetingId: canonicalMeetingId };
};
