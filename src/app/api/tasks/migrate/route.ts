import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { syncTasksForSource } from "@/lib/task-sync";
import type { ExtractedTaskSchema } from "@/types/chat";

export async function POST() {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await getDb();
  const meetings = await db
    .collection<any>("meetings")
    .find({ userId })
    .project({ _id: 1, title: 1, extractedTasks: 1 })
    .toArray();
  const chatSessions = await db
    .collection<any>("chatSessions")
    .find({ userId })
    .project({ _id: 1, title: 1, suggestedTasks: 1 })
    .toArray();

  let meetingsSynced = 0;
  let chatsSynced = 0;
  let upserted = 0;
  let deleted = 0;

  for (const meeting of meetings) {
    const tasks = (meeting.extractedTasks || []) as ExtractedTaskSchema[];
    const result = await syncTasksForSource(db, tasks, {
      userId,
      sourceSessionId: String(meeting._id),
      sourceSessionType: "meeting",
      sourceSessionName: meeting.title,
      origin: "meeting",
    });
    meetingsSynced += 1;
    upserted += result.upserted;
    deleted += result.deleted;
  }

  for (const session of chatSessions) {
    const tasks = (session.suggestedTasks || []) as ExtractedTaskSchema[];
    const result = await syncTasksForSource(db, tasks, {
      userId,
      sourceSessionId: String(session._id),
      sourceSessionType: "chat",
      sourceSessionName: session.title,
      origin: "chat",
    });
    chatsSynced += 1;
    upserted += result.upserted;
    deleted += result.deleted;
  }

  return NextResponse.json({
    meetingsSynced,
    chatsSynced,
    upserted,
    deleted,
  });
}
