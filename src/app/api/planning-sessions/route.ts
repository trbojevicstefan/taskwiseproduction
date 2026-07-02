import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { apiError, mapApiError, parseJsonBody } from "@/lib/api-route";

const createPlanningSessionSchema = z.object({
  title: z.string().optional(),
  inputText: z.string().optional(),
  extractedTasks: z.array(z.unknown()).optional(),
  originalAiTasks: z.array(z.unknown()).optional(),
  originalAllTaskLevels: z.unknown().optional().nullable(),
  taskRevisions: z.array(z.unknown()).optional(),
  folderId: z.string().optional().nullable(),
  sourceMeetingId: z.string().optional().nullable(),
  allTaskLevels: z.unknown().optional().nullable(),
});

const serializeSession = (session: any) => ({
  ...session,
  id: session._id,
  _id: undefined,
  createdAt: session.createdAt?.toISOString?.() || session.createdAt,
  lastActivityAt: session.lastActivityAt?.toISOString?.() || session.lastActivityAt,
});

export async function GET() {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return apiError(401, "unauthorized", "Unauthorized");
    }

    const db = await getDb();
    const sessions = await db
      .collection("planningSessions")
      .find({ userId })
      .sort({ lastActivityAt: -1 })
      .toArray();

    return NextResponse.json(sessions.map(serializeSession));
  } catch (error) {
    return mapApiError(error, "Failed to fetch planning sessions.");
  }
}

export async function POST(request: Request) {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return apiError(401, "unauthorized", "Unauthorized");
    }

    const body = await parseJsonBody(
      request,
      createPlanningSessionSchema,
      "Invalid planning session payload."
    );
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
    await db.collection("planningSessions").insertOne(session);

    return NextResponse.json(serializeSession(session));
  } catch (error) {
    return mapApiError(error, "Failed to create planning session.");
  }
}


