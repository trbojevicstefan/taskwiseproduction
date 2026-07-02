import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { apiError, mapApiError, parseJsonBody } from "@/lib/api-route";

const updatePlanningSessionSchema = z
  .object({
    title: z.string().optional(),
    inputText: z.string().optional(),
    extractedTasks: z.array(z.unknown()).optional(),
    originalAiTasks: z.array(z.unknown()).optional(),
    originalAllTaskLevels: z.unknown().optional().nullable(),
    taskRevisions: z.array(z.unknown()).optional(),
    folderId: z.string().optional().nullable(),
    sourceMeetingId: z.string().optional().nullable(),
    allTaskLevels: z.unknown().optional().nullable(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "No updates provided." });

const serializeSession = (session: any) => ({
  ...session,
  id: session._id,
  _id: undefined,
  createdAt: session.createdAt?.toISOString?.() || session.createdAt,
  lastActivityAt: session.lastActivityAt?.toISOString?.() || session.lastActivityAt,
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return apiError(401, "unauthorized", "Unauthorized");
    }

    const { id } = await params;
    const body = await parseJsonBody(
      request,
      updatePlanningSessionSchema,
      "No updates provided."
    );
    const update = { ...body, lastActivityAt: new Date() };

    const db = await getDb();
    const filter = {
      userId,
      $or: [{ _id: id }, { id }],
    };
    await db.collection("planningSessions").updateOne(filter, { $set: update });

    const session = await db.collection("planningSessions").findOne(filter);
    if (!session) {
      return apiError(404, "not_found", "Planning session not found.");
    }
    return NextResponse.json(serializeSession(session));
  } catch (error) {
    return mapApiError(error, "Failed to update planning session.");
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return apiError(401, "unauthorized", "Unauthorized");
    }

    const { id } = await params;
    const db = await getDb();
    const filter = {
      userId,
      $or: [{ _id: id }, { id }],
    };
    const result = await db.collection("planningSessions").deleteOne(filter);
    if (!result.deletedCount) {
      return apiError(404, "not_found", "Planning session not found.");
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return mapApiError(error, "Failed to delete planning session.");
  }
}

