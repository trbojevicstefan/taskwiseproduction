import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { buildIdQuery } from "@/lib/mongo-id";

export async function GET(
  _request: Request,
  {
    params,
  }: {
    params:
      | { workspaceId: string; taskId: string }
      | Promise<{ workspaceId: string; taskId: string }>;
  }
) {
  const { workspaceId, taskId } = await Promise.resolve(params);
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!workspaceId || !taskId) {
    return NextResponse.json(
      { error: "Workspace ID and task ID are required." },
      { status: 400 }
    );
  }

  const db = await getDb();
  const userIdQuery = buildIdQuery(userId);
  const taskIdQuery = buildIdQuery(taskId);
  const items = await db
    .collection<any>("boardItems")
    .find({ userId: userIdQuery, workspaceId, taskId: taskIdQuery })
    .sort({ updatedAt: -1, createdAt: -1 })
    .toArray();

  const boardIds = Array.from(
    new Set(items.map((item) => String(item.boardId)).filter(Boolean))
  );

  return NextResponse.json({
    boardId: boardIds[0] || null,
    boardIds,
  });
}
