import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await getDb();
  const projects = await db
    .collection<any>("projects")
    .find({ userId })
    .sort({ createdAt: -1 })
    .toArray();

  return NextResponse.json(
    projects.map((project) => ({
      ...project,
      id: project._id,
      _id: undefined,
      createdAt: project.createdAt?.toISOString?.() || project.createdAt,
    }))
  );
}

export async function POST(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";

  if (!name) {
    return NextResponse.json({ error: "Project name is required." }, { status: 400 });
  }

  const project = {
    _id: randomUUID(),
    name,
    description: body.description || undefined,
    userId,
    createdAt: new Date(),
  };

  const db = await getDb();
  await db.collection<any>("projects").insertOne(project);

  return NextResponse.json({
    ...project,
    id: project._id,
    _id: undefined,
    createdAt: project.createdAt.toISOString(),
  });
}

