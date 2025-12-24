import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";

const serializeMeeting = (meeting: any) => ({
  ...meeting,
  id: meeting._id,
  _id: undefined,
  createdAt: meeting.createdAt?.toISOString?.() || meeting.createdAt,
  lastActivityAt: meeting.lastActivityAt?.toISOString?.() || meeting.lastActivityAt,
});

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await getDb();
  const meetings = await db
    .collection<any>("meetings")
    .find({ userId })
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
  const now = new Date();
  const meeting = {
    _id: randomUUID(),
    userId,
    title: body.title || "Meeting",
    originalTranscript: body.originalTranscript || "",
    summary: body.summary || "",
    attendees: body.attendees || [],
    extractedTasks: body.extractedTasks || [],
    originalAiTasks: body.originalAiTasks || body.extractedTasks || [],
    originalAllTaskLevels: body.originalAllTaskLevels || body.allTaskLevels || null,
    taskRevisions: body.taskRevisions || [],
    chatSessionId: body.chatSessionId ?? null,
    planningSessionId: body.planningSessionId ?? null,
    allTaskLevels: body.allTaskLevels ?? null,
    createdAt: now,
    lastActivityAt: now,
  };

  const db = await getDb();
  await db.collection<any>("meetings").insertOne(meeting);

  return NextResponse.json(serializeMeeting(meeting));
}

