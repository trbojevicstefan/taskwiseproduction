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
  const updates = Array.isArray(body.updates) ? body.updates : [];
  if (!updates.length) {
    return NextResponse.json({ error: "updates is required." }, { status: 400 });
  }

  const db = await getDb();
  const userIdQuery = buildIdQuery(userId);
  const now = new Date();

  const operations = updates.map((item: any) => ({
    updateOne: {
      filter: {
        userId: userIdQuery,
        workspaceId,
        $or: [{ _id: buildIdQuery(item.id) }, { id: item.id }],
      },
      update: {
        $set: {
          statusId: item.statusId,
          order: item.order,
          updatedAt: now,
        },
      },
    },
  }));

  await db.collection<any>("boardTasks").bulkWrite(operations);

  return NextResponse.json({ ok: true });
}
