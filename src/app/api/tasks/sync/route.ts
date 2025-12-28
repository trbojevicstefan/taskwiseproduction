import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { syncTasksForSource } from "@/lib/task-sync";
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
  const result = await syncTasksForSource(
    db,
    tasks as ExtractedTaskSchema[],
    {
      userId,
      sourceSessionId,
      sourceSessionType,
      sourceSessionName,
      origin,
    }
  );

  return NextResponse.json(result);
}
