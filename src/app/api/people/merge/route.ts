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

export async function POST(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const sourceId = typeof body.sourceId === "string" ? body.sourceId : "";
  const targetId = typeof body.targetId === "string" ? body.targetId : "";

  if (!sourceId || !targetId) {
    return NextResponse.json(
      { error: "sourceId and targetId are required." },
      { status: 400 }
    );
  }

  const db = await getDb();
  const userIdQuery = buildIdQuery(userId);

  const sourceQuery = buildIdQuery(sourceId);
  const targetQuery = buildIdQuery(targetId);

  const source = await db.collection<any>("people").findOne({
    userId: userIdQuery,
    $or: [{ _id: sourceQuery }, { id: sourceId }, { slackId: sourceId }],
  });
  const target = await db.collection<any>("people").findOne({
    userId: userIdQuery,
    $or: [{ _id: targetQuery }, { id: targetId }, { slackId: targetId }],
  });

  if (!source || !target) {
    return NextResponse.json({ error: "Person not found." }, { status: 404 });
  }
  if (String(source._id) === String(target._id)) {
    return NextResponse.json({ error: "Cannot merge the same person." }, { status: 400 });
  }

  const aliasSet = new Set<string>([
    ...(target.aliases || []),
    ...(source.aliases || []),
  ]);
  if (source.name) aliasSet.add(source.name);

  const update: Record<string, any> = {
    aliases: Array.from(aliasSet).filter(Boolean),
    lastSeenAt: new Date(),
  };
  const sourceSessions = new Set<string>([
    ...(target.sourceSessionIds || []),
    ...(source.sourceSessionIds || []),
  ]);
  update.sourceSessionIds = Array.from(sourceSessions);
  if (!target.email && source.email) update.email = source.email;
  if (!target.title && source.title) update.title = source.title;
  if (!target.avatarUrl && source.avatarUrl) update.avatarUrl = source.avatarUrl;
  if (!target.slackId && source.slackId) update.slackId = source.slackId;

  await db.collection<any>("people").updateOne({ _id: target._id }, { $set: update });

  const sourceAssignee = buildIdQuery(String(source._id || source.id || sourceId));
  const targetAssignee = {
    uid: String(target._id || target.id || targetId),
    name: target.name,
    email: target.email ?? update.email ?? null,
    photoURL: target.avatarUrl ?? update.avatarUrl ?? null,
  };

  await db.collection<any>("tasks").updateMany(
    { userId: userIdQuery, "assignee.uid": sourceAssignee },
    { $set: { assignee: targetAssignee, assigneeName: targetAssignee.name } }
  );

  await db.collection<any>("people").deleteOne({ _id: source._id });

  const refreshed = await db.collection<any>("people").findOne({ _id: target._id });
  return NextResponse.json({ ok: true, person: serializePerson(refreshed) });
}
