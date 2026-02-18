import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-route";
import { requireWorkspaceRouteAccess } from "@/lib/workspace-route-access";

const serializeStatus = (status: any) => ({
  ...status,
  id: status._id,
  _id: undefined,
  createdAt: status.createdAt?.toISOString?.() || status.createdAt,
  updatedAt: status.updatedAt?.toISOString?.() || status.updatedAt,
});

export async function PATCH(
  request: Request,
  {
    params,
  }: {
    params:
      | { workspaceId: string; boardId: string; statusId: string }
      | Promise<{ workspaceId: string; boardId: string; statusId: string }>;
  }
) {
  const { workspaceId, boardId, statusId } = await Promise.resolve(params);
  if (!boardId || !statusId) {
    return apiError(400, "request_error", "Board ID and status ID are required.");
  }
  const access = await requireWorkspaceRouteAccess(workspaceId, "member", { adminVisibilityKey: "boards" });
  if (!access.ok) {
    return access.response;
  }
  const { db } = access;

  const body = await request.json().catch(() => ({}));
  const update: Record<string, any> = { updatedAt: new Date() };

  if (typeof body.label === "string") {
    const label = body.label.trim();
    if (!label) {
      return apiError(400, "request_error", "Status label is required.");
    }
    update.label = label;
  }

  if (typeof body.color === "string") {
    update.color = body.color;
  }

  if (
    body.category === "todo" ||
    body.category === "inprogress" ||
    body.category === "done" ||
    body.category === "recurring"
  ) {
    update.category = body.category;
  }

  if (typeof body.order === "number") {
    update.order = body.order;
  }

  if (typeof body.isTerminal === "boolean") {
    update.isTerminal = body.isTerminal;
  }

  if (Object.keys(update).length === 1) {
    return apiError(400, "request_error", "No updates provided.");
  }

  const statusIdQuery = statusId;
  const filter = {
    workspaceId,
    boardId,
    $or: [{ _id: statusIdQuery }, { id: statusId }],
  };

  const existing = await db.collection("boardStatuses").findOne(filter);
  if (!existing) {
    return apiError(404, "request_error", "Status not found.");
  }

  await db.collection("boardStatuses").updateOne(filter, { $set: update });
  const status = await db.collection("boardStatuses").findOne(filter);

  return NextResponse.json(serializeStatus(status));
}

export async function DELETE(
  _request: Request,
  {
    params,
  }: {
    params:
      | { workspaceId: string; boardId: string; statusId: string }
      | Promise<{ workspaceId: string; boardId: string; statusId: string }>;
  }
) {
  const { workspaceId, boardId, statusId } = await Promise.resolve(params);
  if (!boardId || !statusId) {
    return apiError(400, "request_error", "Board ID and status ID are required.");
  }
  const access = await requireWorkspaceRouteAccess(workspaceId, "member", { adminVisibilityKey: "boards" });
  if (!access.ok) {
    return access.response;
  }
  const { db } = access;

  const statusIdQuery = statusId;
  const filter = {
    workspaceId,
    boardId,
    $or: [{ _id: statusIdQuery }, { id: statusId }],
  };

  const existingTask = await db.collection("boardItems").findOne({
    workspaceId,
    boardId,
    statusId,
  });

  if (existingTask) {
    return apiError(400, "request_error", "Status is still used by tasks.");
  }

  const result = await db.collection("boardStatuses").deleteOne(filter);
  if (!result.deletedCount) {
    return apiError(404, "request_error", "Status not found.");
  }

  return NextResponse.json({ ok: true });
}




