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
      | { workspaceId: string; statusId: string }
      | Promise<{ workspaceId: string; statusId: string }>;
  }
) {
  const { workspaceId, statusId } = await Promise.resolve(params);
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!workspaceId || !statusId) {
    return NextResponse.json({ error: "Workspace ID and status ID are required." }, { status: 400 });
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

  if (typeof body.isTerminal === "boolean") {
    update.isTerminal = body.isTerminal;
  }

  if (typeof body.order === "number" && Number.isFinite(body.order)) {
    update.order = body.order;
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
    $or: [{ _id: statusIdQuery }, { id: statusId }],
  };

  await db.collection<any>("boardStatuses").updateOne(filter, { $set: update });
  const status = await db.collection<any>("boardStatuses").findOne(filter);
  if (!status) {
    return NextResponse.json({ error: "Status not found." }, { status: 404 });
  }

  return NextResponse.json(serializeStatus(status));
}

export async function DELETE(
  _request: Request,
  {
    params,
  }: {
    params:
      | { workspaceId: string; statusId: string }
      | Promise<{ workspaceId: string; statusId: string }>;
  }
) {
  const { workspaceId, statusId } = await Promise.resolve(params);
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!workspaceId || !statusId) {
    return NextResponse.json({ error: "Workspace ID and status ID are required." }, { status: 400 });
  }

  const db = await getDb();
  const userIdQuery = buildIdQuery(userId);
  const statusIdQuery = buildIdQuery(statusId);
  const filter = {
    userId: userIdQuery,
    workspaceId,
    $or: [{ _id: statusIdQuery }, { id: statusId }],
  };

  const status = await db.collection<any>("boardStatuses").findOne(filter);
  if (!status) {
    return NextResponse.json({ error: "Status not found." }, { status: 404 });
  }

  const statusIdValue = status._id?.toString?.() || status._id || statusId;
  const existingTask = await db.collection<any>("boardTasks").findOne({
    userId: userIdQuery,
    workspaceId,
    statusId: statusIdValue,
  });

  if (existingTask) {
    return NextResponse.json(
      { error: "Remove or move tasks in this column before deleting it." },
      { status: 400 }
    );
  }

  await db.collection<any>("boardStatuses").deleteOne(filter);
  return NextResponse.json({ ok: true });
}
