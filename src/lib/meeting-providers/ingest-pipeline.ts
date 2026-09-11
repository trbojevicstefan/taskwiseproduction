/**
 * Shared provider-agnostic meeting ingestion pipeline.
 *
 * All generic meeting providers normalize into `NormalizedProviderMeeting`
 * and ride the same idempotent Taskwise meeting -> task/domain-event rail.
 */

import { ApiRouteError } from "@/lib/api-route";
import { findUserById } from "@/lib/db/users";
import {
  getFathomRecordingHashScope,
  hashFathomRecordingId,
} from "@/lib/fathom";
import { ensureMeetingRecordingHashIndex } from "@/lib/fathom-ingest/deduplication";
import { buildCreatedFathomMeetingRecords } from "@/lib/fathom-ingest/meeting-builder";
import { extractFathomMeetingTasks } from "@/lib/fathom-ingest/task-extraction";
import * as ingestHelpers from "@/lib/fathom-ingest-helpers";
import type { StructuredLogger } from "@/lib/observability";
import { runMeetingIngestionCommand } from "@/lib/services/meeting-ingestion-command";
import { postMeetingAutomationToSlack } from "@/lib/slack-automation";
import type { ExtractedTaskSchema } from "@/types/chat";
import type {
  MeetingProviderId,
  NormalizedProviderMeeting,
  NormalizedTranscriptSegment,
} from "@/lib/meeting-providers/types";

export type ProviderIngestResult =
  | { status: "created"; meetingId: string }
  | { status: "duplicate"; meetingId: string }
  | { status: "no_transcript" };

const PROVIDER_DEFAULT_TITLES: Record<MeetingProviderId, string> = {
  fathom: "Fathom Meeting",
  fireflies: "Fireflies Meeting",
  grain: "Grain Meeting",
  tldv: "tl;dv Meeting",
  otter: "Otter.ai Meeting",
  meetgeek: "MeetGeek Meeting",
  read: "Read AI Meeting",
};

export const isDuplicateKeyError = (error: any) => {
  if (!error) return false;
  if (error.code === 11000) return true;
  if (Array.isArray(error.writeErrors)) {
    return error.writeErrors.some((entry: any) => entry?.code === 11000);
  }
  const message = String(error.message || "");
  return message.includes("E11000 duplicate key error");
};

const formatSegmentTimestamp = (offsetSeconds: number) => {
  const total = Math.max(0, Math.floor(offsetSeconds));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
};

export const formatProviderTranscriptSegments = (
  segments: NormalizedTranscriptSegment[]
): string =>
  segments
    .filter((segment) => segment && typeof segment.text === "string" && segment.text.trim())
    .map((segment) => {
      const speaker = segment.speaker?.trim() || "Speaker";
      const text = segment.text.trim();
      const offset =
        typeof segment.offsetSeconds === "number" && Number.isFinite(segment.offsetSeconds)
          ? segment.offsetSeconds
          : null;
      return offset === null
        ? `${speaker}: ${text}`
        : `${formatSegmentTimestamp(offset)} - ${speaker}: ${text}`;
    })
    .join("\n");

export const resolveProviderTranscriptText = (
  transcript: NormalizedProviderMeeting["transcript"]
): string => {
  if (typeof transcript === "string") return transcript.trim();
  if (Array.isArray(transcript)) return formatProviderTranscriptSegments(transcript).trim();
  return "";
};

export const upsertMeetingIdempotently = async ({
  meetingsCollection,
  filter,
  meeting,
}: {
  meetingsCollection: any;
  filter: Record<string, any>;
  meeting: Record<string, any> & { _id: string; createdAt: Date };
}): Promise<{ insertedMeeting: boolean; canonicalMeetingId: string }> => {
  let insertedMeeting = false;
  let canonicalMeetingId: string = meeting._id;

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
      console.error("Meeting upsert failed, falling back to insert:", error);
      await meetingsCollection.insertOne(meeting);
      insertedMeeting = true;
    }
  }

  return { insertedMeeting, canonicalMeetingId };
};

export const ingestProviderMeeting = async ({
  db,
  provider,
  userId,
  workspaceId,
  connectionId = null,
  meeting,
  correlationId,
  logger,
}: {
  db: any;
  provider: MeetingProviderId;
  userId: string;
  workspaceId: string | null;
  connectionId?: string | null;
  meeting: NormalizedProviderMeeting;
  correlationId?: string | null;
  logger?: StructuredLogger;
}): Promise<ProviderIngestResult> => {
  const externalId = String(meeting.externalId || "").trim();
  if (!externalId) {
    throw new ApiRouteError(400, "invalid_payload", "Provider meeting is missing an external id.");
  }

  const user = await findUserById(userId);
  if (!user) {
    throw new ApiRouteError(404, "not_found", "User not found.");
  }

  await ensureMeetingRecordingHashIndex(db);

  const workspaceScopeFilter = ingestHelpers.buildMeetingScopeFilter({
    userId,
    workspaceId,
  });
  const recordingHashScope = getFathomRecordingHashScope({ userId, connectionId });
  const recordingIdHash = hashFathomRecordingId(recordingHashScope, `${provider}:${externalId}`);

  const dedupeMatcher = {
    ...workspaceScopeFilter,
    connectionId,
    recordingIdHash,
  };
  const meetingsCollection = db.collection("meetings");
  const existing = await meetingsCollection.findOne(dedupeMatcher, { projection: { _id: 1 } });
  if (existing?._id) {
    return { status: "duplicate", meetingId: String(existing._id) };
  }

  const transcriptText = resolveProviderTranscriptText(meeting.transcript);
  if (!transcriptText) return { status: "no_transcript" };

  const extracted = await extractFathomMeetingTasks({
    userId,
    transcript: transcriptText,
    organizerEmail: meeting.organizerEmail,
    participants: meeting.participants,
  });

  const extractedTasks: ExtractedTaskSchema[] = Array.isArray(extracted?.tasks)
    ? extracted.tasks
    : [];
  const extractedAttendees = Array.isArray(extracted?.attendees) ? extracted.attendees : [];
  const combinedAttendees = ingestHelpers.mergeParticipantsWithExtractedAttendees(
    meeting.participants,
    extractedAttendees
  );

  const records = buildCreatedFathomMeetingRecords({
    userId,
    workspaceId,
    recordingIdHash,
    connectionId,
    sourceId: externalId,
    title: meeting.title,
    transcript: transcriptText,
    startTime: meeting.startTime,
    endTime: meeting.endTime,
    duration: meeting.durationSeconds,
    recordingUrl: meeting.recordingUrl,
    shareUrl: meeting.shareUrl,
    organizerEmail: meeting.organizerEmail,
    attendees: combinedAttendees,
    summary: extracted?.summary || meeting.summary || null,
    extractedTasks,
    defaultTitle: PROVIDER_DEFAULT_TITLES[provider],
    ingestSource: provider,
  });

  const providerActionItems = Array.isArray(meeting.actionItems)
    ? meeting.actionItems.filter((item) => typeof item === "string" && item.trim())
    : [];
  if (providerActionItems.length) {
    (records.meeting as any).providerActionItems = providerActionItems;
  }
  (records.meeting as any).providerSourceId = externalId;
  (records.meeting as any).provider = provider;

  const { insertedMeeting, canonicalMeetingId } = await upsertMeetingIdempotently({
    meetingsCollection,
    filter: dedupeMatcher,
    meeting: records.meeting as any,
  });
  if (!insertedMeeting) {
    return { status: "duplicate", meetingId: canonicalMeetingId };
  }

  await db.collection("planningSessions").updateOne(
    { _id: records.planningSession._id },
    { $setOnInsert: records.planningSession },
    { upsert: true }
  );

  await runMeetingIngestionCommand({
    db,
    userId,
    workspaceId,
    meetingId: canonicalMeetingId,
    meeting: { ...(records.meeting as any), _id: canonicalMeetingId },
    eventType: "meeting.ingested",
    correlationId: correlationId || undefined,
    logger,
  });

  try {
    await postMeetingAutomationToSlack({
      userId,
      workspaceId,
      meetingId: canonicalMeetingId,
      meetingTitle: records.meeting.title || PROVIDER_DEFAULT_TITLES[provider],
      summary: records.meeting.summary || null,
      extractedTasks,
      transcript: transcriptText,
    });
  } catch (error) {
    logger?.warn?.("meeting.provider.slack_automation_failed", {
      provider,
      meetingId: canonicalMeetingId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return { status: "created", meetingId: canonicalMeetingId };
};
