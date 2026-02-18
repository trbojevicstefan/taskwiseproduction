import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-route";
import { requireWorkspaceRouteAccess } from "@/lib/workspace-route-access";

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
  if (!boardId) {
    return apiError(400, "request_error", "Board ID is required.");
  }
  const access = await requireWorkspaceRouteAccess(workspaceId, "member", { adminVisibilityKey: "boards" });
  if (!access.ok) {
    return access.response;
  }
  const { db } = access;

  const body = await request.json().catch(() => ({}));
  const update: Record<string, any> = { updatedAt: new Date() };

  if (typeof body.name === "string") {
    const name = body.name.trim();
    if (!name) {
      return apiError(400, "request_error", "Board name is required.");
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

  const boardIdQuery = boardId;
  const filter = {
    workspaceId,
    $or: [{ _id: boardIdQuery }, { id: boardId }],
  };

  await db.collection("boards").updateOne(filter, { $set: update });
  const board = await db.collection("boards").findOne(filter);
  if (!board) {
    return apiError(404, "request_error", "Board not found.");
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
  if (!boardId) {
    return apiError(400, "request_error", "Board ID is required.");
  }
  const access = await requireWorkspaceRouteAccess(workspaceId, "member", { adminVisibilityKey: "boards" });
  if (!access.ok) {
    return access.response;
  }
  const { db } = access;

  const boardIdQuery = boardId;
  const filter = {
    workspaceId,
    $or: [{ _id: boardIdQuery }, { id: boardId }],
  };

  const result = await db.collection("boards").deleteOne(filter);
  if (!result.deletedCount) {
    return apiError(404, "request_error", "Board not found.");
  }

  await db.collection("boardStatuses").deleteMany({
    workspaceId,
    boardId,
  });
  await db.collection("boardItems").deleteMany({
    workspaceId,
    boardId,
  });

  return NextResponse.json({ ok: true });
}




