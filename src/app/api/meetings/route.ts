import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { buildIdQuery } from "@/lib/mongo-id";
import { upsertPeopleFromAttendees } from "@/lib/people-sync";
import { syncTasksForSource } from "@/lib/task-sync";
import { ensureDefaultBoard } from "@/lib/boards";
import { ensureBoardItemsForTasks } from "@/lib/board-items";
import { getWorkspaceIdForUser } from "@/lib/workspace";
import type { ExtractedTaskSchema } from "@/types/chat";

const serializeMeeting = (meeting: any) => {
  const { recordingId, recordingIdHash, ...rest } = meeting;
  return {
    ...rest,
    id: meeting._id,
    _id: undefined,
    createdAt: meeting.createdAt?.toISOString?.() || meeting.createdAt,
    lastActivityAt: meeting.lastActivityAt?.toISOString?.() || meeting.lastActivityAt,
  };
};

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userIdQuery = buildIdQuery(userId);
  const db = await getDb();
  const meetings = await db
    .collection<any>("meetings")
    .find({ userId: userIdQuery, isHidden: { $ne: true } })
    .sort({ lastActivityAt: -1 })
    .toArray();

  return NextResponse.json(meetings.map(serializeMeeting));
}

export async function POST(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const { recordingId, recordingIdHash, ...safeBody } = body || {};
  const now = new Date();
  const db = await getDb();
  const workspaceId = await getWorkspaceIdForUser(db, userId);
  const meeting = {
    _id: randomUUID(),
    userId,
    workspaceId,
    title: safeBody.title || "Meeting",
    originalTranscript: safeBody.originalTranscript || "",
    summary: safeBody.summary || "",
    attendees: safeBody.attendees || [],
    extractedTasks: safeBody.extractedTasks || [],
    originalAiTasks: safeBody.originalAiTasks || safeBody.extractedTasks || [],
    originalAllTaskLevels: safeBody.originalAllTaskLevels || safeBody.allTaskLevels || null,
    taskRevisions: safeBody.taskRevisions || [],
    chatSessionId: safeBody.chatSessionId ?? null,
    planningSessionId: safeBody.planningSessionId ?? null,
    allTaskLevels: safeBody.allTaskLevels ?? null,
    createdAt: now,
    lastActivityAt: now,
  };

  await db.collection<any>("meetings").insertOne(meeting);

  if (Array.isArray(meeting.attendees) && meeting.attendees.length) {
    try {
      await upsertPeopleFromAttendees({
        db,
        userId,
        attendees: meeting.attendees,
        sourceSessionId: String(meeting._id),
      });
    } catch (error) {
      console.error("Failed to upsert people from meeting attendees:", error);
    }
  }

  if (Array.isArray(meeting.extractedTasks)) {
    try {
      await syncTasksForSource(db, meeting.extractedTasks as ExtractedTaskSchema[], {
        userId,
        workspaceId,
        sourceSessionId: meeting._id,
        sourceSessionType: "meeting",
        sourceSessionName: meeting.title,
        origin: "meeting",
        taskState: "active",
      });
      if (workspaceId) {
        const defaultBoard = await ensureDefaultBoard(db, userId, workspaceId);
        await ensureBoardItemsForTasks(db, {
          userId,
          workspaceId,
          boardId: defaultBoard._id,
          tasks: meeting.extractedTasks as ExtractedTaskSchema[],
        });
      }
    } catch (error) {
      console.error("Failed to sync meeting tasks after creation:", error);
    }
  }

  return NextResponse.json(serializeMeeting(meeting));
}

