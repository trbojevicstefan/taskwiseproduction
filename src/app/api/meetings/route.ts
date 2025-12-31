import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { buildIdQuery } from "@/lib/mongo-id";
import { syncTasksForSource } from "@/lib/task-sync";
import type { ExtractedTaskSchema } from "@/types/chat";

const serializeMeeting = (meeting: any) => {
  const { recordingId, recordingIdHash, ...rest } = meeting;
  return {
    ...rest,
    id: meeting._id,
    _id: undefined,
    createdAt: meeting.createdAt?.toISOString?.() || meeting.createdAt,
    lastActivityAt: meeting.lastActivityAt?.toISOString?.() || meeting.lastActivityAt,
  };
};

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userIdQuery = buildIdQuery(userId);
  const db = await getDb();
  const meetings = await db
    .collection<any>("meetings")
    .find({ userId: userIdQuery, isHidden: { $ne: true } })
    .sort({ lastActivityAt: -1 })
    .toArray();

  return NextResponse.json(meetings.map(serializeMeeting));
}

export async function POST(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const { recordingId, recordingIdHash, ...safeBody } = body || {};
  const now = new Date();
  const meeting = {
    _id: randomUUID(),
    userId,
    title: safeBody.title || "Meeting",
    originalTranscript: safeBody.originalTranscript || "",
    summary: safeBody.summary || "",
    attendees: safeBody.attendees || [],
    extractedTasks: safeBody.extractedTasks || [],
    originalAiTasks: safeBody.originalAiTasks || safeBody.extractedTasks || [],
    originalAllTaskLevels: safeBody.originalAllTaskLevels || safeBody.allTaskLevels || null,
    taskRevisions: safeBody.taskRevisions || [],
    chatSessionId: safeBody.chatSessionId ?? null,
    planningSessionId: safeBody.planningSessionId ?? null,
    allTaskLevels: safeBody.allTaskLevels ?? null,
    createdAt: now,
    lastActivityAt: now,
  };

  const db = await getDb();
  await db.collection<any>("meetings").insertOne(meeting);

  if (Array.isArray(meeting.extractedTasks)) {
    try {
      await syncTasksForSource(db, meeting.extractedTasks as ExtractedTaskSchema[], {
        userId,
        sourceSessionId: meeting._id,
        sourceSessionType: "meeting",
        sourceSessionName: meeting.title,
        origin: "meeting",
      });
    } catch (error) {
      console.error("Failed to sync meeting tasks after creation:", error);
    }
  }

  return NextResponse.json(serializeMeeting(meeting));
}

