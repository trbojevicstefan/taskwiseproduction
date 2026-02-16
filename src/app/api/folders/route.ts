import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { apiError, mapApiError, parseJsonBody } from "@/lib/api-route";

const createFolderSchema = z.object({
  name: z.string().trim().min(1),
  parentId: z.string().optional().nullable(),
});

const serializeFolder = (folder: any) => ({
  ...folder,
  id: folder._id,
  _id: undefined,
  createdAt: folder.createdAt?.toISOString?.() || folder.createdAt,
});

export async function GET() {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return apiError(401, "unauthorized", "Unauthorized");
    }

    const db = await getDb();
    const folders = await db
      .collection("folders")
      .find({ userId })
      .sort({ createdAt: -1 })
      .toArray();

    return NextResponse.json(folders.map(serializeFolder));
  } catch (error) {
    return mapApiError(error, "Failed to fetch folders.");
  }
}

export async function POST(request: Request) {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return apiError(401, "unauthorized", "Unauthorized");
    }

    const body = await parseJsonBody(request, createFolderSchema, "Folder name is required.");
    const folder = {
      _id: randomUUID(),
      name: body.name,
      userId,
      parentId: body.parentId ?? null,
      createdAt: new Date(),
    };

    const db = await getDb();
    await db.collection("folders").insertOne(folder);

    return NextResponse.json(serializeFolder(folder));
  } catch (error) {
    return mapApiError(error, "Failed to create folder.");
  }
}


