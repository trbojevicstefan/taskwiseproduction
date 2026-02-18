import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { apiError, mapApiError, parseJsonBody } from "@/lib/api-route";
import { resolveWorkspaceScopeForUser } from "@/lib/workspace-scope";

const createProjectSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().optional().nullable(),
});

export async function GET() {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return apiError(401, "unauthorized", "Unauthorized");
    }

    const db = await getDb();
    const { workspaceId, workspaceMemberUserIds } = await resolveWorkspaceScopeForUser(db, userId, {
      minimumRole: "member",
      adminVisibilityKey: "projects",
      includeMemberUserIds: true,
    });

    const projects = await db
      .collection("projects")
      .find({
        $or: [
          { workspaceId },
          {
            workspaceId: { $exists: false },
            userId: { $in: workspaceMemberUserIds },
          },
        ],
      })
      .sort({ createdAt: -1 })
      .toArray();

    return NextResponse.json(
      projects.map((project: any) => ({
        ...project,
        id: project._id,
        _id: undefined,
        createdAt: project.createdAt?.toISOString?.() || project.createdAt,
      }))
    );
  } catch (error) {
    return mapApiError(error, "Failed to fetch projects.");
  }
}

export async function POST(request: Request) {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return apiError(401, "unauthorized", "Unauthorized");
    }

    const body = await parseJsonBody(request, createProjectSchema, "Project name is required.");
    const db = await getDb();
    const { workspaceId } = await resolveWorkspaceScopeForUser(db, userId, {
      minimumRole: "member",
    });

    const project = {
      _id: randomUUID(),
      name: body.name,
      description: body.description || undefined,
      userId,
      workspaceId,
      createdAt: new Date(),
    };
    await db.collection("projects").insertOne(project);

    return NextResponse.json({
      ...project,
      id: project._id,
      _id: undefined,
      createdAt: project.createdAt.toISOString(),
    });
  } catch (error) {
    return mapApiError(error, "Failed to create project.");
  }
}



