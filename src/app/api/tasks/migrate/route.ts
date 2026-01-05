import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { buildIdQuery } from "@/lib/mongo-id";
import { syncTasksForSource } from "@/lib/task-sync";
import { getWorkspaceIdForUser } from "@/lib/workspace";
import type { ExtractedTaskSchema } from "@/types/chat";

export async function POST() {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await getDb();
  const userIdQuery = buildIdQuery(userId);
  const workspaceId = await getWorkspaceIdForUser(db, userId);
  const meetings = await db
    .collection<any>("meetings")
    .find({ userId: userIdQuery })
    .project({ _id: 1, id: 1, title: 1, extractedTasks: 1, chatSessionId: 1 })
    .toArray();
  const chatSessions = await db
    .collection<any>("chatSessions")
    .find({ userId: userIdQuery })
    .project({ _id: 1, id: 1, title: 1, suggestedTasks: 1, sourceMeetingId: 1 })
    .toArray();

  let meetingsSynced = 0;
  let chatsSynced = 0;
  let upserted = 0;
  let deleted = 0;
  const meetingLinkedChatIds = new Set<string>();

  for (const meeting of meetings) {
    const tasks = (meeting.extractedTasks || []) as ExtractedTaskSchema[];
    const result = await syncTasksForSource(db, tasks, {
      userId,
      workspaceId,
      sourceSessionId: String(meeting._id),
      sourceSessionType: "meeting",
      sourceSessionName: meeting.title,
      origin: "meeting",
      taskState: "active",
    });
    meetingsSynced += 1;
    upserted += result.upserted;
    deleted += result.deleted;
    if (meeting.chatSessionId) {
      meetingLinkedChatIds.add(String(meeting.chatSessionId));
    }
  }

  const skipChatIds = new Set<string>(meetingLinkedChatIds);
  chatSessions.forEach((session) => {
    if (session.sourceMeetingId) {
      if (session._id) skipChatIds.add(String(session._id));
      if (session.id) skipChatIds.add(String(session.id));
    }
  });
  if (skipChatIds.size) {
    const cleanup = await db.collection<any>("tasks").deleteMany({
      userId: userIdQuery,
      sourceSessionType: "chat",
      sourceSessionId: { $in: Array.from(skipChatIds) },
    });
    deleted += cleanup.deletedCount || 0;
  }

  for (const session of chatSessions) {
    const sessionId = String(session._id ?? session.id);
    if (skipChatIds.has(sessionId)) {
      continue;
    }
    const tasks = (session.suggestedTasks || []) as ExtractedTaskSchema[];
    const result = await syncTasksForSource(db, tasks, {
      userId,
      workspaceId,
      sourceSessionId: String(session._id ?? session.id),
      sourceSessionType: "chat",
      sourceSessionName: session.title,
      origin: "chat",
      taskState: "suggested",
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
