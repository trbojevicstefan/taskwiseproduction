import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { buildIdQuery } from "@/lib/mongo-id";

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
    .collection<any>("planningSessions")
    .find({ userId: userIdQuery })
    .sort({ lastActivityAt: -1 })
    .toArray();

  return NextResponse.json(sessions.map(serializeSession));
}

export async function POST(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const now = new Date();
  const session = {
    _id: randomUUID(),
    userId,
    title: body.title || "New Plan",
    inputText: body.inputText || "",
    extractedTasks: body.extractedTasks || [],
    originalAiTasks: body.originalAiTasks || body.extractedTasks || [],
    originalAllTaskLevels: body.originalAllTaskLevels || body.allTaskLevels || null,
    taskRevisions: body.taskRevisions || [],
    folderId: body.folderId ?? null,
    sourceMeetingId: body.sourceMeetingId ?? null,
    allTaskLevels: body.allTaskLevels ?? null,
    createdAt: now,
    lastActivityAt: now,
  };

  const db = await getDb();
  await db.collection<any>("planningSessions").insertOne(session);

  return NextResponse.json(serializeSession(session));
}

