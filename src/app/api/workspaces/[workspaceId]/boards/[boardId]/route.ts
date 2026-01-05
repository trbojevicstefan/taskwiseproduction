import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { buildIdQuery } from "@/lib/mongo-id";

const serializeBoard = (board: any) => ({
  ...board,
  id: board._id,
  _id: undefined,
  createdAt: board.createdAt?.toISOString?.() || board.createdAt,
  updatedAt: board.updatedAt?.toISOString?.() || board.updatedAt,
});

export async function PATCH(
  request: Request,
  {
    params,
  }: {
    params:
      | { workspaceId: string; boardId: string }
      | Promise<{ workspaceId: string; boardId: string }>;
  }
) {
  const { workspaceId, boardId } = await Promise.resolve(params);
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!workspaceId || !boardId) {
    return NextResponse.json({ error: "Workspace ID and board ID are required." }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const update: Record<string, any> = { updatedAt: new Date() };

  if (typeof body.name === "string") {
    const name = body.name.trim();
    if (!name) {
      return NextResponse.json({ error: "Board name is required." }, { status: 400 });
    }
    update.name = name;
  }

  if (typeof body.description === "string" || body.description === null) {
    update.description = body.description;
  }

  if (typeof body.color === "string") {
    update.color = body.color;
  }

  if (typeof body.isDefault === "boolean") {
    update.isDefault = body.isDefault;
  }

  const db = await getDb();
  const userIdQuery = buildIdQuery(userId);
  const boardIdQuery = buildIdQuery(boardId);
  const filter = {
    userId: userIdQuery,
    workspaceId,
    $or: [{ _id: boardIdQuery }, { id: boardId }],
  };

  await db.collection<any>("boards").updateOne(filter, { $set: update });
  const board = await db.collection<any>("boards").findOne(filter);
  if (!board) {
    return NextResponse.json({ error: "Board not found." }, { status: 404 });
  }

  return NextResponse.json(serializeBoard(board));
}

export async function DELETE(
  _request: Request,
  {
    params,
  }: {
    params:
      | { workspaceId: string; boardId: string }
      | Promise<{ workspaceId: string; boardId: string }>;
  }
) {
  const { workspaceId, boardId } = await Promise.resolve(params);
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!workspaceId || !boardId) {
    return NextResponse.json({ error: "Workspace ID and board ID are required." }, { status: 400 });
  }

  const db = await getDb();
  const userIdQuery = buildIdQuery(userId);
  const boardIdQuery = buildIdQuery(boardId);
  const filter = {
    userId: userIdQuery,
    workspaceId,
    $or: [{ _id: boardIdQuery }, { id: boardId }],
  };

  const result = await db.collection<any>("boards").deleteOne(filter);
  if (!result.deletedCount) {
    return NextResponse.json({ error: "Board not found." }, { status: 404 });
  }

  await db.collection<any>("boardStatuses").deleteMany({
    userId: userIdQuery,
    workspaceId,
    boardId,
  });
  await db.collection<any>("boardItems").deleteMany({
    userId: userIdQuery,
    workspaceId,
    boardId,
  });

  return NextResponse.json({ ok: true });
}
