import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { apiError, mapApiError, parseJsonBody } from "@/lib/api-route";

const updateFolderSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    parentId: z.string().optional().nullable(),
  })
  .refine((value) => value.name !== undefined || value.parentId !== undefined, {
    message: "No updates provided.",
  });

const serializeFolder = (folder: any) => ({
  ...folder,
  id: folder._id,
  _id: undefined,
  createdAt: folder.createdAt?.toISOString?.() || folder.createdAt,
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
    const body = await parseJsonBody(request, updateFolderSchema, "No updates provided.");
    const update: Record<string, unknown> = {};

    if (body.name !== undefined) {
      update.name = body.name;
    }
    if (body.parentId !== undefined) {
      update.parentId = body.parentId ?? null;
    }

    const db = await getDb();
    const filter = {
      userId,
      $or: [{ _id: id }, { id }],
    };
    await db.collection("folders").updateOne(filter, { $set: update });

    const folder = await db.collection("folders").findOne(filter);
    if (!folder) {
      return apiError(404, "not_found", "Folder not found.");
    }
    return NextResponse.json(serializeFolder(folder));
  } catch (error) {
    return mapApiError(error, "Failed to update folder.");
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
    const result = await db.collection("folders").deleteOne(filter);
    if (!result.deletedCount) {
      return apiError(404, "not_found", "Folder not found.");
    }

    await db.collection("chatSessions").updateMany(
      { userId, folderId: id },
      { $set: { folderId: null } }
    );
    await db.collection("planningSessions").updateMany(
      { userId, folderId: id },
      { $set: { folderId: null } }
    );
    await db.collection("folders").updateMany(
      { userId, parentId: id },
      { $set: { parentId: null } }
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    return mapApiError(error, "Failed to delete folder.");
  }
}

