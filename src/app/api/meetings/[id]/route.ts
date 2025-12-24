import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";

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
  await db.collection<any>("meetings").updateOne(
    { _id: params.id, userId },
    { $set: update }
  );

  const meeting = await db.collection<any>("meetings").findOne({ _id: params.id, userId });
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
  const meeting = await db.collection<any>("meetings").findOne({ _id: params.id, userId });

  await db.collection<any>("meetings").deleteOne({ _id: params.id, userId });

  if (meeting?.chatSessionId) {
    await db.collection<any>("chatSessions").deleteOne({ _id: meeting.chatSessionId, userId });
  }
  if (meeting?.planningSessionId) {
    await db.collection<any>("planningSessions").deleteOne({ _id: meeting.planningSessionId, userId });
  }

  return NextResponse.json({ ok: true });
}
