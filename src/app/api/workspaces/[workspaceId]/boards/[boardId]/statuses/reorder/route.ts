import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-route";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";

export async function POST(
  request: Request,
  {
    params,
  }: { params: { workspaceId: string; boardId: string } | Promise<{ workspaceId: string; boardId: string }> }
) {
  const { workspaceId, boardId } = await Promise.resolve(params);
  const userId = await getSessionUserId();
  if (!userId) {
    return apiError(401, "request_error", "Unauthorized");
  }

  if (!workspaceId || !boardId) {
    return apiError(400, "request_error", "Workspace ID and board ID are required.");
  }

  const body = await request.json().catch(() => ({}));
  const updates = Array.isArray(body.updates) ? body.updates : [];
  if (!updates.length) {
    return apiError(400, "request_error", "updates is required.");
  }

  const db = await getDb();
  const userIdQuery = userId;
  const now = new Date();

  const operations = updates.map((item: any) => ({
    updateOne: {
      filter: {
        userId: userIdQuery,
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



