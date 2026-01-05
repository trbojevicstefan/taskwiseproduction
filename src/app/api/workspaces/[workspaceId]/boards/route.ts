import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { buildIdQuery } from "@/lib/mongo-id";
import { createBoardWithTemplate, ensureDefaultBoard } from "@/lib/boards";
import { getBoardTemplate } from "@/lib/board-templates";

const serializeBoard = (board: any) => ({
  ...board,
  id: board._id,
  _id: undefined,
  createdAt: board.createdAt?.toISOString?.() || board.createdAt,
  updatedAt: board.updatedAt?.toISOString?.() || board.updatedAt,
});

export async function GET(
  _request: Request,
  {
    params,
  }: { params: { workspaceId: string } | Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await Promise.resolve(params);
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!workspaceId) {
    return NextResponse.json({ error: "Workspace ID is required." }, { status: 400 });
  }

  const db = await getDb();
  const userIdQuery = buildIdQuery(userId);
  let boards = await db
    .collection<any>("boards")
    .find({ userId: userIdQuery, workspaceId })
    .sort({ createdAt: 1 })
    .toArray();

  if (boards.length === 0) {
    const defaultBoard = await ensureDefaultBoard(db, userId, workspaceId);
    boards = [defaultBoard];
  }

  return NextResponse.json(boards.map(serializeBoard));
}

export async function POST(
  request: Request,
  {
    params,
  }: { params: { workspaceId: string } | Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await Promise.resolve(params);
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!workspaceId) {
    return NextResponse.json({ error: "Workspace ID is required." }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "Board name is required." }, { status: 400 });
  }

  const color =
    typeof body.color === "string" && body.color.trim()
      ? body.color.trim()
      : null;

  const template = getBoardTemplate(body.templateId);
  if (!template) {
    return NextResponse.json({ error: "Template not found." }, { status: 404 });
  }

  const db = await getDb();
  const { board } = await createBoardWithTemplate(
    db,
    userId,
    workspaceId,
    name,
    template.id,
    {
      description: body.description ?? null,
      isDefault: Boolean(body.isDefault),
      color,
    }
  );

  return NextResponse.json(serializeBoard(board));
}
