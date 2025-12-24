import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";

const serializeTask = (task: any) => ({
  ...task,
  id: task._id,
  _id: undefined,
  createdAt: task.createdAt?.toISOString?.() || task.createdAt,
  lastUpdated: task.lastUpdated?.toISOString?.() || task.lastUpdated,
});

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const update = { ...body, lastUpdated: new Date() };

  const db = await getDb();
  await db.collection<any>("tasks").updateOne(
    { _id: params.id, userId },
    { $set: update }
  );

  const task = await db.collection<any>("tasks").findOne({ _id: params.id, userId });
  return NextResponse.json(serializeTask(task));
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await getDb();
  const tasks = await db.collection<any>("tasks").find({ userId }).toArray();

  const toDelete = new Set<string>();
  toDelete.add(params.id);

  const findChildren = (parentId: string) => {
    tasks.forEach((task) => {
      if (task.parentId === parentId) {
        toDelete.add(task._id);
        findChildren(task._id);
      }
    });
  };

  findChildren(params.id);

  await db.collection<any>("tasks").deleteMany({ userId, _id: { $in: Array.from(toDelete) } });

  return NextResponse.json({ ok: true });
}
