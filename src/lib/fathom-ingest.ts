import { randomUUID } from "crypto";
import { analyzeMeeting } from "@/ai/flows/analyze-meeting-flow";
import { getDb } from "@/lib/db";
import {
  fetchFathomSummary,
  fetchFathomTranscript,
  formatFathomTranscript,
} from "@/lib/fathom";
import { sanitizeTaskForFirestore } from "@/lib/data";
import type { ExtractedTaskSchema } from "@/types/chat";
import type { DbUser } from "@/lib/db/users";

type FathomIngestResult =
  | { status: "created"; meetingId: string }
  | { status: "duplicate"; meetingId: string }
  | { status: "no_transcript" };

const pickFirst = (...values: Array<string | null | undefined>) =>
  values.find((value) => value && value.trim()) || null;

const toDateOrNull = (value: any) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const sanitizeLevels = (levels: any) =>
  levels
    ? {
        light: (levels.light || []).map((task: any) =>
          sanitizeTaskForFirestore(task as ExtractedTaskSchema)
        ),
        medium: (levels.medium || []).map((task: any) =>
          sanitizeTaskForFirestore(task as ExtractedTaskSchema)
        ),
        detailed: (levels.detailed || []).map((task: any) =>
          sanitizeTaskForFirestore(task as ExtractedTaskSchema)
        ),
      }
    : null;

export const ingestFathomMeeting = async ({
  user,
  recordingId,
  data,
  accessToken,
}: {
  user: DbUser;
  recordingId: string;
  data?: any;
  accessToken: string;
}): Promise<FathomIngestResult> => {
  const db = await getDb();
  const existing = await db
    .collection<any>("meetings")
    .findOne({ userId: user._id.toString(), recordingId });
  if (existing) {
    return { status: "duplicate", meetingId: existing._id.toString() };
  }

  const payload = data || {};
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

  const detailLevel = "light";
  const analysisResult = await analyzeMeeting({
    transcript: transcriptText,
    requestedDetailLevel: detailLevel,
  });

  const allTaskLevels = analysisResult.allTaskLevels || null;
  const selectedTasks =
    allTaskLevels?.[detailLevel as keyof typeof allTaskLevels] || [];

  const sanitizedTasks = selectedTasks.map((task: any) =>
    sanitizeTaskForFirestore(task as ExtractedTaskSchema)
  );
  const sanitizedTaskLevels = sanitizeLevels(allTaskLevels);

  const attendees = (analysisResult.attendees || []).map((person) => ({
    ...person,
    role: "attendee" as const,
  }));
  const mentioned = (analysisResult.mentionedPeople || []).map((person) => ({
    ...person,
    role: "mentioned" as const,
  }));
  const combinedPeople = [...attendees, ...mentioned];
  const uniquePeople = Array.from(
    new Map(
      combinedPeople.map((person) => [person.name.toLowerCase(), person])
    ).values()
  );

  const meetingTitle = pickFirst(
    analysisResult.sessionTitle,
    payload.title,
    payload.meeting_title,
    payload?.recording?.title,
    payload?.recording_name,
    `Fathom Meeting ${recordingId}`
  );

  const meetingSummary =
    analysisResult.meetingSummary ||
    analysisResult.chatResponseText ||
    payload?.default_summary?.markdown_formatted ||
    (typeof summaryPayload === "string" ? summaryPayload : "") ||
    "";

  const now = new Date();
  const meetingId = randomUUID();
  const chatId = randomUUID();
  const planId = randomUUID();

  const meeting = {
    _id: meetingId,
    userId: user._id.toString(),
    title: meetingTitle,
    originalTranscript: transcriptText,
    summary: meetingSummary,
    attendees: uniquePeople,
    extractedTasks: sanitizedTasks,
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
    chatSessionId: chatId,
    planningSessionId: planId,
    allTaskLevels: sanitizedTaskLevels,
    keyMoments: analysisResult.keyMoments || [],
    overallSentiment: analysisResult.overallSentiment ?? null,
    speakerActivity: analysisResult.speakerActivity || [],
    meetingMetadata: analysisResult.meetingMetadata || undefined,
    recordingId,
    recordingUrl: pickFirst(
      payload.url,
      payload.meeting_url,
      payload?.recording?.url
    ),
    shareUrl: pickFirst(
      payload.share_url,
      payload.meeting_share_url,
      payload?.recording?.share_url
    ),
    startTime: toDateOrNull(
      payload.recording_start_time ||
        payload.start_time ||
        payload.started_at ||
        payload?.recording?.start_time ||
        payload.scheduled_start_time
    ),
    endTime: toDateOrNull(
      payload.recording_end_time ||
        payload.end_time ||
        payload.ended_at ||
        payload?.recording?.end_time ||
        payload.scheduled_end_time
    ),
    duration: payload.duration || payload.duration_seconds || payload?.recording?.duration,
    state: "tasks_ready",
    createdAt: now,
    lastActivityAt: now,
  };

  const chatSession = {
    _id: chatId,
    userId: user._id.toString(),
    title: `Chat about "${meetingTitle}"`,
    messages: [],
    suggestedTasks: sanitizedTasks,
    originalAiTasks: sanitizedTasks,
    originalAllTaskLevels: sanitizedTaskLevels,
    taskRevisions: [],
    people: uniquePeople,
    folderId: null,
    sourceMeetingId: meetingId,
    allTaskLevels: sanitizedTaskLevels,
    meetingMetadata: analysisResult.meetingMetadata || undefined,
    createdAt: now,
    lastActivityAt: now,
  };

  const planningSession = {
    _id: planId,
    userId: user._id.toString(),
    title: `Plan from "${meetingTitle}"`,
    inputText: meetingSummary,
    extractedTasks: sanitizedTasks,
    originalAiTasks: sanitizedTasks,
    originalAllTaskLevels: sanitizedTaskLevels,
    taskRevisions: [],
    folderId: null,
    sourceMeetingId: meetingId,
    allTaskLevels: sanitizedTaskLevels,
    meetingMetadata: analysisResult.meetingMetadata || undefined,
    createdAt: now,
    lastActivityAt: now,
  };

  await db.collection("meetings").insertOne(meeting);
  await db.collection("chatSessions").insertOne(chatSession);
  await db.collection("planningSessions").insertOne(planningSession);

  return { status: "created", meetingId };
};
