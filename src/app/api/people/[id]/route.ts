import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";

const serializePerson = (person: any) => ({
  ...person,
  id: person._id,
  _id: undefined,
  createdAt: person.createdAt?.toISOString?.() || person.createdAt,
  lastSeenAt: person.lastSeenAt?.toISOString?.() || person.lastSeenAt,
});

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await getDb();
  const person = await db.collection<any>("people").findOne({ _id: params.id, userId });
  if (!person) {
    return NextResponse.json({ error: "Person not found" }, { status: 404 });
  }

  const taskCount = await db.collection<any>("tasks").countDocuments({
    userId,
    "assignee.uid": params.id,
  });

  return NextResponse.json({ ...serializePerson(person), taskCount });
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const update = { ...body, lastSeenAt: new Date() };

  const db = await getDb();
  await db.collection<any>("people").updateOne(
    { _id: params.id, userId },
    { $set: update }
  );

  const person = await db.collection<any>("people").findOne({ _id: params.id, userId });
  const taskCount = await db.collection<any>("tasks").countDocuments({
    userId,
    "assignee.uid": params.id,
  });

  return NextResponse.json({ ...serializePerson(person), taskCount });
}
