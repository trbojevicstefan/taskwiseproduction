import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";

const serializeFolder = (folder: any) => ({
  ...folder,
  id: folder._id,
  _id: undefined,
  createdAt: folder.createdAt?.toISOString?.() || folder.createdAt,
});

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await getDb();
  const folders = await db
    .collection<any>("folders")
    .find({ userId })
    .sort({ createdAt: -1 })
    .toArray();

  return NextResponse.json(folders.map(serializeFolder));
}

export async function POST(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";

  if (!name) {
    return NextResponse.json({ error: "Folder name is required." }, { status: 400 });
  }

  const folder = {
    _id: randomUUID(),
    name,
    userId,
    parentId: body.parentId ?? null,
    createdAt: new Date(),
  };

  const db = await getDb();
  await db.collection<any>("folders").insertOne(folder);

  return NextResponse.json(serializeFolder(folder));
}

