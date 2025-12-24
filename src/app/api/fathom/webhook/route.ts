import crypto from "crypto";
import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { analyzeMeeting } from "@/ai/flows/analyze-meeting-flow";
import { getDb } from "@/lib/db";
import {
  fetchFathomSummary,
  fetchFathomTranscript,
  formatFathomTranscript,
  getValidFathomAccessToken,
} from "@/lib/fathom";
import { findUserByFathomWebhookToken } from "@/lib/db/users";
import { sanitizeTaskForFirestore } from "@/lib/data";
import type { ExtractedTaskSchema } from "@/types/chat";

const getSignaturesFromHeader = (headerValue: string) => {
  const [, signatureBlock] = headerValue.split(",", 2);
  if (!signatureBlock) return [];
  return signatureBlock.trim().split(/\s+/).filter(Boolean);
};

const verifyWebhookSignature = (
  rawBody: string,
  signatureHeader: string | null
) => {
  const secret = process.env.FATHOM_WEBHOOK_SECRET;
  if (!secret) return true;
  if (!signatureHeader) return false;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("base64");

  const signatures = getSignaturesFromHeader(signatureHeader);
  const expectedBuffer = Buffer.from(expected);
  return signatures.some((sig) => {
    const signatureBuffer = Buffer.from(sig);
    if (signatureBuffer.length !== expectedBuffer.length) return false;
    return crypto.timingSafeEqual(signatureBuffer, expectedBuffer);
  });
};

const normalizePayload = (payload: any) => payload?.data ?? payload ?? {};

const pickFirst = (...values: Array<string | null | undefined>) =>
  values.find((value) => value && value.trim()) || null;

const toDateOrNull = (value: any) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export async function POST(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  if (!token) {
    return NextResponse.json(
      { error: "Missing webhook token." },
      { status: 400 }
    );
  }

  const rawBody = await request.text();
  const signatureHeader = request.headers.get("webhook-signature");
  if (!verifyWebhookSignature(rawBody, signatureHeader)) {
    return NextResponse.json(
      { error: "Invalid webhook signature." },
      { status: 401 }
    );
  }

  const payload = JSON.parse(rawBody);
  const data = normalizePayload(payload);
  const eventType = payload?.event || payload?.event_type || payload?.type;
  if (eventType && eventType !== "new-meeting-content-ready") {
    return NextResponse.json({ status: "ignored", eventType });
  }

  const recordingId =
    data.recording_id ||
    data.recordingId ||
    data?.recording?.id ||
    data?.recording?.recording_id;
  if (!recordingId) {
    return NextResponse.json(
      { error: "Missing recording ID." },
      { status: 400 }
    );
  }

  const user = await findUserByFathomWebhookToken(token);
  if (!user) {
    return NextResponse.json({ error: "Unknown webhook token." }, { status: 404 });
  }

  const db = await getDb();
  const existing = await db
    .collection<any>("meetings")
    .findOne({ userId: user._id.toString(), recordingId });
  if (existing) {
    return NextResponse.json({ status: "duplicate", meetingId: existing._id });
  }

  const accessToken = await getValidFathomAccessToken(user._id.toString());

  let transcriptPayload =
    data.transcript ||
    data.transcript_segments ||
    data?.recording?.transcript ||
    data?.recording?.transcript_segments;
  if (!transcriptPayload) {
    transcriptPayload = await fetchFathomTranscript(recordingId, accessToken);
  }

  const transcriptText = formatFathomTranscript(transcriptPayload);
  if (!transcriptText) {
    return NextResponse.json(
      { error: "Transcript unavailable for recording." },
      { status: 422 }
    );
  }

  const summaryPayload =
    data.summary ||
    data?.recording?.summary ||
    (await fetchFathomSummary(recordingId, accessToken).catch(() => null));

  const detailLevel = user.taskGranularityPreference || "medium";
  const analysisResult = await analyzeMeeting({
    transcript: transcriptText,
    requestedDetailLevel: detailLevel,
  });

  const allTaskLevels = analysisResult.allTaskLevels || null;
  const selectedTasks =
    allTaskLevels?.[detailLevel as keyof typeof allTaskLevels] || [];
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
    data.title,
    data.meeting_title,
    data?.recording?.title,
    `Fathom Meeting ${recordingId}`
  );

  const meetingSummary =
    analysisResult.meetingSummary ||
    analysisResult.chatResponseText ||
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
    recordingId,
    recordingUrl: pickFirst(data.url, data.meeting_url, data?.recording?.url),
    shareUrl: pickFirst(
      data.share_url,
      data.meeting_share_url,
      data?.recording?.share_url
    ),
    startTime: toDateOrNull(
      data.start_time || data.started_at || data?.recording?.start_time
    ),
    endTime: toDateOrNull(
      data.end_time || data.ended_at || data?.recording?.end_time
    ),
    duration: data.duration || data.duration_seconds || data?.recording?.duration,
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
    createdAt: now,
    lastActivityAt: now,
  };

  await db.collection("meetings").insertOne(meeting);
  await db.collection("chatSessions").insertOne(chatSession);
  await db.collection("planningSessions").insertOne(planningSession);

  return NextResponse.json({ status: "ok", meetingId });
}
