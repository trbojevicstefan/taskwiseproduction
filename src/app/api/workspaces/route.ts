import { z } from "zod";
import { apiError, apiSuccess, mapApiError, parseJsonBody } from "@/lib/api-route";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import {
  createWorkspace,
  ensureWorkspaceIndexes,
  listWorkspacesByIds,
} from "@/lib/workspaces";
import {
  createWorkspaceMembership,
  ensureWorkspaceMembershipIndexes,
  listActiveWorkspaceMembershipsForUser,
} from "@/lib/workspace-memberships";
import {
  ensureWorkspaceBootstrapForUser,
  getActiveWorkspaceIdForUser,
  setActiveWorkspaceForUser,
} from "@/lib/workspace-context";

const createWorkspaceSchema = z.object({
  name: z.string().min(1).max(120),
  slug: z.string().min(1).max(120).optional().nullable(),
});

const serializeWorkspace = (
  workspace: {
    _id: string;
    name: string;
    slug?: string | null;
    status?: string;
    createdAt?: Date;
    updatedAt?: Date;
  },
  options: {
    role: string;
    membershipStatus: string;
    isActive: boolean;
  }
) => ({
  id: workspace._id,
  name: workspace.name,
  slug: workspace.slug || null,
  status: workspace.status || "active",
  role: options.role,
  membershipStatus: options.membershipStatus,
  isActive: options.isActive,
  createdAt: workspace.createdAt?.toISOString?.() || null,
  updatedAt: workspace.updatedAt?.toISOString?.() || null,
});

const isDuplicateKeyError = (error: unknown) => {
  if (!error || typeof error !== "object") {
    return false;
  }
  const candidate = error as { code?: number; message?: string };
  if (candidate.code === 11000) return true;
  return String(candidate.message || "").includes("E11000 duplicate key error");
};

export async function GET() {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return apiError(401, "request_error", "Unauthorized");
    }

    const db = await getDb();
    await ensureWorkspaceBootstrapForUser(db, userId);

    const [memberships, activeWorkspaceId] = await Promise.all([
      listActiveWorkspaceMembershipsForUser(db, userId),
      getActiveWorkspaceIdForUser(db, userId),
    ]);

    const workspaceIds = memberships.map((membership) => membership.workspaceId);
    const workspaces = await listWorkspacesByIds(db, workspaceIds);
    const workspaceById = new Map(workspaces.map((workspace) => [workspace._id, workspace]));

    const payload = memberships
      .map((membership) => {
        const workspace = workspaceById.get(membership.workspaceId);
        if (!workspace) return null;
        return serializeWorkspace(workspace, {
          role: membership.role,
          membershipStatus: membership.status,
          isActive: membership.workspaceId === activeWorkspaceId,
        });
      })
      .filter(Boolean);

    return apiSuccess({
      activeWorkspaceId,
      workspaces: payload,
    });
  } catch (error) {
    return mapApiError(error, "Failed to load workspaces.");
  }
}

export async function POST(request: Request) {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return apiError(401, "request_error", "Unauthorized");
    }

    const input = await parseJsonBody(
      request,
      createWorkspaceSchema,
      "Invalid workspace payload."
    );
    const name = input.name.trim();
    if (!name) {
      return apiError(400, "request_error", "Workspace name is required.");
    }

    const db = await getDb();
    await Promise.all([ensureWorkspaceIndexes(db as any), ensureWorkspaceMembershipIndexes(db as any)]);

    const workspace = await createWorkspace(db as any, {
      name,
      createdByUserId: userId,
      slug: input.slug?.trim() || null,
      status: "active",
    }).catch((error) => {
      if (isDuplicateKeyError(error)) {
        throw new Error("WORKSPACE_DUPLICATE");
      }
      throw error;
    });

    await createWorkspaceMembership(db as any, {
      workspaceId: workspace._id,
      userId,
      role: "owner",
      status: "active",
    });

    const activeWorkspace = await setActiveWorkspaceForUser(db as any, userId, workspace._id);
    return apiSuccess({
      workspace: serializeWorkspace(workspace, {
        role: "owner",
        membershipStatus: "active",
        isActive: true,
      }),
      activeWorkspaceId: activeWorkspace.id,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "WORKSPACE_DUPLICATE") {
      return apiError(409, "conflict", "Workspace slug already exists.");
    }
    return mapApiError(error, "Failed to create workspace.");
  }
}
