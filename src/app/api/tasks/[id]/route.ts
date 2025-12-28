import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { buildIdQuery, matchesId } from "@/lib/mongo-id";
import { normalizePersonNameKey } from "@/lib/transcript-utils";

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
  if (body.assigneeName || body.assignee?.name) {
    update.assigneeNameKey = normalizePersonNameKey(
      body.assigneeName || body.assignee?.name
    );
  }

  const db = await getDb();
  const idQuery = buildIdQuery(params.id);
  const userIdQuery = buildIdQuery(userId);
  const filter = {
    userId: userIdQuery,
    $or: [{ _id: idQuery }, { id: params.id }],
  };
  await db.collection<any>("tasks").updateOne(filter, { $set: update });

  const task = await db.collection<any>("tasks").findOne(filter);
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
  const userIdQuery = buildIdQuery(userId);
  const tasks = await db
    .collection<any>("tasks")
    .find({ userId: userIdQuery })
    .toArray();

  const normalizeTaskId = (value: string) => {
    if (!value) return value;
    if (value.includes(":")) {
      const parts = value.split(":").filter(Boolean);
      return parts.length ? parts[parts.length - 1] : value;
    }
    return value;
  };

  const targetId = normalizeTaskId(params.id);
  const toDelete = new Set<string>();
  toDelete.add(params.id);
  if (targetId && targetId !== params.id) {
    toDelete.add(targetId);
  }

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

  findChildren(targetId);

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
    .deleteMany({ userId: userIdQuery, _id: { $in: deleteIds } });
  if (!result.deletedCount) {
    const fallbackFilter = {
      userId: userIdQuery,
      $or: [
        { _id: buildIdQuery(params.id) },
        { _id: buildIdQuery(targetId) },
        { id: params.id },
        { id: targetId },
        { sourceTaskId: params.id },
        { sourceTaskId: targetId },
      ],
    };
    const fallbackTask = await db.collection<any>("tasks").findOne(fallbackFilter);
    if (fallbackTask) {
      await db.collection<any>("tasks").deleteOne({
        userId: userIdQuery,
        _id: buildIdQuery(fallbackTask._id?.toString?.() || fallbackTask._id),
      });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Task not found." }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
