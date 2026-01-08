import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { buildIdQuery } from "@/lib/mongo-id";
import { normalizeTask } from "@/lib/data";
import { upsertPeopleFromAttendees } from "@/lib/people-sync";
import { syncTasksForSource } from "@/lib/task-sync";
import { ensureBoardItemsForTasks } from "@/lib/board-items";
import { ensureDefaultBoard } from "@/lib/boards";
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

const collectSessionIds = (session: any, fallbackId?: string | null) => {
  const ids = new Set<string>();
  if (session?._id) ids.add(String(session._id));
  if (session?.id) ids.add(String(session.id));
  if (fallbackId) ids.add(String(fallbackId));
  return Array.from(ids);
};

const ACTIVITY_KEYS = new Set([
  "artifacts",
  "recordingId",
  "recordingIdHash",
  "originalTranscript",
  "summary",
  "meetingMetadata",
  "startTime",
  "endTime",
  "duration",
  "state",
  "tags",
]);

const shouldRefreshLastActivity = (payload: Record<string, any> | null) => {
  if (!payload) return false;
  if (Array.isArray(payload.extractedTasks) && payload.extractedTasks.length > 0) {
    return true;
  }
  return Array.from(ACTIVITY_KEYS).some((key) =>
    Object.prototype.hasOwnProperty.call(payload, key)
  );
};

const updateLinkedChatSessions = async (
  db: any,
  userId: string,
  meeting: any,
  tasks: ExtractedTaskSchema[]
) => {
  const meetingIds = collectSessionIds(meeting);
  const chatFilters: any[] = [];
  if (meeting?.chatSessionId) {
    const chatId = String(meeting.chatSessionId);
    chatFilters.push({ _id: buildIdQuery(chatId) }, { id: chatId });
  }
  if (meetingIds.length > 0) {
    chatFilters.push({ sourceMeetingId: { $in: meetingIds } });
  }
  if (!chatFilters.length) return [];

  const userIdQuery = buildIdQuery(userId);
  const filter = { userId: userIdQuery, $or: chatFilters };
  const sessions = await db.collection<any>("chatSessions").find(filter).toArray();
  if (!sessions.length) return [];

  await db.collection<any>("chatSessions").updateMany(filter, {
    $set: { suggestedTasks: tasks, lastActivityAt: new Date() },
  });
  return sessions;
};

const cleanupChatTasksForSessions = async (
  db: any,
  userId: string,
  sessions: any[]
) => {
  if (!sessions.length) return;
  const sessionIds = new Set<string>();
  sessions.forEach((session) => {
    if (session?._id) sessionIds.add(String(session._id));
    if (session?.id) sessionIds.add(String(session.id));
  });
  if (!sessionIds.size) return;
  const userIdQuery = buildIdQuery(userId);
  await db.collection<any>("tasks").deleteMany({
    userId: userIdQuery,
    sourceSessionType: "chat",
    sourceSessionId: { $in: Array.from(sessionIds) },
  });
};

const collectDescendantTaskIds = async (
  db: any,
  userIdQuery: any,
  parentIds: string[]
) => {
  const allIds = new Set<string>(parentIds);
  const queue = [...parentIds];

  while (queue.length > 0) {
    const batch = queue.splice(0, 200);
    const children = await db
      .collection<any>("tasks")
      .find({
        userId: userIdQuery,
        parentId: { $in: batch },
      })
      .project({ _id: 1 })
      .toArray();

    children.forEach((child) => {
      const childId = String(child._id);
      if (!allIds.has(childId)) {
        allIds.add(childId);
        queue.push(childId);
      }
    });
  }

  return Array.from(allIds);
};

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const { recordingId, recordingIdHash, ...safeBody } = body || {};
  const update: Record<string, any> = { ...safeBody };
  let extractedTasks: ExtractedTaskSchema[] | null = null;
  if (Array.isArray(safeBody.extractedTasks)) {
    extractedTasks = safeBody.extractedTasks.map((task: ExtractedTaskSchema) =>
      normalizeTask(task)
    );
    update.extractedTasks = extractedTasks;
  }
  if (shouldRefreshLastActivity(safeBody)) {
    update.lastActivityAt = new Date();
  }

  const db = await getDb();
  const idQuery = buildIdQuery(id);
  const userIdQuery = buildIdQuery(userId);
  const filter = {
    userId: userIdQuery,
    $or: [{ _id: idQuery }, { id }],
  };
  await db.collection<any>("meetings").updateOne(filter, { $set: update });

  const meeting = await db.collection<any>("meetings").findOne(filter);
  if (extractedTasks) {
    try {
      const workspaceId =
        meeting?.workspaceId || (await getWorkspaceIdForUser(db, userId));
      await syncTasksForSource(db, extractedTasks, {
        userId,
        workspaceId,
        sourceSessionId: String(meeting?._id ?? id),
        sourceSessionType: "meeting",
        sourceSessionName: meeting?.title || body.title || "Meeting",
        origin: "meeting",
        taskState: "active",
      });
      if (meeting) {
        const linkedSessions = await updateLinkedChatSessions(
          db,
          userId,
          meeting,
          extractedTasks
        );
        await cleanupChatTasksForSessions(db, userId, linkedSessions);
      }
      if (workspaceId) {
        const defaultBoard = await ensureDefaultBoard(db, userId, workspaceId);
        await ensureBoardItemsForTasks(db, {
          userId,
          workspaceId,
          boardId: defaultBoard._id,
          tasks: extractedTasks,
        });
      }
    } catch (error) {
      console.error("Failed to sync meeting tasks after update:", error);
    }
  }

  if (meeting && Array.isArray(meeting.attendees) && meeting.attendees.length) {
    try {
      await upsertPeopleFromAttendees({
        db,
        userId,
        attendees: meeting.attendees,
        sourceSessionId: String(meeting._id ?? id),
      });
    } catch (error) {
      console.error("Failed to upsert people from meeting attendees:", error);
    }
  }
  return NextResponse.json(serializeMeeting(meeting));
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await getDb();
  const idQuery = buildIdQuery(id);
  const userIdQuery = buildIdQuery(userId);
  const filter = {
    userId: userIdQuery,
    $or: [{ _id: idQuery }, { id }],
  };

  const meeting = await db.collection<any>("meetings").findOne(filter);
  if (!meeting || meeting.isHidden) {
    return NextResponse.json({ error: "Meeting not found." }, { status: 404 });
  }

  return NextResponse.json(serializeMeeting(meeting));
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await getDb();
  const idQuery = buildIdQuery(id);
  const userIdQuery = buildIdQuery(userId);
  const filter = {
    userId: userIdQuery,
    $or: [{ _id: idQuery }, { id }],
  };
  const meeting = await db.collection<any>("meetings").findOne(filter);
  if (!meeting) {
    return NextResponse.json({ error: "Meeting not found." }, { status: 404 });
  }
  const now = new Date();
  const sessionIds = new Set<string>();
  if (meeting?._id) sessionIds.add(String(meeting._id));
  if (meeting?.id) sessionIds.add(String(meeting.id));
  sessionIds.add(String(id));
  const chatSessionIds = new Set<string>();
  if (meeting?.chatSessionId) {
    chatSessionIds.add(String(meeting.chatSessionId));
  }

  await db.collection<any>("meetings").updateOne(filter, {
    $set: {
      isHidden: true,
      hiddenAt: now,
      lastActivityAt: now,
      extractedTasks: [],
    },
  });

  if (sessionIds.size > 0) {
    const sessionIdList = Array.from(sessionIds);
    const tasksToRemove = await db
      .collection<any>("tasks")
      .find({
        userId: userIdQuery,
        sourceSessionType: "meeting",
        sourceSessionId: { $in: sessionIdList },
      })
      .project({ _id: 1 })
      .toArray();
    const rootTaskIds = tasksToRemove.map((task) => String(task._id));
    const taskIds = await collectDescendantTaskIds(db, userIdQuery, rootTaskIds);

    await db.collection<any>("tasks").deleteMany({
      userId: userIdQuery,
      _id: { $in: taskIds },
    });

    if (taskIds.length) {
      await db.collection<any>("boardItems").deleteMany({
        userId: userIdQuery,
        taskId: { $in: taskIds },
      });
    }
  }

  const chatMeetingIds = Array.from(sessionIds);
  const chatIds = Array.from(chatSessionIds);
  if (chatMeetingIds.length || chatIds.length) {
    await db.collection<any>("chatSessions").deleteMany({
      userId: userIdQuery,
      $or: [
        chatMeetingIds.length
          ? { sourceMeetingId: { $in: chatMeetingIds } }
          : undefined,
        chatIds.length ? { _id: { $in: chatIds } } : undefined,
        chatIds.length ? { id: { $in: chatIds } } : undefined,
      ].filter(Boolean),
    });
  }

  return NextResponse.json({ ok: true });
}
