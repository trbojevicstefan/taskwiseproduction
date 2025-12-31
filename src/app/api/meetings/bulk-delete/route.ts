import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { buildIdQuery } from "@/lib/mongo-id";

export async function POST(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const ids = Array.isArray(body?.ids)
    ? body.ids.map((id: any) => String(id)).filter(Boolean)
    : [];
  if (ids.length === 0) {
    return NextResponse.json(
      { error: "Meeting IDs are required." },
      { status: 400 }
    );
  }

  const uniqueIds = Array.from(new Set(ids));
  const db = await getDb();
  const userIdQuery = buildIdQuery(userId);
  const meetingFilter = {
    userId: userIdQuery,
    $or: [{ _id: { $in: uniqueIds } }, { id: { $in: uniqueIds } }],
  };

  const meetings = await db
    .collection<any>("meetings")
    .find(meetingFilter)
    .toArray();

  if (meetings.length === 0) {
    return NextResponse.json({ error: "Meetings not found." }, { status: 404 });
  }

  const sessionIds = new Set<string>();
  const chatSessionIds = new Set<string>();
  meetings.forEach((meeting) => {
    if (meeting?._id) sessionIds.add(String(meeting._id));
    if (meeting?.id) sessionIds.add(String(meeting.id));
    if (meeting?.chatSessionId) {
      chatSessionIds.add(String(meeting.chatSessionId));
    }
  });
  uniqueIds.forEach((id) => sessionIds.add(String(id)));

  const now = new Date();
  await db.collection<any>("meetings").updateMany(meetingFilter, {
    $set: {
      isHidden: true,
      hiddenAt: now,
      lastActivityAt: now,
      extractedTasks: [],
    },
  });

  const deleteResult = await db.collection<any>("tasks").deleteMany({
    userId: userIdQuery,
    sourceSessionType: "meeting",
    sourceSessionId: { $in: Array.from(sessionIds) },
  });

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

  return NextResponse.json({
    ok: true,
    deletedMeetings: meetings.length,
    deletedTasks: deleteResult.deletedCount || 0,
  });
}
