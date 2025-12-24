import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { buildIdQuery, matchesId } from "@/lib/mongo-id";

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
  const idQuery = buildIdQuery(params.id);
  await db.collection<any>("tasks").updateOne(
    { _id: idQuery, userId },
    { $set: update }
  );

  const task = await db.collection<any>("tasks").findOne({
    _id: idQuery,
    userId,
  });
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

  const normalizeId = (value: any) => {
    if (value?.toString) {
      return value.toString();
    }
    return String(value);
  };

  const findChildren = (parentId: string) => {
    tasks.forEach((task) => {
      if (matchesId(task.parentId, parentId)) {
        const taskId = normalizeId(task._id);
        toDelete.add(taskId);
        findChildren(taskId);
      }
    });
  };

  findChildren(params.id);

  const deleteIds: Array<string | ObjectId> = [];
  toDelete.forEach((id) => {
    deleteIds.push(id);
    if (ObjectId.isValid(id)) {
      try {
        deleteIds.push(new ObjectId(id));
      } catch {
        // Ignore invalid ObjectId conversions.
      }
    }
  });

  const result = await db
    .collection<any>("tasks")
    .deleteMany({ userId, _id: { $in: deleteIds } });
  if (!result.deletedCount) {
    return NextResponse.json({ error: "Task not found." }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
