import { z } from "zod";
import { apiError, apiSuccess, mapApiError, parseJsonBody } from "@/lib/api-route";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import {
  assertWorkspaceAccess,
  ensureWorkspaceBootstrapForUser,
  getActiveWorkspaceIdForUser,
  setActiveWorkspaceForUser,
} from "@/lib/workspace-context";
import {
  countActiveWorkspaceMembershipsForUser,
  countActiveWorkspaceOwners,
  findWorkspaceMembershipById,
  listActiveWorkspaceMembershipsForUser,
  updateWorkspaceMembershipById,
} from "@/lib/workspace-memberships";
import { canWorkspaceRole, normalizeWorkspaceRole } from "@/lib/workspace-roles";
import { recordWorkspaceActionMetric } from "@/lib/observability-metrics";

const updateWorkspaceMemberSchema = z.object({
  role: z.enum(["owner", "admin", "member"]),
});

const serializeMembership = (membership: any) => ({
  membershipId: membership._id,
  workspaceId: membership.workspaceId,
  userId: membership.userId,
  role: membership.role,
  status: membership.status,
  joinedAt: membership.joinedAt?.toISOString?.() || null,
  updatedAt: membership.updatedAt?.toISOString?.() || null,
});

const canManageTargetMembership = (input: {
  actingRole: "owner" | "admin" | "member";
  targetRole: "owner" | "admin" | "member";
  nextRole?: "owner" | "admin" | "member";
  targetUserId: string;
  currentUserId: string;
}) => {
  if (input.actingRole === "owner") {
    return true;
  }
  if (input.actingRole === "admin") {
    if (input.targetRole !== "member") {
      return false;
    }
    if (input.targetUserId === input.currentUserId) {
      return false;
    }
    if (input.nextRole === "owner") {
      return false;
    }
    return true;
  }
  return false;
};

export async function PATCH(
  request: Request,
  {
    params,
  }: {
    params:
      | { workspaceId: string; membershipId: string }
      | Promise<{ workspaceId: string; membershipId: string }>;
  }
) {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return apiError(401, "request_error", "Unauthorized");
    }

    const { workspaceId: rawWorkspaceId, membershipId: rawMembershipId } =
      await Promise.resolve(params);
    const workspaceId = rawWorkspaceId?.trim();
    const membershipId = rawMembershipId?.trim();
    if (!workspaceId || !membershipId) {
      return apiError(
        400,
        "request_error",
        "Workspace ID and membership ID are required."
      );
    }

    const input = await parseJsonBody(
      request,
      updateWorkspaceMemberSchema,
      "Invalid membership update payload."
    );
    const nextRole = normalizeWorkspaceRole(input.role);

    const db = await getDb();
    await ensureWorkspaceBootstrapForUser(db as any, userId);
    const access = await assertWorkspaceAccess(db as any, userId, workspaceId, "admin");
    if (!canWorkspaceRole(access.membership.role, "workspace.members.update")) {
      return apiError(403, "forbidden", "Forbidden");
    }

    const membership = await findWorkspaceMembershipById(db as any, membershipId);
    if (!membership || membership.workspaceId !== workspaceId) {
      return apiError(404, "not_found", "Workspace membership not found.");
    }

    if (
      !canManageTargetMembership({
        actingRole: access.membership.role,
        targetRole: membership.role,
        nextRole,
        targetUserId: membership.userId,
        currentUserId: userId,
      })
    ) {
      return apiError(403, "forbidden", "Forbidden");
    }

    if (membership.role === "owner" && nextRole !== "owner" && membership.status === "active") {
      const ownerCount = await countActiveWorkspaceOwners(db as any, workspaceId);
      if (ownerCount <= 1) {
        return apiError(
          409,
          "workspace_conflict",
          "Cannot demote the last workspace owner."
        );
      }
    }

    await updateWorkspaceMembershipById(db as any, membershipId, { role: nextRole });
    const updatedMembership = await findWorkspaceMembershipById(db as any, membershipId);
    if (!updatedMembership) {
      return apiError(404, "not_found", "Workspace membership not found.");
    }

    void recordWorkspaceActionMetric({
      userId,
      action: "workspace.member.role.update",
      workspaceId,
      outcome: "success",
      metadata: {
        membershipId,
        targetUserId: membership.userId,
        previousRole: membership.role,
        nextRole,
      },
    });

    return apiSuccess({
      membership: serializeMembership(updatedMembership),
    });
  } catch (error) {
    const userId = await getSessionUserId().catch(() => null);
    void recordWorkspaceActionMetric({
      userId,
      action: "workspace.member.role.update",
      outcome: "error",
    });
    return mapApiError(error, "Failed to update workspace membership.");
  }
}

export async function DELETE(
  _request: Request,
  {
    params,
  }: {
    params:
      | { workspaceId: string; membershipId: string }
      | Promise<{ workspaceId: string; membershipId: string }>;
  }
) {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return apiError(401, "request_error", "Unauthorized");
    }

    const { workspaceId: rawWorkspaceId, membershipId: rawMembershipId } =
      await Promise.resolve(params);
    const workspaceId = rawWorkspaceId?.trim();
    const membershipId = rawMembershipId?.trim();
    if (!workspaceId || !membershipId) {
      return apiError(
        400,
        "request_error",
        "Workspace ID and membership ID are required."
      );
    }

    const db = await getDb();
    await ensureWorkspaceBootstrapForUser(db as any, userId);
    const access = await assertWorkspaceAccess(db as any, userId, workspaceId, "admin");
    if (!canWorkspaceRole(access.membership.role, "workspace.members.remove")) {
      return apiError(403, "forbidden", "Forbidden");
    }

    const membership = await findWorkspaceMembershipById(db as any, membershipId);
    if (!membership || membership.workspaceId !== workspaceId) {
      return apiError(404, "not_found", "Workspace membership not found.");
    }

    if (
      !canManageTargetMembership({
        actingRole: access.membership.role,
        targetRole: membership.role,
        targetUserId: membership.userId,
        currentUserId: userId,
      })
    ) {
      return apiError(403, "forbidden", "Forbidden");
    }

    if (membership.status !== "active") {
      return apiError(409, "workspace_conflict", "Membership is not active.");
    }

    if (membership.role === "owner") {
      const ownerCount = await countActiveWorkspaceOwners(db as any, workspaceId);
      if (ownerCount <= 1) {
        return apiError(
          409,
          "workspace_conflict",
          "Cannot remove the last workspace owner."
        );
      }
    }

    const activeMembershipCount = await countActiveWorkspaceMembershipsForUser(
      db as any,
      membership.userId
    );
    if (activeMembershipCount <= 1) {
      return apiError(
        409,
        "workspace_conflict",
        "Cannot remove the user's last active workspace membership."
      );
    }

    await updateWorkspaceMembershipById(db as any, membershipId, {
      status: "left",
    });

    let reassignedActiveWorkspaceId: string | null = null;
    const targetActiveWorkspaceId = await getActiveWorkspaceIdForUser(
      db as any,
      membership.userId
    );
    if (targetActiveWorkspaceId === workspaceId) {
      const fallbackMemberships = await listActiveWorkspaceMembershipsForUser(
        db as any,
        membership.userId
      );
      const fallback = fallbackMemberships.find(
        (candidate: any) => candidate.workspaceId !== workspaceId
      );
      if (fallback?.workspaceId) {
        const nextWorkspace = await setActiveWorkspaceForUser(
          db as any,
          membership.userId,
          fallback.workspaceId
        );
        reassignedActiveWorkspaceId = nextWorkspace.id;
      }
    }

    void recordWorkspaceActionMetric({
      userId,
      action: "workspace.member.remove",
      workspaceId,
      outcome: "success",
      metadata: {
        membershipId,
        targetUserId: membership.userId,
        targetRole: membership.role,
        reassignedActiveWorkspaceId,
      },
    });

    return apiSuccess({
      membership: {
        membershipId: membership._id,
        workspaceId: membership.workspaceId,
        userId: membership.userId,
        role: membership.role,
        status: "left",
      },
      reassignedActiveWorkspaceId,
    });
  } catch (error) {
    const userId = await getSessionUserId().catch(() => null);
    void recordWorkspaceActionMetric({
      userId,
      action: "workspace.member.remove",
      outcome: "error",
    });
    return mapApiError(error, "Failed to remove workspace member.");
  }
}
