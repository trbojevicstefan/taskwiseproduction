import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { buildIdQuery } from "@/lib/mongo-id";

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
  const orderedIds = Array.isArray(body.orderedIds) ? body.orderedIds : [];
  if (!orderedIds.length) {
    return NextResponse.json({ error: "orderedIds is required." }, { status: 400 });
  }

  const db = await getDb();
  const userIdQuery = buildIdQuery(userId);
  const now = new Date();

  const operations = orderedIds.map((id: string, index: number) => ({
    updateOne: {
      filter: {
        userId: userIdQuery,
        workspaceId,
        $or: [{ _id: buildIdQuery(id) }, { id }],
      },
      update: { $set: { order: index, updatedAt: now } },
    },
  }));

  await db.collection<any>("boardStatuses").bulkWrite(operations);

  return NextResponse.json({ ok: true });
}
