import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-route";
import { publishDomainEvent } from "@/lib/domain-events";
import { requireWorkspaceRouteAccess } from "@/lib/workspace-route-access";

const serializeTask = (task: any) => ({
  ...task,
  id: task._id,
  _id: undefined,
  createdAt: task.createdAt?.toISOString?.() || task.createdAt,
  lastUpdated: task.lastUpdated?.toISOString?.() || task.lastUpdated,
});

export async function PATCH(
  request: Request,
  {
    params,
  }: {
    params:
      | { workspaceId: string; boardId: string; itemId: string }
      | Promise<{ workspaceId: string; boardId: string; itemId: string }>;
  }
) {
  const { workspaceId, boardId, itemId } = await Promise.resolve(params);
  if (!boardId || !itemId) {
    return apiError(400, "request_error", "Board ID and item ID are required.");
  }
  const access = await requireWorkspaceRouteAccess(workspaceId, "member", { adminVisibilityKey: "boards" });
  if (!access.ok) {
    return access.response;
  }
  const { db, userId } = access;

  const body = await request.json().catch(() => ({}));
  const itemIdQuery = itemId;
  const filter = {
    workspaceId,
    boardId,
    $or: [{ _id: itemIdQuery }, { id: itemId }],
  };

  const item = await db.collection("boardItems").findOne(filter);
  if (!item) {
    return apiError(404, "request_error", "Board item not found.");
  }

  const itemUpdate: Record<string, any> = { updatedAt: new Date() };
  const taskUpdates =
    body.taskUpdates && typeof body.taskUpdates === "object"
      ? body.taskUpdates
      : {};
  if (typeof taskUpdates.title === "string" && !taskUpdates.title.trim()) {
    return apiError(400, "request_error", "Task title is required.");
  }
  let statusCategory: string | null = null;

  if (typeof body.statusId === "string") {
    const statusIdQuery = body.statusId;
    const status = await db.collection("boardStatuses").findOne({
      workspaceId,
      boardId,
      $or: [{ _id: statusIdQuery }, { id: body.statusId }],
    });
    if (!status) {
      return apiError(404, "request_error", "Status not found.");
    }
    itemUpdate.statusId = status._id?.toString?.() || status._id || body.statusId;
    statusCategory = status.category;
  }

  if (typeof body.rank === "number" && Number.isFinite(body.rank)) {
    itemUpdate.rank = body.rank;
  }

  if (Object.keys(itemUpdate).length > 1) {
    await db.collection("boardItems").updateOne(filter, { $set: itemUpdate });
  }

  const taskFilter = {
    workspaceId,
    $or: [{ _id: item.taskId }, { id: item.taskId }],
  };

  await publishDomainEvent(db, {
    type: "board.item.updated",
    userId,
    payload: {
      taskId: String(item.taskId),
      statusCategory,
      workspaceId,
      boardId,
      taskUpdates,
    },
  });

  const task = await db.collection("tasks").findOne(taskFilter);
  if (!task) {
    return apiError(404, "request_error", "Task not found.");
  }

  const updatedItem = await db.collection("boardItems").findOne(filter);

  return NextResponse.json({
    ...serializeTask(task),
    boardItemId: updatedItem?._id || item._id,
    boardStatusId: updatedItem?.statusId || item.statusId,
    boardRank: typeof updatedItem?.rank === "number" ? updatedItem.rank : item.rank,
    boardCreatedAt: updatedItem?.createdAt || item.createdAt,
    boardUpdatedAt: updatedItem?.updatedAt || item.updatedAt,
  });
}

export async function DELETE(
  _request: Request,
  {
    params,
  }: {
    params:
      | { workspaceId: string; boardId: string; itemId: string }
      | Promise<{ workspaceId: string; boardId: string; itemId: string }>;
  }
) {
  const { workspaceId, boardId, itemId } = await Promise.resolve(params);
  if (!boardId || !itemId) {
    return apiError(400, "request_error", "Board ID and item ID are required.");
  }
  const access = await requireWorkspaceRouteAccess(workspaceId, "member", { adminVisibilityKey: "boards" });
  if (!access.ok) {
    return access.response;
  }
  const { db } = access;

  const itemIdQuery = itemId;
  const filter = {
    workspaceId,
    boardId,
    $or: [{ _id: itemIdQuery }, { id: itemId }],
  };

  const result = await db.collection("boardItems").deleteOne(filter);
  if (!result.deletedCount) {
    return apiError(404, "request_error", "Board item not found.");
  }

  return NextResponse.json({ ok: true });
}

