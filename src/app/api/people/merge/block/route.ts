import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api-route";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { normalizePersonNameKey } from "@/lib/transcript-utils";
import { resolveWorkspaceScopeForUser } from "@/lib/workspace-scope";

/**
 * POST /api/people/merge/block — remember a "do not merge" decision.
 *
 * Two shapes are supported:
 *  - { personId, otherPersonId }: block a pair of saved people from ever
 *    being merge-suggested again (recorded on both docs via
 *    blockedMergePersonIds).
 *  - { personId, blockedName?, blockedEmail? }: block a discovered (not yet
 *    saved) candidate from matching this saved person again (recorded as
 *    normalized keys in blockedMergeKeys).
 *
 * Both mechanisms are honored by src/lib/people-matching.ts, so a blocked
 * pair survives re-suggestion indefinitely.
 */
const blockMergeSchema = z
  .object({
    personId: z.string().min(1),
    otherPersonId: z.string().min(1).optional(),
    blockedName: z.string().optional(),
    blockedEmail: z.string().optional(),
  })
  .strict();

export async function POST(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) {
    return apiError(401, "request_error", "Unauthorized");
  }

  const rawBody = await request.json().catch(() => ({}));
  const parsed = blockMergeSchema.safeParse(rawBody);
  if (!parsed.success) {
    return apiError(
      400,
      "request_error",
      "Invalid block payload.",
      parsed.error.flatten()
    );
  }
  const body = parsed.data;

  const blockedNameKey = body.blockedName
    ? normalizePersonNameKey(body.blockedName)
    : "";
  const blockedEmailKey = body.blockedEmail
    ? body.blockedEmail.trim().toLowerCase()
    : "";

  if (!body.otherPersonId && !blockedNameKey && !blockedEmailKey) {
    return apiError(
      400,
      "request_error",
      "Provide otherPersonId or a blockedName/blockedEmail."
    );
  }

  const db = await getDb();
  const { workspaceId, workspaceMemberUserIds } = await resolveWorkspaceScopeForUser(db, userId, {
    minimumRole: "member",
    includeMemberUserIds: true,
  });
  const workspaceFallbackScope = {
    $or: [
      { workspaceId },
      {
        workspaceId: { $exists: false },
        userId: { $in: workspaceMemberUserIds },
      },
    ],
  };

  const findPerson = (id: string) =>
    db.collection("people").findOne({
      $and: [
        workspaceFallbackScope as any,
        { $or: [{ _id: id }, { id }, { slackId: id }] },
      ],
    } as any);

  const person = await findPerson(body.personId);
  if (!person) {
    return apiError(404, "request_error", "Person not found.");
  }

  if (body.otherPersonId) {
    const other = await findPerson(body.otherPersonId);
    if (!other) {
      return apiError(404, "request_error", "Person not found.");
    }
    if (String(person._id) === String(other._id)) {
      return apiError(400, "request_error", "Cannot block a person against themselves.");
    }
    await db.collection("people").updateOne(
      { _id: person._id },
      { $addToSet: { blockedMergePersonIds: String(other._id) } }
    );
    await db.collection("people").updateOne(
      { _id: other._id },
      { $addToSet: { blockedMergePersonIds: String(person._id) } }
    );
    return NextResponse.json({ ok: true, blocked: "pair" });
  }

  const keys = [blockedNameKey, blockedEmailKey].filter(Boolean);
  await db.collection("people").updateOne(
    { _id: person._id },
    { $addToSet: { blockedMergeKeys: { $each: keys } } }
  );
  return NextResponse.json({ ok: true, blocked: "keys", keys });
}
