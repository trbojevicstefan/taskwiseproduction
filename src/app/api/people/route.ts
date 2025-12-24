import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { buildIdQuery, matchesId } from "@/lib/mongo-id";

const serializePerson = (person: any) => ({
  ...person,
  id: person._id,
  _id: undefined,
  createdAt: person.createdAt?.toISOString?.() || person.createdAt,
  lastSeenAt: person.lastSeenAt?.toISOString?.() || person.lastSeenAt,
});

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await getDb();
  const userIdQuery = buildIdQuery(userId);
  const people = await db
    .collection<any>("people")
    .find({ userId: userIdQuery })
    .sort({ lastSeenAt: -1 })
    .toArray();

  const tasks = await db
    .collection<any>("tasks")
    .find({ userId: userIdQuery })
    .toArray();
  const peopleWithCounts = people.map((person) => {
    const taskCount = tasks.filter((task) =>
      matchesId(task.assignee?.uid, person._id?.toString?.() || String(person._id))
    ).length;
    return { ...serializePerson(person), taskCount };
  });

  return NextResponse.json(peopleWithCounts);
}

export async function POST(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const sourceSessionId = typeof body.sourceSessionId === "string" ? body.sourceSessionId : null;

  if (!name) {
    return NextResponse.json({ error: "Person name is required." }, { status: 400 });
  }

  const db = await getDb();
  const userIdQuery = buildIdQuery(userId);
  const existing = await db
    .collection<any>("people")
    .findOne({ userId: userIdQuery, name });
  const now = new Date();

  if (existing) {
    const updatedSourceSessions = new Set(existing.sourceSessionIds || []);
    if (sourceSessionId) updatedSourceSessions.add(sourceSessionId);

    await db.collection<any>("people").updateOne(
      { _id: existing._id, userId: userIdQuery },
      {
        $set: {
          lastSeenAt: now,
          ...(body.email ? { email: body.email } : {}),
          ...(body.title ? { title: body.title } : {}),
          ...(body.avatarUrl ? { avatarUrl: body.avatarUrl } : {}),
          sourceSessionIds: Array.from(updatedSourceSessions),
        },
      }
    );

    const refreshed = await db
      .collection<any>("people")
      .findOne({ _id: existing._id, userId: userIdQuery });
    return NextResponse.json(serializePerson(refreshed));
  }

  const person = {
    _id: randomUUID(),
    userId,
    name,
    email: body.email || null,
    title: body.title || null,
    avatarUrl: body.avatarUrl || null,
    slackId: null,
    firefliesId: null,
    phantomBusterId: null,
    aliases: body.aliases || [],
    sourceSessionIds: sourceSessionId ? [sourceSessionId] : [],
    createdAt: now,
    lastSeenAt: now,
  };

  await db.collection<any>("people").insertOne(person);

  return NextResponse.json(serializePerson(person));
}

