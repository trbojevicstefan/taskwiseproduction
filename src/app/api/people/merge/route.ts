import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-route";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";

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
    return apiError(401, "request_error", "Unauthorized");
  }

  const body = await request.json().catch(() => ({}));
  const sourceId = typeof body.sourceId === "string" ? body.sourceId : "";
  const targetId = typeof body.targetId === "string" ? body.targetId : "";

  if (!sourceId || !targetId) {
    return apiError(400, "request_error", "sourceId and targetId are required.");
  }

  const db = await getDb();

  const source = await db.collection("people").findOne({
    userId,
    $or: [{ _id: sourceId }, { id: sourceId }, { slackId: sourceId }],
  });
  const target = await db.collection("people").findOne({
    userId,
    $or: [{ _id: targetId }, { id: targetId }, { slackId: targetId }],
  });

  if (!source || !target) {
    return apiError(404, "request_error", "Person not found.");
  }
  if (String(source._id) === String(target._id)) {
    return apiError(400, "request_error", "Cannot merge the same person.");
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

  await db.collection("people").updateOne({ _id: target._id }, { $set: update });

  const sourceAssigneeIds = Array.from(
    new Set([
      String(source._id || ""),
      String(source.id || ""),
      String(sourceId || ""),
      String(source.slackId || ""),
    ].filter(Boolean))
  );
  const targetAssignee = {
    uid: String(target._id || target.id || targetId),
    name: target.name,
    email: target.email ?? update.email ?? null,
    photoURL: target.avatarUrl ?? update.avatarUrl ?? null,
  };

  await db.collection("tasks").updateMany(
    { userId, "assignee.uid": { $in: sourceAssigneeIds } },
    { $set: { assignee: targetAssignee, assigneeName: targetAssignee.name } }
  );

  await db.collection("people").deleteOne({ _id: source._id });

  const refreshed = await db.collection("people").findOne({ _id: target._id });
  return NextResponse.json({ ok: true, person: serializePerson(refreshed) });
}



