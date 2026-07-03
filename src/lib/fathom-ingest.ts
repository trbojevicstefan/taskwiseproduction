import { analyzeMeeting } from "@/ai/flows/analyze-meeting-flow";
import { getDb } from "@/lib/db";
import {
  fetchFathomSummary,
  fetchFathomTranscript,
  formatFathomTranscript,
  getFathomRecordingHashScope,
  hashFathomRecordingId,
} from "@/lib/fathom";
import { normalizeTask } from "@/lib/data";
import type { ExtractedTaskSchema } from "@/types/chat";
import type { DbUser } from "@/lib/db/users";
import { findFathomConnectionById } from "@/lib/fathom-connections";
import * as ingestHelpers from "@/lib/fathom-ingest-helpers";
import * as analysisHelpers from "@/lib/fathom-ingest-analysis";
import * as ingestDuplicates from "@/lib/fathom-ingest-duplicates";
import { ensureMeetingRecordingHashIndex } from "@/lib/fathom-ingest/deduplication";
import { finalizeExistingFathomMeetingReanalysis } from "@/lib/fathom-ingest/existing-meeting-reanalysis";
import { buildCreatedFathomMeetingRecords } from "@/lib/fathom-ingest/meeting-builder";
import { extractFathomMeetingTasks } from "@/lib/fathom-ingest/task-extraction";
import { parseFathomMeetingWebhookPayload } from "@/lib/fathom-ingest/webhook-parser";
import { upsertMeetingIdempotently } from "@/lib/meeting-providers/ingest-pipeline";
import { resolveSummaryText } from "@/lib/fathom-ingest-summary";
import { runMeetingIngestionCommand } from "@/lib/services/meeting-ingestion-command";
import { postMeetingAutomationToSlack } from "@/lib/slack-automation";
import {
  applyCompletionTargets,
  mergeCompletionSuggestions,
} from "@/lib/task-completion";

type FathomIngestResult =
  | { status: "created"; meetingId: string }
  | { status: "duplicate"; meetingId: string }
  | { status: "no_transcript" };

const DUPLICATE_REANALYZE_MAX_AGE_MS = Math.max(
  0,
  Number(process.env.FATHOM_DUPLICATE_REANALYZE_MAX_AGE_MS || 1000 * 60 * 60 * 24)
);

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
  const workspaceScopeFilter = ingestHelpers.buildMeetingScopeFilter({
    userId,
    workspaceId: ingestWorkspaceId,
  });
  const payload = data || {};
  const parsedPayload = parseFathomMeetingWebhookPayload(payload);
  const meetingTitleFromPayload = parsedPayload.title;
  const recordingUrlFromPayload = parsedPayload.recordingUrl;
  const shareUrlFromPayload = parsedPayload.shareUrl;
  const startTimeFromPayload = parsedPayload.startTime;
  const endTimeFromPayload = parsedPayload.endTime;
  const durationSecondsFromPayload = parsedPayload.durationSeconds;
  const organizerEmailFromPayload = parsedPayload.organizerEmail;
  const payloadAttendees = parsedPayload.attendees;
  const incomingAttendeeKeys = parsedPayload.attendeeKeys;
  const dedupeFingerprintsFromPayload = parsedPayload.dedupeFingerprints;
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
    existing = await ingestDuplicates.findCanonicalFathomDuplicate({
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
      const mergedAttendees = ingestHelpers.mergeMeetingPeopleLists(
        existing.attendees,
        payloadAttendees
      );
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
      const detailLevel = analysisHelpers.resolveDetailLevel(user);

      const analysisResult = await analyzeMeeting({
        transcript: transcriptText,
        requestedDetailLevel: detailLevel,
      });

      const allTaskLevels = analysisResult.allTaskLevels || null;
      const selectedTasks = analysisHelpers.selectTasksForLevel(allTaskLevels, detailLevel);

      const sanitizedTasks = selectedTasks.map((task: any) =>
        normalizeTask(task as ExtractedTaskSchema)
      );
      const sanitizedTaskLevels = analysisHelpers.sanitizeLevels(allTaskLevels);

      const uniquePeople = ingestHelpers.buildUniqueMeetingPeople(analysisResult, payload);

      const completionMatchThreshold = analysisHelpers.resolveCompletionMatchThreshold(user);
      // Completion detection is intentionally creation-only.
      // Reanalysis of an existing (duplicate) meeting should not trigger it.
      const completionSuggestions: ExtractedTaskSchema[] = [];

      const shouldAutoApprove = Boolean(user.autoApproveCompletedTasks);
      if (shouldAutoApprove && completionSuggestions.length) {
        const autoApproveSuggestions = completionSuggestions.filter((task: any) =>
          analysisHelpers.shouldAutoApproveSuggestion(task, completionMatchThreshold)
        );
        if (autoApproveSuggestions.length) {
          await applyCompletionTargets(db, userId, autoApproveSuggestions);
        }
      }

      const meetingTitle = ingestHelpers.pickFirst(
        existing.title,
        meetingTitleFromPayload,
        analysisResult.sessionTitle,
        "Fathom Meeting"
      );

      const meetingSummary =
        ingestHelpers.pickFirst(
          existingSummary,
          analysisResult.meetingSummary,
          analysisResult.chatResponseText,
          summaryText
        ) || "";

      await finalizeExistingFathomMeetingReanalysis({
        db,
        user,
        userId,
        existing,
        connectionId: connectionId || existing.connectionId || null,
        providerSourceId: providerSourceId || existing.providerSourceId || null,
        workspaceId: existing.workspaceId || ingestWorkspaceId || null,
        organizerEmailFromPayload,
        meetingTitle,
        meetingSummary,
        uniquePeople,
        finalizedTasks: analysisHelpers.applyAutoApprovalFlags(
          mergeCompletionSuggestions(sanitizedTasks, completionSuggestions),
          completionMatchThreshold
        ),
        sanitizedTasks,
        sanitizedTaskLevels,
        analysisResult,
        completionSuggestions,
        completionMatchThreshold,
        shouldAutoApprove,
        recordingUrl: recordingUrlFromPayload || existing.recordingUrl || null,
        shareUrl: shareUrlFromPayload || existing.shareUrl || null,
        startTime: startTimeFromPayload || existing.startTime || null,
        endTime: endTimeFromPayload || existing.endTime || null,
        duration:
          (typeof durationSecondsFromPayload === "number"
            ? durationSecondsFromPayload
            : null) ?? ingestHelpers.toNumberOrNull(existing.duration) ?? null,
      });
    } else if (Array.isArray(existing.extractedTasks) && existing.extractedTasks.length) {
      const attendeesForUpdate = ingestHelpers.mergeMeetingPeopleLists(
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

  const workspaceId = ingestWorkspaceId;
  const taskExtraction = await extractFathomMeetingTasks({
    db,
    user,
    userId,
    workspaceId,
    payload,
    transcriptText,
    summaryText,
    meetingTitleFromPayload,
  });
  const {
    analysisResult,
    sanitizedTasks,
    sanitizedTaskLevels,
    uniquePeople,
    finalizedTasks,
    meetingTitle,
    meetingSummary,
  } = taskExtraction;

  const now = new Date();
  const { meeting, planningSession, meetingId } = buildCreatedFathomMeetingRecords({
      now,
      userId,
      workspaceId,
      connectionId: connectionId || null,
      providerSourceId: providerSourceId || null,
      meetingTitle,
      meetingSummary,
      transcriptText,
      startTime: startTimeFromPayload,
      endTime: endTimeFromPayload,
      durationSeconds: durationSecondsFromPayload,
      uniquePeople,
      finalizedTasks,
      sanitizedTasks,
      sanitizedTaskLevels,
      analysisResult,
      recordingIdHash,
      candidateRecordingHashes,
      dedupeFingerprints: dedupeFingerprintsFromPayload,
      recordingUrl: recordingUrlFromPayload,
      shareUrl: shareUrlFromPayload,
      organizerEmail: organizerEmailFromPayload,
    });

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
    const upsertOutcome = await upsertMeetingIdempotently({
      meetingsCollection,
      filter,
      meeting,
    });
    insertedMeeting = upsertOutcome.insertedMeeting;
    canonicalMeetingId = upsertOutcome.canonicalMeetingId;
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
