import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-route";
import { requireWorkspaceRouteAccess } from "@/lib/workspace-route-access";

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
  const access = await requireWorkspaceRouteAccess(workspaceId, "member", { adminVisibilityKey: "boards" });
  if (!access.ok) {
    return access.response;
  }
  const { db } = access;

  if (!workspaceId || !taskId) {
    return apiError(400, "request_error", "Workspace ID and task ID are required.");
  }

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
    .find({ workspaceId, $or: orConditions })
    .sort({ updatedAt: -1, createdAt: -1 })
    .toArray();

  const boardIds = Array.from(
    new Set(items.map((item: any) => String(item.boardId)).filter(Boolean))
  );

  return NextResponse.json({ boardId: boardIds[0] || null, boardIds });
}



