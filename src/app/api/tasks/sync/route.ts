import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { buildIdQuery } from "@/lib/mongo-id";
import { syncTasksForSource } from "@/lib/task-sync";
import { getWorkspaceIdForUser } from "@/lib/workspace";
import type { ExtractedTaskSchema } from "@/types/chat";

export async function POST(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const {
    sourceSessionId,
    sourceSessionType,
    sourceSessionName,
    origin,
    tasks,
  } = body || {};

  if (!sourceSessionId || !sourceSessionType) {
    return NextResponse.json(
      { error: "Missing source session details." },
      { status: 400 }
    );
  }

  if (!["meeting", "chat"].includes(sourceSessionType)) {
    return NextResponse.json(
      { error: "Unsupported source session type." },
      { status: 400 }
    );
  }

  if (!Array.isArray(tasks)) {
    return NextResponse.json(
      { error: "Tasks payload must be an array." },
      { status: 400 }
    );
  }

  const db = await getDb();
  const userIdQuery = buildIdQuery(userId);
  const workspaceId = await getWorkspaceIdForUser(db, userId);
  if (sourceSessionType === "chat") {
    const sessionIdQuery = buildIdQuery(sourceSessionId);
    const session = await db.collection<any>("chatSessions").findOne({
      userId: userIdQuery,
      $or: [{ _id: sessionIdQuery }, { id: sourceSessionId }],
    });
    if (session?.sourceMeetingId) {
      const deleteResult = await db.collection<any>("tasks").deleteMany({
        userId: userIdQuery,
        sourceSessionType: "chat",
        sourceSessionId,
      });
      return NextResponse.json({
        upserted: 0,
        deleted: deleteResult.deletedCount || 0,
      });
    }
  }
  const result = await syncTasksForSource(
    db,
    tasks as ExtractedTaskSchema[],
    {
      userId,
      workspaceId,
      sourceSessionId,
      sourceSessionType,
      sourceSessionName,
      origin,
      taskState:
        body.taskState ||
        (sourceSessionType === "chat" ? "suggested" : "active"),
    }
  );

  return NextResponse.json(result);
}
