import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { buildIdQuery } from "@/lib/mongo-id";

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
  const idQuery = buildIdQuery(params.id);
  const userIdQuery = buildIdQuery(userId);
  const filter = {
    userId: userIdQuery,
    $or: [{ _id: idQuery }, { id: params.id }],
  };
  await db.collection<any>("folders").updateOne(filter, { $set: update });

  const folder = await db.collection<any>("folders").findOne(filter);
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
  const idQuery = buildIdQuery(params.id);
  const userIdQuery = buildIdQuery(userId);
  const filter = {
    userId: userIdQuery,
    $or: [{ _id: idQuery }, { id: params.id }],
  };
  const result = await db
    .collection<any>("folders")
    .deleteOne(filter);
  if (!result.deletedCount) {
    return NextResponse.json({ error: "Folder not found." }, { status: 404 });
  }

  await db.collection<any>("chatSessions").updateMany(
    { userId: userIdQuery, folderId: idQuery },
    { $set: { folderId: null } }
  );
  await db.collection<any>("planningSessions").updateMany(
    { userId: userIdQuery, folderId: idQuery },
    { $set: { folderId: null } }
  );
  await db.collection<any>("folders").updateMany(
    { userId: userIdQuery, parentId: idQuery },
    { $set: { parentId: null } }
  );

  return NextResponse.json({ ok: true });
}
