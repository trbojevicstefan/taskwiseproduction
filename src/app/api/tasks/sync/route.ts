import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-route";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { syncTasksForSource } from "@/lib/task-sync";
import { getWorkspaceIdForUser } from "@/lib/workspace";
import type { ExtractedTaskSchema } from "@/types/chat";

export async function POST(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) {
    return apiError(401, "request_error", "Unauthorized");
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
    return apiError(400, "request_error", "Missing source session details.");
  }

  if (!["meeting", "chat"].includes(sourceSessionType)) {
    return apiError(400, "request_error", "Unsupported source session type.");
  }

  if (!Array.isArray(tasks)) {
    return apiError(400, "request_error", "Tasks payload must be an array.");
  }

  const db = await getDb();
  const workspaceId = await getWorkspaceIdForUser(db, userId);
  if (sourceSessionType === "chat") {
    const session = await db.collection("chatSessions").findOne({
      userId,
      $or: [{ _id: sourceSessionId }, { id: sourceSessionId }],
    });
    if (session?.sourceMeetingId) {
      const deleteResult = await db.collection("tasks").deleteMany({
        userId,
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



