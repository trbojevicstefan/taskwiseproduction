import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { buildIdQuery } from "@/lib/mongo-id";

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
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!workspaceId || !boardId || !statusId) {
    return NextResponse.json(
      { error: "Workspace ID, board ID, and status ID are required." },
      { status: 400 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const update: Record<string, any> = { updatedAt: new Date() };

  if (typeof body.label === "string") {
    const label = body.label.trim();
    if (!label) {
      return NextResponse.json({ error: "Status label is required." }, { status: 400 });
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
    return NextResponse.json({ error: "No updates provided." }, { status: 400 });
  }

  const db = await getDb();
  const userIdQuery = buildIdQuery(userId);
  const statusIdQuery = buildIdQuery(statusId);
  const filter = {
    userId: userIdQuery,
    workspaceId,
    boardId,
    $or: [{ _id: statusIdQuery }, { id: statusId }],
  };

  const existing = await db.collection<any>("boardStatuses").findOne(filter);
  if (!existing) {
    return NextResponse.json({ error: "Status not found." }, { status: 404 });
  }

  await db.collection<any>("boardStatuses").updateOne(filter, { $set: update });
  const status = await db.collection<any>("boardStatuses").findOne(filter);

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
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!workspaceId || !boardId || !statusId) {
    return NextResponse.json(
      { error: "Workspace ID, board ID, and status ID are required." },
      { status: 400 }
    );
  }

  const db = await getDb();
  const userIdQuery = buildIdQuery(userId);
  const statusIdQuery = buildIdQuery(statusId);
  const filter = {
    userId: userIdQuery,
    workspaceId,
    boardId,
    $or: [{ _id: statusIdQuery }, { id: statusId }],
  };

  const existingTask = await db.collection<any>("boardItems").findOne({
    userId: userIdQuery,
    workspaceId,
    boardId,
    statusId,
  });

  if (existingTask) {
    return NextResponse.json(
      { error: "Status is still used by tasks." },
      { status: 400 }
    );
  }

  const result = await db.collection<any>("boardStatuses").deleteOne(filter);
  if (!result.deletedCount) {
    return NextResponse.json({ error: "Status not found." }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
