import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { buildIdQuery } from "@/lib/mongo-id";

const serializeSession = (session: any) => ({
  ...session,
  id: session._id,
  _id: undefined,
  createdAt: session.createdAt?.toISOString?.() || session.createdAt,
  lastActivityAt: session.lastActivityAt?.toISOString?.() || session.lastActivityAt,
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
  await db.collection<any>("planningSessions").updateOne(
    { _id: idQuery, userId },
    { $set: update }
  );

  const session = await db
    .collection<any>("planningSessions")
    .findOne({ _id: idQuery, userId });
  return NextResponse.json(serializeSession(session));
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
  const result = await db
    .collection<any>("planningSessions")
    .deleteOne({ _id: idQuery, userId });
  if (!result.deletedCount) {
    return NextResponse.json({ error: "Planning session not found." }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
