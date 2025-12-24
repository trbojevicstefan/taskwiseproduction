import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { buildIdQuery } from "@/lib/mongo-id";

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
  const idQuery = buildIdQuery(params.id);
  const userIdQuery = buildIdQuery(userId);
  const person = await db
    .collection<any>("people")
    .findOne({ _id: idQuery, userId: userIdQuery });
  if (!person) {
    return NextResponse.json({ error: "Person not found" }, { status: 404 });
  }

  const assigneeQuery = buildIdQuery(params.id);
  const taskCount = await db.collection<any>("tasks").countDocuments({
    userId: userIdQuery,
    "assignee.uid": assigneeQuery,
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
  const idQuery = buildIdQuery(params.id);
  const userIdQuery = buildIdQuery(userId);
  await db.collection<any>("people").updateOne(
    { _id: idQuery, userId: userIdQuery },
    { $set: update }
  );

  const person = await db
    .collection<any>("people")
    .findOne({ _id: idQuery, userId: userIdQuery });
  const assigneeQuery = buildIdQuery(params.id);
  const taskCount = await db.collection<any>("tasks").countDocuments({
    userId: userIdQuery,
    "assignee.uid": assigneeQuery,
  });

  return NextResponse.json({ ...serializePerson(person), taskCount });
}
