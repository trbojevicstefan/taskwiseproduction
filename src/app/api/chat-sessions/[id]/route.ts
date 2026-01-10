import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { buildIdQuery } from "@/lib/mongo-id";
import { normalizeTask } from "@/lib/data";
import { syncTasksForSource } from "@/lib/task-sync";

const serializeSession = (session: any) => ({
  ...session,
  id: session._id,
  _id: undefined,
  createdAt: session.createdAt?.toISOString?.() || session.createdAt,
  lastActivityAt: session.lastActivityAt?.toISOString?.() || session.lastActivityAt,
});

const collectSessionIds = (session: any, fallbackId?: string | null) => {
  const ids = new Set<string>();
  if (session?._id) ids.add(String(session._id));
  if (session?.id) ids.add(String(session.id));
  if (fallbackId) ids.add(String(fallbackId));
  return Array.from(ids);
};

const cleanupChatTasksForSession = async (db: any, userId: string, session: any) => {
  if (!session) return;
  const sessionIds = collectSessionIds(session);
  if (!sessionIds.length) return;
  const userIdQuery = buildIdQuery(userId);
  await db.collection<any>("tasks").deleteMany({
    userId: userIdQuery,
    sourceSessionType: "chat",
    sourceSessionId: { $in: sessionIds },
  });
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
  const avoidTimestampUpdate = Boolean(body.avoidTimestampUpdate);
  const update = { ...body };
  delete update.avoidTimestampUpdate;
  let normalizedTasks: any[] | null = null;
  if (Array.isArray(update.suggestedTasks)) {
    normalizedTasks = update.suggestedTasks.map((task: any) =>
      normalizeTask(task)
    );
    update.suggestedTasks = normalizedTasks;
  }

  if (!avoidTimestampUpdate) {
    update.lastActivityAt = new Date();
  }

  const db = await getDb();
  const idQuery = buildIdQuery(id);
  const userIdQuery = buildIdQuery(userId);
  const filter = {
    userId: userIdQuery,
    $or: [{ _id: idQuery }, { id }],
  };
  await db.collection<any>("chatSessions").updateOne(filter, { $set: update });

  const session = await db.collection<any>("chatSessions").findOne(filter);
  if (normalizedTasks && session?.sourceMeetingId) {
    const meetingId = String(session.sourceMeetingId);
    const meetingFilter = {
      userId: userIdQuery,
      $or: [{ _id: buildIdQuery(meetingId) }, { id: meetingId }],
    };
    await db.collection<any>("meetings").updateOne(meetingFilter, {
      $set: { extractedTasks: normalizedTasks, lastActivityAt: new Date() },
    });
    const meeting = await db.collection<any>("meetings").findOne(meetingFilter);
    if (meeting) {
      try {
        await syncTasksForSource(db, normalizedTasks, {
          userId,
          sourceSessionId: String(meeting._id ?? meetingId),
          sourceSessionType: "meeting",
          sourceSessionName: meeting?.title || session?.title || "Meeting",
          origin: "meeting",
        });
      } catch (error) {
        console.error("Failed to sync meeting tasks after chat update:", error);
      }
    }
  }
  // After syncing tasks, attach canonical ids to session suggestedTasks where available
  try {
    const sessionAfter = await db.collection<any>("chatSessions").findOne(filter);
    if (sessionAfter && Array.isArray(sessionAfter.suggestedTasks) && sessionAfter.suggestedTasks.length) {
      const sourceIds = sessionAfter.suggestedTasks.map((t: any) => t.id).filter(Boolean);
      if (sourceIds.length) {
        const userIdQuery2 = buildIdQuery(userId);
        const tasks = await db.collection("tasks").find({ userId: userIdQuery2, sourceTaskId: { $in: sourceIds } }).project({ _id: 1, sourceTaskId: 1 }).toArray();
        const map = new Map(tasks.map((r: any) => [String(r.sourceTaskId), String(r._id)]));
        const augmented = sessionAfter.suggestedTasks.map((t: any) => ({ ...t, taskCanonicalId: map.get(t.id) || undefined }));
        await db.collection("chatSessions").updateOne(filter, { $set: { suggestedTasks: augmented } });
      }
    }
  } catch (error) {
    console.error("Failed to attach canonical ids to chat session after sync:", error);
  }
  if (session?.sourceMeetingId) {
    await cleanupChatTasksForSession(db, userId, session);
  }
  return NextResponse.json(serializeSession(session));
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
  const result = await db
    .collection<any>("chatSessions")
    .deleteOne(filter);
  if (!result.deletedCount) {
    return NextResponse.json({ error: "Chat session not found." }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
