import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/server-auth";
import { findUserById } from "@/lib/db/users";
import { fetchFathomMeetings, getValidFathomAccessToken } from "@/lib/fathom";
import { ingestFathomMeeting } from "@/lib/fathom-ingest";

const extractRecordingId = (meeting: any) =>
  meeting?.recording_id ||
  meeting?.recordingId ||
  meeting?.recording?.id ||
  meeting?.recording?.recording_id ||
  meeting?.id ||
  null;

export async function POST() {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await findUserById(userId);
  if (!user) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  try {
    const accessToken = await getValidFathomAccessToken(userId);
    const meetings = await fetchFathomMeetings(accessToken);

    let created = 0;
    let duplicate = 0;
    let skipped = 0;

    for (const meeting of meetings) {
      const recordingId = extractRecordingId(meeting);
      if (!recordingId) {
        skipped += 1;
        continue;
      }

      const result = await ingestFathomMeeting({
        user,
        recordingId: String(recordingId),
        data: meeting,
        accessToken,
      });

      if (result.status === "created") created += 1;
      else if (result.status === "duplicate") duplicate += 1;
      else skipped += 1;
    }

    return NextResponse.json({ status: "ok", created, duplicate, skipped });
  } catch (error) {
    console.error("Fathom sync failed:", error);
    return NextResponse.json(
      { error: "Failed to sync Fathom meetings." },
      { status: 500 }
    );
  }
}
