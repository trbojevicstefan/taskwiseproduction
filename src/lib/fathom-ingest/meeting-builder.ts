import { randomUUID } from "crypto";
import { resolveCompletionAuditModel } from "@/lib/fathom-ingest-analysis";

export const buildCreatedFathomMeetingRecords = (input: {
  now?: Date;
  meetingId?: string;
  planId?: string;
  userId: string;
  workspaceId: string | null;
  connectionId: string | null;
  providerSourceId: string | null;
  meetingTitle: string | null;
  meetingSummary: string | null;
  transcriptText: string;
  startTime: Date | null;
  endTime: Date | null;
  durationSeconds: number | null;
  uniquePeople: any[];
  finalizedTasks: any[];
  sanitizedTasks: any[];
  sanitizedTaskLevels: any;
  analysisResult: {
    keyMoments?: any[];
    overallSentiment?: unknown;
    speakerActivity?: any[];
    meetingMetadata?: unknown;
  };
  recordingIdHash: string;
  candidateRecordingHashes: string[];
  dedupeFingerprints: string[];
  recordingUrl: string | null;
  shareUrl: string | null;
  organizerEmail: string | null;
  /** Phase 7: provider discriminator; defaults preserve fathom behavior. */
  ingestSource?: string;
  /** Phase 7: title fallback; defaults preserve fathom behavior. */
  defaultTitle?: string;
}) => {
  const now = input.now || new Date();
  const ingestSource = input.ingestSource || "fathom";
  const defaultTitle = input.defaultTitle || "Fathom Meeting";
  const meetingId = input.meetingId || randomUUID();
  const planId = input.planId || randomUUID();
  const taskRevisions =
    input.sanitizedTasks.length > 0
      ? [
          {
            id: randomUUID(),
            createdAt: now.getTime(),
            source: "ai",
            summary: "Initial AI extraction",
            tasksSnapshot: input.sanitizedTasks,
          },
        ]
      : [];

  const meeting = {
    _id: meetingId,
    userId: input.userId,
    workspaceId: input.workspaceId,
    connectionId: input.connectionId,
    providerSourceId: input.providerSourceId,
    title: input.meetingTitle || defaultTitle,
    originalTranscript: input.transcriptText,
    summary: input.meetingSummary || "",
    attendees: input.uniquePeople,
    extractedTasks: input.finalizedTasks,
    originalAiTasks: input.sanitizedTasks,
    originalAllTaskLevels: input.sanitizedTaskLevels,
    taskRevisions,
    chatSessionId: null,
    planningSessionId: planId,
    allTaskLevels: input.sanitizedTaskLevels,
    keyMoments: input.analysisResult.keyMoments || [],
    overallSentiment: input.analysisResult.overallSentiment ?? null,
    speakerActivity: input.analysisResult.speakerActivity || [],
    meetingMetadata: input.analysisResult.meetingMetadata || undefined,
    recordingIdHash: input.recordingIdHash,
    recordingIdHashes: input.candidateRecordingHashes,
    dedupeFingerprints: input.dedupeFingerprints,
    recordingUrl: input.recordingUrl,
    organizerEmail: input.organizerEmail,
    ingestSource,
    fathomNotificationReadAt: null,
    shareUrl: input.shareUrl,
    startTime: input.startTime,
    endTime: input.endTime,
    duration: input.durationSeconds,
    state: "tasks_ready",
    analysisAttemptedAt: now,
    completionAuditAttemptedAt: now,
    completionAuditModel: resolveCompletionAuditModel(),
    completionAuditSuggestionCount: 0,
    createdAt: now,
    lastActivityAt: now,
  };

  const planningSession = {
    _id: planId,
    userId: input.userId,
    workspaceId: input.workspaceId,
    connectionId: input.connectionId,
    providerSourceId: input.providerSourceId,
    title: `Plan from "${input.meetingTitle || defaultTitle}"`,
    inputText: input.meetingSummary || "",
    extractedTasks: input.finalizedTasks,
    originalAiTasks: input.sanitizedTasks,
    originalAllTaskLevels: input.sanitizedTaskLevels,
    taskRevisions: [],
    folderId: null,
    sourceMeetingId: meetingId as string,
    allTaskLevels: input.sanitizedTaskLevels,
    meetingMetadata: input.analysisResult.meetingMetadata || undefined,
    createdAt: now,
    lastActivityAt: now,
  };

  return {
    meeting,
    planningSession,
    meetingId,
    planId,
  };
};
