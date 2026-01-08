import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { buildIdQuery } from "@/lib/mongo-id";

const collectDescendantTaskIds = async (
  db: any,
  userIdQuery: any,
  parentIds: string[]
) => {
  const allIds = new Set<string>(parentIds);
  const queue = [...parentIds];

  while (queue.length > 0) {
    const batch = queue.splice(0, 200);
    const children = await db
      .collection<any>("tasks")
      .find({
        userId: userIdQuery,
        parentId: { $in: batch },
      })
      .project({ _id: 1 })
      .toArray();

    children.forEach((child) => {
      const childId = String(child._id);
      if (!allIds.has(childId)) {
        allIds.add(childId);
        queue.push(childId);
      }
    });
  }

  return Array.from(allIds);
};

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

  const sessionIdList = Array.from(sessionIds);
  const tasksToRemove = await db
    .collection<any>("tasks")
    .find({
      userId: userIdQuery,
      sourceSessionType: "meeting",
      sourceSessionId: { $in: sessionIdList },
    })
    .project({ _id: 1 })
    .toArray();
  const rootTaskIds = tasksToRemove.map((task) => String(task._id));
  const taskIds = await collectDescendantTaskIds(db, userIdQuery, rootTaskIds);

  const deleteResult = await db.collection<any>("tasks").deleteMany({
    userId: userIdQuery,
    _id: { $in: taskIds },
  });

  if (taskIds.length) {
    await db.collection<any>("boardItems").deleteMany({
      userId: userIdQuery,
      taskId: { $in: taskIds },
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

  return NextResponse.json({
    ok: true,
    deletedMeetings: meetings.length,
    deletedTasks: deleteResult.deletedCount || 0,
  });
}
