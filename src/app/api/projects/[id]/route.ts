import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { buildIdQuery } from "@/lib/mongo-id";

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const update: Record<string, unknown> = {};

  if (typeof body.name === "string") {
    update.name = body.name.trim();
  }
  if (typeof body.description === "string") {
    update.description = body.description;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No updates provided." }, { status: 400 });
  }

  const db = await getDb();
  const idQuery = buildIdQuery(params.id);
  await db.collection<any>("projects").updateOne(
    { _id: idQuery, userId },
    { $set: update }
  );

  const project = await db.collection<any>("projects").findOne({
    _id: idQuery,
    userId,
  });

  return NextResponse.json({
    ...project,
    id: project?._id,
    _id: undefined,
    createdAt: project?.createdAt?.toISOString?.() || project?.createdAt,
  });
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
  const idQuery = buildIdQuery(params.id);
  const result = await db
    .collection<any>("projects")
    .deleteOne({ _id: idQuery, userId });
  if (!result.deletedCount) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }
  await db
    .collection<any>("tasks")
    .deleteMany({ userId, projectId: idQuery });

  return NextResponse.json({ ok: true });
}
