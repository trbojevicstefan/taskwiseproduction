import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/server-auth";
import { findUserById } from "@/lib/db/users";
import { fetchFathomMeetings, getValidFathomAccessToken } from "@/lib/fathom";
import { ingestFathomMeeting } from "@/lib/fathom-ingest";
import { getDb } from "@/lib/db";
import { buildIdQuery } from "@/lib/mongo-id";

type SyncRange = "today" | "this_week" | "last_week" | "this_month" | "all";

const extractRecordingId = (meeting: any) =>
  meeting?.recording_id ||
  meeting?.recordingId ||
  meeting?.recording?.id ||
  meeting?.recording?.recording_id ||
  meeting?.id ||
  null;

export async function POST(request: Request) {
  const requestUrl = new URL(request.url);
  const rangeParam = (requestUrl.searchParams.get("range") || "all") as SyncRange;
  const range: SyncRange = ["today", "this_week", "last_week", "this_month", "all"].includes(rangeParam)
    ? rangeParam
    : "all";

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

    const toDate = (value: any) => {
      if (!value) return null;
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? null : date;
    };
    const getMeetingDate = (meeting: any) =>
      toDate(
        meeting?.recording_start_time ||
          meeting?.recording_end_time ||
          meeting?.scheduled_start_time ||
          meeting?.created_at
      );

    const now = new Date();
    const startOfDay = (date: Date) =>
      new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const startOfWeek = (date: Date) => {
      const day = date.getDay();
      const diff = (day + 6) % 7;
      const start = new Date(date);
      start.setDate(date.getDate() - diff);
      start.setHours(0, 0, 0, 0);
      return start;
    };
    const startOfMonth = (date: Date) =>
      new Date(date.getFullYear(), date.getMonth(), 1);

    let rangeStart: Date | null = null;
    let rangeEnd: Date | null = null;

    switch (range) {
      case "today":
        rangeStart = startOfDay(now);
        rangeEnd = now;
        break;
      case "this_week":
        rangeStart = startOfWeek(now);
        rangeEnd = now;
        break;
      case "last_week": {
        const thisWeekStart = startOfWeek(now);
        const lastWeekEnd = new Date(thisWeekStart.getTime() - 1);
        rangeEnd = lastWeekEnd;
        rangeStart = startOfWeek(lastWeekEnd);
        break;
      }
      case "this_month":
        rangeStart = startOfMonth(now);
        rangeEnd = now;
        break;
      case "all":
      default:
        rangeStart = null;
        rangeEnd = null;
    }

    const filteredMeetings = meetings.filter((meeting: any) => {
      if (!rangeStart || !rangeEnd) return true;
      const meetingDate = getMeetingDate(meeting);
      if (!meetingDate) return false;
      return meetingDate >= rangeStart && meetingDate <= rangeEnd;
    });

    const db = await getDb();
    const userIdQuery = buildIdQuery(userId);
    const recordingIds = filteredMeetings
      .map((meeting: any) => extractRecordingId(meeting))
      .filter((id: any): id is string | number => Boolean(id))
      .map((id) => String(id));
    const existing = recordingIds.length
      ? await db
          .collection<any>("meetings")
          .find({ userId: userIdQuery, recordingId: { $in: recordingIds } })
          .project({ recordingId: 1 })
          .toArray()
      : [];
    const existingIds = new Set(
      existing.map((meeting) => String(meeting.recordingId))
    );

    let created = 0;
    let duplicate = 0;
    let skipped = 0;

    for (const meeting of filteredMeetings) {
      const recordingId = extractRecordingId(meeting);
      if (!recordingId) {
        skipped += 1;
        continue;
      }
      if (existingIds.has(String(recordingId))) {
        duplicate += 1;
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

    return NextResponse.json({ status: "ok", created, duplicate, skipped, range });
  } catch (error) {
    console.error("Fathom sync failed:", error);
    return NextResponse.json(
      { error: "Failed to sync Fathom meetings." },
      { status: 500 }
    );
  }
}
