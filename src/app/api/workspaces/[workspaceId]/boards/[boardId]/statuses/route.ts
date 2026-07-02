import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-route";
import { randomUUID } from "crypto";
import { requireWorkspaceRouteAccess } from "@/lib/workspace-route-access";

const serializeStatus = (status: any) => ({
  ...status,
  id: status._id,
  _id: undefined,
  createdAt: status.createdAt?.toISOString?.() || status.createdAt,
  updatedAt: status.updatedAt?.toISOString?.() || status.updatedAt,
});

export async function GET(
  _request: Request,
  {
    params,
  }: { params: { workspaceId: string; boardId: string } | Promise<{ workspaceId: string; boardId: string }> }
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

  const statuses = await db
    .collection("boardStatuses")
    .find({ workspaceId, boardId })
    .sort({ order: 1, createdAt: 1 })
    .toArray();

  return NextResponse.json(statuses.map(serializeStatus));
}

export async function POST(
  request: Request,
  {
    params,
  }: { params: { workspaceId: string; boardId: string } | Promise<{ workspaceId: string; boardId: string }> }
) {
  const { workspaceId, boardId } = await Promise.resolve(params);
  if (!boardId) {
    return apiError(400, "request_error", "Board ID is required.");
  }
  const access = await requireWorkspaceRouteAccess(workspaceId, "member", { adminVisibilityKey: "boards" });
  if (!access.ok) {
    return access.response;
  }
  const { db, userId } = access;

  const body = await request.json().catch(() => ({}));
  const label = typeof body.label === "string" ? body.label.trim() : "";
  if (!label) {
    return apiError(400, "request_error", "Status label is required.");
  }

  const category =
    body.category === "todo" ||
    body.category === "inprogress" ||
    body.category === "done" ||
    body.category === "recurring"
      ? body.category
      : "todo";

  const lastStatus = await db
    .collection("boardStatuses")
    .find({ workspaceId, boardId })
    .sort({ order: -1 })
    .limit(1)
    .toArray();
  const nextOrder = (lastStatus[0]?.order ?? -1) + 1;
  const now = new Date();

  const status = {
    _id: randomUUID(),
    userId,
    workspaceId,
    boardId,
    label,
    color: typeof body.color === "string" ? body.color : "#2563eb",
    category,
    order: typeof body.order === "number" ? body.order : nextOrder,
    isTerminal: typeof body.isTerminal === "boolean" ? body.isTerminal : false,
    createdAt: now,
    updatedAt: now,
  };

  await db.collection("boardStatuses").insertOne(status);

  return NextResponse.json(serializeStatus(status));
}




