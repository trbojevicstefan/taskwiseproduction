import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-route";
import { requireWorkspaceRouteAccess } from "@/lib/workspace-route-access";

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
  const { db } = access;

  const body = await request.json().catch(() => ({}));
  const updates = Array.isArray(body.updates) ? body.updates : [];
  if (!updates.length) {
    return apiError(400, "request_error", "updates is required.");
  }

  const now = new Date();

  const operations = updates.map((item: any) => ({
    updateOne: {
      filter: {
        workspaceId,
        boardId,
        $or: [{ _id: item.id }, { id: item.id }],
      },
      update: {
        $set: {
          order: item.order,
          updatedAt: now,
        },
      },
    },
  }));

  await db.collection("boardStatuses").bulkWrite(operations);

  return NextResponse.json({ ok: true });
}




