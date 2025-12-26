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
  const person = await db
    .collection<any>("people")
    .findOne({
      userId: userIdQuery,
      $or: [{ _id: idQuery }, { id }, { slackId: id }],
    });
  if (!person) {
    return NextResponse.json({ error: "Person not found" }, { status: 404 });
  }

  const assigneeId = person.id ?? person._id ?? id;
  const assigneeQuery = buildIdQuery(String(assigneeId));
  const taskCount = await db.collection<any>("tasks").countDocuments({
    userId: userIdQuery,
    "assignee.uid": assigneeQuery,
  });

  return NextResponse.json({ ...serializePerson(person), taskCount });
}

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
  const update = { ...body, lastSeenAt: new Date() };

  const db = await getDb();
  const idQuery = buildIdQuery(id);
  const userIdQuery = buildIdQuery(userId);
  const existing = await db
    .collection<any>("people")
    .findOne({
      userId: userIdQuery,
      $or: [{ _id: idQuery }, { id }, { slackId: id }],
    });
  if (!existing) {
    return NextResponse.json({ error: "Person not found" }, { status: 404 });
  }

  await db.collection<any>("people").updateOne(
    { _id: existing._id },
    { $set: update }
  );

  const person = await db
    .collection<any>("people")
    .findOne({ _id: existing._id });
  const assigneeId = person.id ?? person._id ?? id;
  const assigneeQuery = buildIdQuery(String(assigneeId));
  const taskCount = await db.collection<any>("tasks").countDocuments({
    userId: userIdQuery,
    "assignee.uid": assigneeQuery,
  });

  return NextResponse.json({ ...serializePerson(person), taskCount });
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

  const person = await db
    .collection<any>("people")
    .findOne({
      userId: userIdQuery,
      $or: [{ _id: idQuery }, { id }, { slackId: id }],
    });
  if (!person) {
    return NextResponse.json({ error: "Person not found" }, { status: 404 });
  }

  await db.collection<any>("people").deleteOne({ _id: person._id });
  const assigneeId = person.id ?? person._id ?? id;
  const assigneeQuery = buildIdQuery(String(assigneeId));
  await db.collection<any>("tasks").updateMany(
    { userId: userIdQuery, "assignee.uid": assigneeQuery },
    { $set: { assignee: null, assigneeName: null } }
  );

  const nameMatches = new Set<string>();
  if (person.name) nameMatches.add(person.name);
  if (Array.isArray(person.aliases)) {
    person.aliases.forEach((alias: string) => {
      if (alias) nameMatches.add(alias);
    });
  }
  const emailMatches = new Set<string>();
  if (person.email) emailMatches.add(person.email);

  if (nameMatches.size || emailMatches.size) {
    const nameList = Array.from(nameMatches);
    const emailList = Array.from(emailMatches);
    await db.collection<any>("meetings").updateMany(
      { userId: userIdQuery },
      {
        $pull: {
          attendees: {
            $or: [
              ...(nameList.length ? [{ name: { $in: nameList } }] : []),
              ...(emailList.length ? [{ email: { $in: emailList } }] : []),
            ],
          },
        },
      }
    );
    await db.collection<any>("chatSessions").updateMany(
      { userId: userIdQuery },
      {
        $pull: {
          people: {
            $or: [
              ...(nameList.length ? [{ name: { $in: nameList } }] : []),
              ...(emailList.length ? [{ email: { $in: emailList } }] : []),
            ],
          },
        },
      }
    );
  }

  return NextResponse.json({ ok: true });
}
