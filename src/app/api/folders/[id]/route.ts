import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";

const serializeFolder = (folder: any) => ({
  ...folder,
  id: folder._id,
  _id: undefined,
  createdAt: folder.createdAt?.toISOString?.() || folder.createdAt,
});

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const update: Record<string, unknown> = {};

  if (typeof body.name === "string") {
    update.name = body.name.trim();
  }
  if ("parentId" in body) {
    update.parentId = body.parentId ?? null;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No updates provided." }, { status: 400 });
  }

  const db = await getDb();
  await db.collection<any>("folders").updateOne(
    { _id: params.id, userId },
    { $set: update }
  );

  const folder = await db.collection<any>("folders").findOne({ _id: params.id, userId });
  return NextResponse.json(serializeFolder(folder));
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await getDb();
  const result = await db
    .collection<any>("folders")
    .deleteOne({ _id: params.id, userId });
  if (!result.deletedCount) {
    return NextResponse.json({ error: "Folder not found." }, { status: 404 });
  }

  await db.collection<any>("chatSessions").updateMany(
    { userId, folderId: params.id },
    { $set: { folderId: null } }
  );
  await db.collection<any>("planningSessions").updateMany(
    { userId, folderId: params.id },
    { $set: { folderId: null } }
  );
  await db.collection<any>("folders").updateMany(
    { userId, parentId: params.id },
    { $set: { parentId: null } }
  );

  return NextResponse.json({ ok: true });
}
