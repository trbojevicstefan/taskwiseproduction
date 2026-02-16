import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { apiError, mapApiError, parseJsonBody } from "@/lib/api-route";

const updateProjectSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    description: z.string().optional(),
  })
  .refine((value) => value.name !== undefined || value.description !== undefined, {
    message: "No updates provided.",
  });

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return apiError(401, "unauthorized", "Unauthorized");
    }

    const { id } = await params;
    const body = await parseJsonBody(request, updateProjectSchema, "No updates provided.");
    const update: Record<string, unknown> = {};

    if (body.name !== undefined) {
      update.name = body.name;
    }
    if (body.description !== undefined) {
      update.description = body.description;
    }

    const db = await getDb();
    const filter = {
      userId,
      $or: [{ _id: id }, { id }],
    };
    await db.collection("projects").updateOne(filter, { $set: update });

    const project = await db.collection("projects").findOne(filter);
    if (!project) {
      return apiError(404, "not_found", "Project not found.");
    }

    return NextResponse.json({
      ...project,
      id: project._id,
      _id: undefined,
      createdAt: project.createdAt?.toISOString?.() || project.createdAt,
    });
  } catch (error) {
    return mapApiError(error, "Failed to update project.");
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return apiError(401, "unauthorized", "Unauthorized");
    }

    const { id } = await params;
    const db = await getDb();
    const filter = {
      userId,
      $or: [{ _id: id }, { id }],
    };
    const result = await db.collection("projects").deleteOne(filter);
    if (!result.deletedCount) {
      return apiError(404, "not_found", "Project not found.");
    }
    await db
      .collection("tasks")
      .deleteMany({ userId, projectId: id });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return mapApiError(error, "Failed to delete project.");
  }
}

