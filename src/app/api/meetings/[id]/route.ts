import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { buildIdQuery } from "@/lib/mongo-id";

const serializeMeeting = (meeting: any) => ({
  ...meeting,
  id: meeting._id,
  _id: undefined,
  createdAt: meeting.createdAt?.toISOString?.() || meeting.createdAt,
  lastActivityAt: meeting.lastActivityAt?.toISOString?.() || meeting.lastActivityAt,
});

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const update = { ...body, lastActivityAt: new Date() };

  const db = await getDb();
  const idQuery = buildIdQuery(params.id);
  const userIdQuery = buildIdQuery(userId);
  const filter = {
    userId: userIdQuery,
    $or: [{ _id: idQuery }, { id: params.id }],
  };
  await db.collection<any>("meetings").updateOne(filter, { $set: update });

  const meeting = await db.collection<any>("meetings").findOne(filter);
  return NextResponse.json(serializeMeeting(meeting));
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await getDb();
  const idQuery = buildIdQuery(params.id);
  const userIdQuery = buildIdQuery(userId);
  const filter = {
    userId: userIdQuery,
    $or: [{ _id: idQuery }, { id: params.id }],
  };
  const meeting = await db.collection<any>("meetings").findOne(filter);

  const result = await db.collection<any>("meetings").deleteOne(filter);
  if (!result.deletedCount) {
    return NextResponse.json({ error: "Meeting not found." }, { status: 404 });
  }

  if (meeting?.recordingId) {
    await db
      .collection<any>("meetings")
      .deleteMany({ userId: userIdQuery, recordingId: meeting.recordingId });
  }

  if (meeting?.chatSessionId) {
    await db.collection<any>("chatSessions").deleteOne({
      _id: buildIdQuery(meeting.chatSessionId),
      userId: userIdQuery,
    });
  }
  if (meeting?.planningSessionId) {
    await db.collection<any>("planningSessions").deleteOne({
      _id: buildIdQuery(meeting.planningSessionId),
      userId: userIdQuery,
    });
  }

  return NextResponse.json({ ok: true });
}
