import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";

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
  const userIdQuery = userId;
  const taskIdQuery = taskId;
  const normalizedTaskId = taskId && taskId.includes(":") ? taskId.split(":").slice(1).join(":") : null;
  const normalizedTaskIdQuery = normalizedTaskId || null;
  const orConditions: any[] = [];
  orConditions.push({ taskId: taskIdQuery });
  if (normalizedTaskIdQuery) orConditions.push({ taskId: normalizedTaskIdQuery });
  // also consider canonical linkage
  orConditions.push({ taskCanonicalId: taskIdQuery });
  if (normalizedTaskIdQuery) orConditions.push({ taskCanonicalId: normalizedTaskIdQuery });

  const items = await db
    .collection("boardItems")
    .find({ userId: userIdQuery, workspaceId, $or: orConditions })
    .sort({ updatedAt: -1, createdAt: -1 })
    .toArray();

  const boardIds = Array.from(
    new Set(items.map((item: any) => String(item.boardId)).filter(Boolean))
  );

  return NextResponse.json({
    boardId: boardIds[0] || null,
    boardIds,
  });
}


