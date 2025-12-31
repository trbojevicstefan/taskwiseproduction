import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
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

export async function GET(
  _request: Request,
  {
    params,
  }: { params: { workspaceId: string } | Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await Promise.resolve(params);
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!workspaceId) {
    return NextResponse.json({ error: "Workspace ID is required." }, { status: 400 });
  }

  const db = await getDb();
  const userIdQuery = buildIdQuery(userId);
  const statuses = await db
    .collection<any>("boardStatuses")
    .find({ userId: userIdQuery, workspaceId })
    .sort({ order: 1, createdAt: 1 })
    .toArray();

  return NextResponse.json(statuses.map(serializeStatus));
}

export async function POST(
  request: Request,
  {
    params,
  }: { params: { workspaceId: string } | Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await Promise.resolve(params);
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!workspaceId) {
    return NextResponse.json({ error: "Workspace ID is required." }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const label = typeof body.label === "string" ? body.label.trim() : "";
  if (!label) {
    return NextResponse.json({ error: "Status label is required." }, { status: 400 });
  }

  const db = await getDb();
  const userIdQuery = buildIdQuery(userId);
  const lastStatus = await db
    .collection<any>("boardStatuses")
    .find({ userId: userIdQuery, workspaceId })
    .sort({ order: -1 })
    .limit(1)
    .toArray();
  const nextOrder = (lastStatus[0]?.order ?? -1) + 1;
  const now = new Date();

  const status = {
    _id: randomUUID(),
    userId,
    workspaceId,
    label,
    color: typeof body.color === "string" ? body.color : "#2563eb",
    order: typeof body.order === "number" ? body.order : nextOrder,
    isTerminal: typeof body.isTerminal === "boolean" ? body.isTerminal : false,
    createdAt: now,
    updatedAt: now,
  };

  await db.collection<any>("boardStatuses").insertOne(status);

  return NextResponse.json(serializeStatus(status));
}
