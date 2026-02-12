import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { buildIdQuery } from "@/lib/mongo-id";
import { getWorkspaceIdForUser } from "@/lib/workspace";

const serializeSession = (session: any) => ({
  ...session,
  id: session._id,
  _id: undefined,
  createdAt: session.createdAt?.toISOString?.() || session.createdAt,
  lastActivityAt: session.lastActivityAt?.toISOString?.() || session.lastActivityAt,
});

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await getDb();
  const userIdQuery = buildIdQuery(userId);
  const sessions = await db
    .collection<any>("chatSessions")
    .find({ userId: userIdQuery })
    .sort({ lastActivityAt: -1 })
    .toArray();

  if (sessions.length > 0) {
    try {
      const { hydrateTaskReferenceLists } = await import("@/lib/task-hydration");
      const hydratedTaskLists = await hydrateTaskReferenceLists(
        userId,
        sessions.map((session: any) =>
          Array.isArray(session.suggestedTasks) ? session.suggestedTasks : []
        )
      );
      sessions.forEach((session: any, index: number) => {
        session.suggestedTasks = hydratedTaskLists[index] || [];
      });
    } catch (e) {
      console.error("Failed to hydrate chat sessions list", e);
    }
  }

  return NextResponse.json(sessions.map(serializeSession));
}

export async function POST(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const now = new Date();
  const db = await getDb();
  const workspaceId = await getWorkspaceIdForUser(db, userId);
  const session = {
    _id: randomUUID(),
    userId,
    workspaceId,
    title: body.title || "New Chat",
    messages: body.messages || [],
    suggestedTasks: body.suggestedTasks || [],
    originalAiTasks: body.originalAiTasks || body.suggestedTasks || [],
    originalAllTaskLevels: body.originalAllTaskLevels || body.allTaskLevels || null,
    taskRevisions: body.taskRevisions || [],
    people: body.people || [],
    folderId: body.folderId ?? null,
    sourceMeetingId: body.sourceMeetingId ?? null,
    allTaskLevels: body.allTaskLevels ?? null,
    createdAt: now,
    lastActivityAt: now,
  };

  await db.collection<any>("chatSessions").insertOne(session);

  // Attach canonical task ids to suggestedTasks when possible
  if (Array.isArray(session.suggestedTasks) && session.suggestedTasks.length) {
    try {
      const normalized = session.suggestedTasks.map((t: any) => t.id || t._id || t.sourceTaskId || null).filter(Boolean);
      if (normalized.length) {
        const userIdQuery = buildIdQuery(userId);
        const matches = await db.collection("tasks").find({ userId: userIdQuery, sourceTaskId: { $in: normalized } }).project({ _id: 1, sourceTaskId: 1 }).toArray();
        const map = new Map(matches.map((r: any) => [String(r.sourceTaskId), String(r._id)]));
        const augmented = session.suggestedTasks.map((t: any) => ({ ...t, taskCanonicalId: map.get(t.id) || undefined }));
        await db.collection("chatSessions").updateOne({ _id: session._id }, { $set: { suggestedTasks: augmented } });
        session.suggestedTasks = augmented;
      }
    } catch (error) {
      console.error("Failed to attach canonical ids to new chat session:", error);
    }
  }

  return NextResponse.json(serializeSession(session));
}

