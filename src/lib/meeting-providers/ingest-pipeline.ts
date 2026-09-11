/**
 * Phase 7 — shared provider-agnostic meeting ingestion pipeline.
 *
 * `ingestProviderMeeting` is the generic counterpart of
 * `ingestFathomMeeting` (src/lib/fathom-ingest.ts) for adapter-based
 * providers (Fireflies, Grain). It reuses the exact same internals so
 * ingested meetings ride the existing rails:
 *
 * 1. dedupe indexes (`ensureMeetingRecordingHashIndex`)
 * 2. workspace scope filter tolerating legacy null-workspace docs
 * 3. duplicate lookup by connection-scoped recording hash + providerSourceId
 * 4. shared LLM task extraction (`extractFathomMeetingTasks` — provider
 *    neutral; NOT forked)
 * 5. meeting + planningSession docs via `buildCreatedFathomMeetingRecords`
 *    (parameterized `ingestSource`/default title)
 * 6. idempotent upsert (`upsertMeetingIdempotently`, also called by the
 *    fathom path)
 * 7. `meeting.ingested`/`meeting.updated` through
 *    `runMeetingIngestionCommand` (people upsert incl. Phase 6 personType
 *    hooks + task sync + workflow automation happen in the domain-event
 *    handler)
 * 8. Slack meeting automation
 *
 * Intentional differences from the fathom path (bespoke fathom behavior that
 * stays in fathom-ingest.ts): no duplicate reanalysis window, no legacy
 * user-scoped hash aliases, no cross-note-taker fingerprint dedupe (that
 * query pins `ingestSource: "fathom"`), no fathom integration logs.
 * Provider action items are persisted verbatim as `providerActionItems` and
 * are NOT mapped into extractedTasks (fathom parity: tasks come only from
 * the shared LLM extraction).
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

/**
 * Format transcript segments into the same "M:SS - Speaker: text" line shape
 * `formatFathomTranscript` produces, so downstream chat/snippets behave
 * identically for every provider.
 */
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

/**
 * Idempotent meeting upsert extracted from the fathom path (strangler
 * pattern — fathom-ingest.ts calls this too). Upserts by the caller-built
 * dedupe filter with `$setOnInsert: { createdAt, _id }`; a duplicate-key
 * race resolves the canonical meeting id instead of double-inserting.
 */
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
    throw new ApiRouteError(
      400,
      "invalid_payload",
      "Provider meeting is missing an external id."
    );
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

  // Provider-prefixed recording id hashed under the connection scope. The
  // `connection:<id>` scope string is provider-neutral (do-not-touch fathom
  // semantics are preserved: same function, new connection ids). The
  // provider prefix guarantees no cross-provider hash collisions under the
  // legacy `user:<userId>` scope.
  const recordingHashScope = getFathomRecordingHashScope({ userId, connectionId });
  const recordingIdHash = hashFathomRecordingId(
    recordingHashScope,
    `${provider}:${externalId}`
  );

  const dedupeMatcher = {
    $or: [
      { recordingIdHash },
      { recordingIdHashes: recordingIdHash },
      { ingestSource: provider, providerSourceId: externalId },
    ],
  };
  const dedupeFilter = { $and: [workspaceScopeFilter, dedupeMatcher] };

  const transcriptText = resolveProviderTranscriptText(meeting.transcript);
  const summaryText =
    typeof meeting.summary === "string" && meeting.summary.trim()
      ? meeting.summary.trim()
      : null;
  const participants = ingestHelpers.mergeMeetingPeopleLists(
    (meeting.participants || []).map((participant) => ({
      name: participant.name,
      email: participant.email || undefined,
      title: participant.title || undefined,
      role: "attendee" as const,
    }))
  );
  const actionItems = Array.isArray(meeting.actionItems)
    ? meeting.actionItems.filter(
        (item): item is string => typeof item === "string" && Boolean(item.trim())
      )
    : [];

  const meetingsCollection = db.collection("meetings");
  const existing = await meetingsCollection.findOne(dedupeFilter);

  if (existing) {
    // Duplicate path: fill only missing fields, never clobber, and re-emit
    // meeting.updated when tasks already exist (mirrors the fathom path
    // without its reanalysis window).
    const update: Record<string, any> = {
      lastActivityAt: new Date(),
      ingestSource: existing.ingestSource || provider,
    };
    if (!existing.recordingIdHash) update.recordingIdHash = recordingIdHash;
    const existingHashes = Array.isArray(existing.recordingIdHashes)
      ? existing.recordingIdHashes.filter((value: any) => typeof value === "string")
      : [];
    const mergedHashes = Array.from(new Set([...existingHashes, recordingIdHash]));
    if (mergedHashes.length) update.recordingIdHashes = mergedHashes;
    if (connectionId && existing.connectionId !== connectionId) {
      update.connectionId = connectionId;
    }
    if (existing.providerSourceId !== externalId) {
      update.providerSourceId = externalId;
    }
    if (transcriptText && !String(existing.originalTranscript || "").trim()) {
      update.originalTranscript = transcriptText;
    }
    if (summaryText && !String(existing.summary || "").trim()) {
      update.summary = summaryText;
    }
    if (meeting.recordingUrl && !existing.recordingUrl) {
      update.recordingUrl = meeting.recordingUrl;
    }
    if (meeting.shareUrl && !existing.shareUrl) update.shareUrl = meeting.shareUrl;
    if (meeting.startTime && !existing.startTime) update.startTime = meeting.startTime;
    if (meeting.endTime && !existing.endTime) update.endTime = meeting.endTime;
    if (meeting.durationSeconds && !existing.duration) {
      update.duration = meeting.durationSeconds;
    }
    if (meeting.organizerEmail && !existing.organizerEmail) {
      update.organizerEmail = meeting.organizerEmail;
    }
    if (participants.length) {
      const mergedAttendees = ingestHelpers.mergeMeetingPeopleLists(
        existing.attendees,
        participants
      );
      if (mergedAttendees.length) update.attendees = mergedAttendees;
    }
    if (actionItems.length && !Array.isArray(existing.providerActionItems)) {
      update.providerActionItems = actionItems;
    }

    await meetingsCollection.updateOne({ _id: existing._id }, { $set: update });

    if (Array.isArray(existing.extractedTasks) && existing.extractedTasks.length) {
      await runMeetingIngestionCommand(db, {
        mode: "flagged-event",
        eventType: "meeting.updated",
        userId,
        correlationId: correlationId || null,
        payload: {
          meetingId: String(existing._id),
          workspaceId: existing.workspaceId || workspaceId || null,
          title: existing.title || "Meeting",
          attendees: ingestHelpers.mergeMeetingPeopleLists(
            existing.attendees,
            participants
          ),
          extractedTasks: existing.extractedTasks as ExtractedTaskSchema[],
        },
      });
    }

    logger?.info?.("meeting-providers.ingest.duplicate", {
      provider,
      meetingId: String(existing._id),
    });
    return { status: "duplicate", meetingId: String(existing._id) };
  }

  if (!transcriptText) {
    return { status: "no_transcript" };
  }

  // Shared LLM task extraction (same flow the fathom path uses; provider
  // participants ride in through the payload's attendees).
  const taskExtraction = await extractFathomMeetingTasks({
    db,
    user,
    userId,
    workspaceId,
    payload: { attendees: participants },
    transcriptText,
    summaryText,
    meetingTitleFromPayload: meeting.title,
  });

  const defaultTitle = PROVIDER_DEFAULT_TITLES[provider];
  const meetingTitle =
    ingestHelpers.pickFirst(
      meeting.title,
      taskExtraction.analysisResult?.sessionTitle,
      defaultTitle
    ) || defaultTitle;

  const dedupeFingerprints = ingestHelpers.buildMeetingDedupeFingerprints({
    title: meetingTitle,
    recordingUrl: meeting.recordingUrl,
    shareUrl: meeting.shareUrl,
    startTime: meeting.startTime,
    endTime: meeting.endTime,
    durationSeconds: meeting.durationSeconds,
  });

  const now = new Date();
  const { meeting: meetingDoc, planningSession } = buildCreatedFathomMeetingRecords({
    now,
    userId,
    workspaceId,
    connectionId: connectionId || null,
    providerSourceId: externalId,
    meetingTitle,
    meetingSummary: taskExtraction.meetingSummary,
    transcriptText,
    startTime: meeting.startTime,
    endTime: meeting.endTime,
    durationSeconds: meeting.durationSeconds,
    uniquePeople: taskExtraction.uniquePeople,
    finalizedTasks: taskExtraction.finalizedTasks,
    sanitizedTasks: taskExtraction.sanitizedTasks,
    sanitizedTaskLevels: taskExtraction.sanitizedTaskLevels,
    analysisResult: taskExtraction.analysisResult,
    recordingIdHash,
    candidateRecordingHashes: [recordingIdHash],
    dedupeFingerprints,
    recordingUrl: meeting.recordingUrl,
    shareUrl: meeting.shareUrl,
    organizerEmail: meeting.organizerEmail,
    ingestSource: provider,
    defaultTitle,
  });

  if (actionItems.length) {
    (meetingDoc as Record<string, any>).providerActionItems = actionItems;
  }

  const { insertedMeeting, canonicalMeetingId } = await upsertMeetingIdempotently({
    meetingsCollection,
    filter: dedupeFilter,
    meeting: meetingDoc,
  });

  if (!insertedMeeting) {
    return { status: "duplicate", meetingId: canonicalMeetingId };
  }

  planningSession.sourceMeetingId = canonicalMeetingId;
  await db.collection("planningSessions").insertOne(planningSession);

  await runMeetingIngestionCommand(db, {
    mode: "flagged-event",
    eventType: "meeting.ingested",
    userId,
    correlationId: correlationId || null,
    payload: {
      meetingId: canonicalMeetingId,
      workspaceId,
      title: meetingTitle,
      attendees: taskExtraction.uniquePeople,
      extractedTasks: taskExtraction.finalizedTasks,
    },
  });

  await postMeetingAutomationToSlack({
    user,
    meetingTitle: meetingTitle || "Meeting",
    meetingSummary: taskExtraction.meetingSummary,
    tasks: taskExtraction.finalizedTasks,
  });

  logger?.info?.("meeting-providers.ingest.created", {
    provider,
    meetingId: canonicalMeetingId,
  });
  return { status: "created", meetingId: canonicalMeetingId };
};
