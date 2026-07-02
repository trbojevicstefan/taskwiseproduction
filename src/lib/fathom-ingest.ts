import { randomUUID } from "crypto";
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
import {
  applyCompletionTargets,
  buildCompletionSuggestions,
  mergeCompletionSuggestions,
} from "@/lib/task-completion";
import { findFathomConnectionById } from "@/lib/fathom-connections";
import * as ingestHelpers from "@/lib/fathom-ingest-helpers";
import * as analysisHelpers from "@/lib/fathom-ingest-analysis";
import * as ingestDuplicates from "@/lib/fathom-ingest-duplicates";
import { resolveSummaryText } from "@/lib/fathom-ingest-summary";
import { runMeetingIngestionCommand } from "@/lib/services/meeting-ingestion-command";
import { postMeetingAutomationToSlack } from "@/lib/slack-automation";

type FathomIngestResult =
  | { status: "created"; meetingId: string }
  | { status: "duplicate"; meetingId: string }
  | { status: "no_transcript" };

const extractMeetingOrganizerEmail = (payload: any) => {
  const candidate = ingestHelpers.pickFirst(
    payload?.organizer_email,
    payload?.organizer?.email,
    payload?.host?.email,
    payload?.owner?.email,
    payload?.recording?.organizer_email,
    payload?.recording?.organizer?.email,
    payload?.recording?.host?.email,
    payload?.recording?.owner?.email
  );
  if (typeof candidate !== "string") return null;
  const email = candidate.trim().toLowerCase();
  return email.includes("@") ? email : null;
};

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
  const meetingTitleFromPayload = ingestHelpers.extractMeetingTitle(payload);
  const recordingUrlFromPayload = ingestHelpers.extractMeetingRecordingUrl(payload);
  const shareUrlFromPayload = ingestHelpers.extractMeetingShareUrl(payload);
  const startTimeFromPayload = ingestHelpers.extractMeetingStartTime(payload);
  const endTimeFromPayload = ingestHelpers.extractMeetingEndTime(payload);
  const durationSecondsFromPayload = ingestHelpers.extractMeetingDurationSeconds(payload);
  const organizerEmailFromPayload = extractMeetingOrganizerEmail(payload);
  const payloadAttendees = ingestHelpers.extractMeetingAttendeesFromPayload(payload);
  const incomingAttendeeKeys = ingestHelpers.extractMeetingAttendeeKeysFromPayload(payload);
  const dedupeFingerprintsFromPayload = ingestHelpers.buildMeetingDedupeFingerprints({
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
      let sanitizedTaskLevels = analysisHelpers.sanitizeLevels(allTaskLevels);

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

      const mergedTasks = mergeCompletionSuggestions(
        sanitizedTasks,
        completionSuggestions
      );
      const finalizedTasks = shouldAutoApprove
        ? analysisHelpers.applyAutoApprovalFlags(mergedTasks, completionMatchThreshold)
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
            light: analysisHelpers.applyAutoApprovalFlags(
              sanitizedTaskLevels.light || [],
              completionMatchThreshold
            ),
            medium: analysisHelpers.applyAutoApprovalFlags(
              sanitizedTaskLevels.medium || [],
              completionMatchThreshold
            ),
            detailed: analysisHelpers.applyAutoApprovalFlags(
              sanitizedTaskLevels.detailed || [],
              completionMatchThreshold
            ),
          };
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
      const refreshedDedupeFingerprints = ingestHelpers.buildMeetingDedupeFingerprints({
        title: meetingTitle,
        recordingUrl: recordingUrl || existing.recordingUrl || null,
        shareUrl: shareUrl || existing.shareUrl || null,
        startTime: startTime || existing.startTime || null,
        endTime: endTime || existing.endTime || null,
        durationSeconds:
          (typeof duration === "number" ? duration : null) ??
          ingestHelpers.toNumberOrNull(existing.duration) ??
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

  const detailLevel = analysisHelpers.resolveDetailLevel(user);
  const workspaceId = ingestWorkspaceId;
  const analysisResult = await analyzeMeeting({
    transcript: transcriptText,
    requestedDetailLevel: detailLevel,
  });

  const allTaskLevels = analysisResult.allTaskLevels || null;
  const selectedTasks = analysisHelpers.selectTasksForLevel(allTaskLevels, detailLevel);

  const sanitizedTasks = selectedTasks.map((task: any) =>
    normalizeTask(task as ExtractedTaskSchema)
  );
  let sanitizedTaskLevels = analysisHelpers.sanitizeLevels(allTaskLevels);

  const uniquePeople = ingestHelpers.buildUniqueMeetingPeople(analysisResult, payload);

  const completionMatchThreshold = analysisHelpers.resolveCompletionMatchThreshold(user);
  const completionSummary =
    ingestHelpers.pickFirst(
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
      analysisHelpers.shouldAutoApproveSuggestion(task, completionMatchThreshold)
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
    ? analysisHelpers.applyAutoApprovalFlags(mergedTasks, completionMatchThreshold)
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
        light: analysisHelpers.applyAutoApprovalFlags(
          sanitizedTaskLevels.light || [],
          completionMatchThreshold
        ),
        medium: analysisHelpers.applyAutoApprovalFlags(
          sanitizedTaskLevels.medium || [],
          completionMatchThreshold
        ),
        detailed: analysisHelpers.applyAutoApprovalFlags(
          sanitizedTaskLevels.detailed || [],
          completionMatchThreshold
        ),
      };
    }
  }

  const meetingTitle = ingestHelpers.pickFirst(
    meetingTitleFromPayload,
    analysisResult.sessionTitle,
    "Fathom Meeting"
  );

  const meetingSummary =
    ingestHelpers.pickFirst(
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
    completionAuditModel: analysisHelpers.resolveCompletionAuditModel(),
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
