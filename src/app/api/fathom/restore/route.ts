import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/server-auth";
import { getDb } from "@/lib/db";
import { buildIdQuery } from "@/lib/mongo-id";

export async function POST() {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await getDb();
  const userIdQuery = buildIdQuery(userId);
  const filter = {
    userId: userIdQuery,
    isHidden: true,
    $or: [
      { ingestSource: "fathom" },
      { recordingIdHash: { $exists: true, $ne: null } },
      { recordingId: { $exists: true, $ne: null } },
    ],
  };

  const result = await db.collection<any>("meetings").updateMany(filter, {
    $set: { isHidden: false },
    $unset: { hiddenAt: "" },
  });

  return NextResponse.json({ ok: true, restored: result.modifiedCount || 0 });
}
