import { randomUUID } from "crypto";
import { mergeCompletionSuggestions } from "@/lib/task-completion";
import * as analysisHelpers from "@/lib/fathom-ingest-analysis";
import * as ingestHelpers from "@/lib/fathom-ingest-helpers";
import { runMeetingIngestionCommand } from "@/lib/services/meeting-ingestion-command";
import { postMeetingAutomationToSlack } from "@/lib/slack-automation";

export const finalizeExistingFathomMeetingReanalysis = async (input: {
  db: any;
  user: any;
  userId: string;
  existing: any;
  connectionId: string | null;
  providerSourceId: string | null;
  workspaceId: string | null;
  organizerEmailFromPayload: string | null;
  meetingTitle: string | null;
  meetingSummary: string;
  uniquePeople: any[];
  finalizedTasks: any[];
  sanitizedTasks: any[];
  sanitizedTaskLevels: any;
  analysisResult: any;
  completionSuggestions: any[];
  completionMatchThreshold: number;
  shouldAutoApprove: boolean;
  recordingUrl: string | null;
  shareUrl: string | null;
  startTime: Date | null;
  endTime: Date | null;
  duration: number | null;
}) => {
  const now = new Date();
  const mergedTasks = mergeCompletionSuggestions(
    input.sanitizedTasks,
    input.completionSuggestions
  );
  const finalizedTasks = input.shouldAutoApprove
    ? analysisHelpers.applyAutoApprovalFlags(mergedTasks, input.completionMatchThreshold)
    : mergedTasks;

  let sanitizedTaskLevels = input.sanitizedTaskLevels;
  if (sanitizedTaskLevels) {
    sanitizedTaskLevels = {
      light: mergeCompletionSuggestions(
        sanitizedTaskLevels.light || [],
        input.completionSuggestions
      ),
      medium: mergeCompletionSuggestions(
        sanitizedTaskLevels.medium || [],
        input.completionSuggestions
      ),
      detailed: mergeCompletionSuggestions(
        sanitizedTaskLevels.detailed || [],
        input.completionSuggestions
      ),
    };
    if (input.shouldAutoApprove) {
      sanitizedTaskLevels = {
        light: analysisHelpers.applyAutoApprovalFlags(
          sanitizedTaskLevels.light || [],
          input.completionMatchThreshold
        ),
        medium: analysisHelpers.applyAutoApprovalFlags(
          sanitizedTaskLevels.medium || [],
          input.completionMatchThreshold
        ),
        detailed: analysisHelpers.applyAutoApprovalFlags(
          sanitizedTaskLevels.detailed || [],
          input.completionMatchThreshold
        ),
      };
    }
  }

  const meetingTitle = ingestHelpers.pickFirst(
    input.existing.title,
    input.meetingTitle,
    input.analysisResult.sessionTitle,
    "Fathom Meeting"
  );

  const meetingUpdate: Record<string, any> = {
    lastActivityAt: now,
    title: meetingTitle,
    summary: input.meetingSummary,
    analysisAttemptedAt: now,
    organizerEmail: input.existing.organizerEmail || input.organizerEmailFromPayload || null,
    attendees: input.uniquePeople,
    extractedTasks: finalizedTasks,
    allTaskLevels: sanitizedTaskLevels,
    originalAiTasks: input.sanitizedTasks,
    originalAllTaskLevels: sanitizedTaskLevels,
    keyMoments: input.analysisResult.keyMoments || [],
    overallSentiment: input.analysisResult.overallSentiment ?? null,
    speakerActivity: input.analysisResult.speakerActivity || [],
    meetingMetadata: input.analysisResult.meetingMetadata || undefined,
    state: "tasks_ready",
  };

  const refreshedDedupeFingerprints = ingestHelpers.buildMeetingDedupeFingerprints({
    title: meetingTitle,
    recordingUrl: input.recordingUrl || input.existing.recordingUrl || null,
    shareUrl: input.shareUrl || input.existing.shareUrl || null,
    startTime: input.startTime || input.existing.startTime || null,
    endTime: input.endTime || input.existing.endTime || null,
    durationSeconds:
      (typeof input.duration === "number" ? input.duration : null) ??
      ingestHelpers.toNumberOrNull(input.existing.duration) ??
      null,
  });

  if (refreshedDedupeFingerprints.length) {
    meetingUpdate.dedupeFingerprints = Array.from(
      new Set([...(input.existing.dedupeFingerprints || []), ...refreshedDedupeFingerprints])
    );
  }

  const chatSessionId = input.existing.chatSessionId
    ? String(input.existing.chatSessionId)
    : null;

  let planningSessionId = input.existing.planningSessionId
    ? String(input.existing.planningSessionId)
    : null;
  if (!planningSessionId) {
    planningSessionId = randomUUID();
    meetingUpdate.planningSessionId = planningSessionId;
    await input.db.collection("planningSessions").insertOne({
      _id: planningSessionId,
      userId: input.userId,
      workspaceId: input.workspaceId,
      connectionId: input.connectionId,
      providerSourceId: input.providerSourceId,
      title: `Plan from "${meetingTitle}"`,
      inputText: input.meetingSummary,
      extractedTasks: finalizedTasks,
      originalAiTasks: input.sanitizedTasks,
      originalAllTaskLevels: sanitizedTaskLevels,
      taskRevisions: [],
      folderId: null,
      sourceMeetingId: input.existing._id.toString(),
      allTaskLevels: sanitizedTaskLevels,
      meetingMetadata: input.analysisResult.meetingMetadata || undefined,
      createdAt: now,
      lastActivityAt: now,
    });
  } else {
    await input.db.collection("planningSessions").updateMany(
      {
        userId: input.userId,
        $or: [{ _id: planningSessionId }, { id: planningSessionId }],
      },
      {
        $set: {
          connectionId: input.connectionId,
          providerSourceId: input.providerSourceId,
          title: `Plan from "${meetingTitle}"`,
          inputText: input.meetingSummary,
          extractedTasks: finalizedTasks,
          originalAiTasks: input.sanitizedTasks,
          originalAllTaskLevels: sanitizedTaskLevels,
          allTaskLevels: sanitizedTaskLevels,
          meetingMetadata: input.analysisResult.meetingMetadata || undefined,
          lastActivityAt: now,
        },
      }
    );
  }

  await input.db.collection("meetings").updateOne(
    { _id: input.existing._id },
    { $set: meetingUpdate }
  );

  await runMeetingIngestionCommand(input.db, {
    mode: "flagged-event",
    eventType: "meeting.updated",
    userId: input.userId,
    payload: {
      meetingId: String(input.existing._id),
      workspaceId: input.workspaceId,
      title: meetingTitle,
      attendees: input.uniquePeople,
      extractedTasks: finalizedTasks,
    },
  });

  if (chatSessionId) {
    try {
      const sourceIds = finalizedTasks.map((task: any) => task.id).filter(Boolean);
      if (sourceIds.length) {
        const tasks = await input.db
          .collection("tasks")
          .find({ userId: input.userId, sourceTaskId: { $in: sourceIds } })
          .project({ _id: 1, sourceTaskId: 1 })
          .toArray();
        const map = new Map(tasks.map((row: any) => [String(row.sourceTaskId), String(row._id)]));
        const augmented = finalizedTasks.map((task: any) => ({
          ...task,
          taskCanonicalId: map.get(task.id) || undefined,
        }));
        await input.db.collection("chatSessions").updateMany(
          {
            userId: input.userId,
            $or: [{ _id: chatSessionId }, { id: chatSessionId }],
          },
          {
            $set: {
              title: `Chat about "${meetingTitle}"`,
              suggestedTasks: augmented,
              originalAiTasks: input.sanitizedTasks,
              originalAllTaskLevels: sanitizedTaskLevels,
              people: input.uniquePeople,
              allTaskLevels: sanitizedTaskLevels,
              meetingMetadata: input.analysisResult.meetingMetadata || undefined,
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
    user: input.user,
    meetingTitle: meetingTitle || "Meeting",
    meetingSummary: input.meetingSummary,
    tasks: finalizedTasks,
  });

  return { status: "duplicate" as const, meetingId: input.existing._id.toString() };
};
