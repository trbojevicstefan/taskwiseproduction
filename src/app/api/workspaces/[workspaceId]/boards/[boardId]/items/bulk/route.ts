import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-route";
import { normalizePersonNameKey } from "@/lib/transcript-utils";
import { requireWorkspaceRouteAccess } from "@/lib/workspace-route-access";

export async function POST(
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
  const taskIds = Array.isArray(body.taskIds)
    ? body.taskIds.map((id: any) => String(id)).filter(Boolean)
    : [];
  if (taskIds.length === 0) {
    return apiError(400, "request_error", "taskIds is required.");
  }

  const taskIdFilters = taskIds.flatMap((id: any) => [
    { _id: id },
    { id },
  ]);
  const now = new Date();
  const taskUpdate: Record<string, any> = { lastUpdated: now };
  const updates = body.updates || {};

  if (typeof updates.priority === "string") {
    taskUpdate.priority = updates.priority;
  }
  if (typeof updates.dueAt === "string" || updates.dueAt === null) {
    taskUpdate.dueAt = updates.dueAt;
  }
  if (typeof updates.assignee === "object" || updates.assignee === null) {
    taskUpdate.assignee = updates.assignee;
  }
  if (typeof updates.assigneeName === "string" || updates.assigneeName === null) {
    taskUpdate.assigneeName = updates.assigneeName;
    const rawName = updates.assigneeName || updates.assignee?.name || null;
    taskUpdate.assigneeNameKey = rawName ? normalizePersonNameKey(rawName) : null;
  }

  let statusIdValue: string | null = null;
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
    statusIdValue = status._id?.toString?.() || status._id || body.statusId;
    statusCategory = status.category;
    taskUpdate.status = statusCategory;
  }

  if (Object.keys(taskUpdate).length > 1) {
    await db.collection("tasks").updateMany(
      {
        workspaceId,
        $or: taskIdFilters,
      },
      { $set: taskUpdate }
    );
  }

  if (statusIdValue) {
    const lastItem = await db
      .collection("boardItems")
      .find({ workspaceId, boardId, statusId: statusIdValue })
      .sort({ rank: -1 })
      .limit(1)
      .toArray();
    let nextRank = typeof lastItem[0]?.rank === "number" ? lastItem[0].rank : 0;

    const operations = taskIds.map((taskId: any) => {
      nextRank += 1000;
      return {
        updateOne: {
          filter: { workspaceId, boardId, taskId },
          update: {
            $set: {
              statusId: statusIdValue,
              rank: nextRank,
              updatedAt: now,
            },
          },
        },
      };
    });
    if (operations.length) {
      await db.collection("boardItems").bulkWrite(operations);
    }
  }

  return NextResponse.json({ ok: true });
}






