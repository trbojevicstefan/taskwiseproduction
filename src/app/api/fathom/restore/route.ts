import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-route";
import { getSessionUserId } from "@/lib/server-auth";
import { getDb } from "@/lib/db";

export async function POST() {
  const userId = await getSessionUserId();
  if (!userId) {
    return apiError(401, "request_error", "Unauthorized");
  }

  const db = await getDb();
  const filter = {
    userId,
    isHidden: true,
    $or: [
      { ingestSource: "fathom" },
      { recordingIdHash: { $exists: true, $ne: null } },
      { recordingId: { $exists: true, $ne: null } },
    ],
  };

  const result = await db.collection("meetings").updateMany(filter, {
    $set: { isHidden: false },
    $unset: { hiddenAt: "" },
  });

  return NextResponse.json({ ok: true, restored: result.modifiedCount || 0 });
}



