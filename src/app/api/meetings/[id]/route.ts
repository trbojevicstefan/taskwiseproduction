import { NextResponse } from "next/server";
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

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const { recordingId, recordingIdHash, ...safeBody } = body || {};
  const update = { ...safeBody, lastActivityAt: new Date() };

  const db = await getDb();
  const idQuery = buildIdQuery(id);
  const userIdQuery = buildIdQuery(userId);
  const filter = {
    userId: userIdQuery,
    $or: [{ _id: idQuery }, { id }],
  };
  await db.collection<any>("meetings").updateOne(filter, { $set: update });

  const meeting = await db.collection<any>("meetings").findOne(filter);
  if (Array.isArray(body.extractedTasks)) {
    try {
      await syncTasksForSource(db, body.extractedTasks as ExtractedTaskSchema[], {
        userId,
        sourceSessionId: String(meeting?._id ?? id),
        sourceSessionType: "meeting",
        sourceSessionName: meeting?.title || body.title || "Meeting",
        origin: "meeting",
      });
    } catch (error) {
      console.error("Failed to sync meeting tasks after update:", error);
    }
  }
  return NextResponse.json(serializeMeeting(meeting));
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await getDb();
  const idQuery = buildIdQuery(id);
  const userIdQuery = buildIdQuery(userId);
  const filter = {
    userId: userIdQuery,
    $or: [{ _id: idQuery }, { id }],
  };

  const meeting = await db.collection<any>("meetings").findOne(filter);
  if (!meeting || meeting.isHidden) {
    return NextResponse.json({ error: "Meeting not found." }, { status: 404 });
  }

  return NextResponse.json(serializeMeeting(meeting));
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await getDb();
  const idQuery = buildIdQuery(id);
  const userIdQuery = buildIdQuery(userId);
  const filter = {
    userId: userIdQuery,
    $or: [{ _id: idQuery }, { id }],
  };
  const meeting = await db.collection<any>("meetings").findOne(filter);
  if (!meeting) {
    return NextResponse.json({ error: "Meeting not found." }, { status: 404 });
  }
  const now = new Date();
  const sessionIds = new Set<string>();
  if (meeting?._id) sessionIds.add(String(meeting._id));
  if (meeting?.id) sessionIds.add(String(meeting.id));
  sessionIds.add(String(id));
  const chatSessionIds = new Set<string>();
  if (meeting?.chatSessionId) {
    chatSessionIds.add(String(meeting.chatSessionId));
  }

  await db.collection<any>("meetings").updateOne(filter, {
    $set: {
      isHidden: true,
      hiddenAt: now,
      lastActivityAt: now,
      extractedTasks: [],
    },
  });

  if (sessionIds.size > 0) {
    await db.collection<any>("tasks").deleteMany({
      userId: userIdQuery,
      sourceSessionType: "meeting",
      sourceSessionId: { $in: Array.from(sessionIds) },
    });
  }

  const chatMeetingIds = Array.from(sessionIds);
  const chatIds = Array.from(chatSessionIds);
  if (chatMeetingIds.length || chatIds.length) {
    await db.collection<any>("chatSessions").deleteMany({
      userId: userIdQuery,
      $or: [
        chatMeetingIds.length
          ? { sourceMeetingId: { $in: chatMeetingIds } }
          : undefined,
        chatIds.length ? { _id: { $in: chatIds } } : undefined,
        chatIds.length ? { id: { $in: chatIds } } : undefined,
      ].filter(Boolean),
    });
  }

  return NextResponse.json({ ok: true });
}
