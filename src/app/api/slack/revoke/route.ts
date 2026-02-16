import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-route";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { deleteSlackInstallation } from "@/lib/slack";

export async function POST() {
  const userId = await getSessionUserId();
  if (!userId) {
    return apiError(401, "request_error", "Unauthorized");
  }

  const db = await getDb();
  const user = await db
    .collection("users")
    .findOne({ _id: new ObjectId(userId) });

  if (!user?.slackTeamId) {
    return NextResponse.json({ success: true });
  }

  const teamId = user.slackTeamId;
  await db
    .collection("users")
    .updateOne(
      { _id: new ObjectId(userId) },
      { $set: { slackTeamId: null, lastUpdated: new Date() } }
    );

  const remaining = await db
    .collection("users")
    .countDocuments({ slackTeamId: teamId });
  if (remaining === 0) {
    await deleteSlackInstallation(teamId);
  }

  return NextResponse.json({ success: true });
}



