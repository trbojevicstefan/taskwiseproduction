import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-route";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
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
    return apiError(401, "request_error", "Unauthorized");
  }

  if (!workspaceId) {
    return apiError(400, "request_error", "Workspace ID is required.");
  }

  const db = await getDb();
  const userIdQuery = userId;
  let boards = await db
    .collection("boards")
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
    return apiError(401, "request_error", "Unauthorized");
  }

  if (!workspaceId) {
    return apiError(400, "request_error", "Workspace ID is required.");
  }

  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return apiError(400, "request_error", "Board name is required.");
  }

  const color =
    typeof body.color === "string" && body.color.trim()
      ? body.color.trim()
      : null;

  const template = getBoardTemplate(body.templateId);
  if (!template) {
    return apiError(404, "request_error", "Template not found.");
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



