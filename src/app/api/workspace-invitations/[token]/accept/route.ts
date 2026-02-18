import { getDb } from "@/lib/db";
import { findUserById } from "@/lib/db/users";
import { getSessionUserId } from "@/lib/server-auth";
import {
  createWorkspaceMembership,
  findWorkspaceMembership,
  updateWorkspaceMembershipById,
} from "@/lib/workspace-memberships";
import {
  ensureWorkspaceInvitationIndexes,
  findWorkspaceInvitationByToken,
  isWorkspaceInvitationExpired,
  markWorkspaceInvitationAccepted,
  markWorkspaceInvitationExpired,
  normalizeInviteEmail,
} from "@/lib/workspace-invitations";
import { apiError, apiSuccess, mapApiError } from "@/lib/api-route";
import { hasWorkspaceRoleAtLeast, type WorkspaceRole } from "@/lib/workspace-roles";
import { INVITE_ACCEPT_SWITCH_POLICY } from "@/lib/workspace-policies";
import { setActiveWorkspaceForUser } from "@/lib/workspace-context";
import { recordWorkspaceActionMetric } from "@/lib/observability-metrics";

const resolveInvitationRole = (role: string | null | undefined): WorkspaceRole =>
  role === "admin" ? "admin" : "member";

export async function POST(
  _request: Request,
  {
    params,
  }: {
    params: { token: string } | Promise<{ token: string }>;
  }
) {
  try {
    const { token } = await Promise.resolve(params);
    if (!token) {
      return apiError(400, "request_error", "Invitation token is required.");
    }

    const userId = await getSessionUserId();
    if (!userId) {
      return apiError(401, "request_error", "Unauthorized");
    }

    const db = await getDb();
    await ensureWorkspaceInvitationIndexes(db as any);

    const invitation = await findWorkspaceInvitationByToken(db as any, token);
    if (!invitation) {
      return apiError(404, "not_found", "Invitation not found.");
    }

    if (invitation.status === "accepted" && invitation.acceptedByUserId === userId) {
      return apiSuccess({
        workspace: {
          id: invitation.workspaceId,
          name: invitation.workspaceName,
        },
        switchedActiveWorkspace: false,
      });
    }

    if (invitation.status !== "pending") {
      return apiError(409, "conflict", "Invitation is no longer active.");
    }

    if (isWorkspaceInvitationExpired(invitation)) {
      await markWorkspaceInvitationExpired(db as any, token);
      return apiError(410, "gone", "Invitation has expired.");
    }

    const user = await findUserById(userId);
    if (!user) {
      return apiError(404, "not_found", "User not found.");
    }

    const invitedEmail = normalizeInviteEmail(invitation.invitedEmail);
    const userEmail = normalizeInviteEmail(user.email);
    if (invitedEmail && userEmail !== invitedEmail) {
      return apiError(
        403,
        "forbidden",
        "This invitation is restricted to a different email address."
      );
    }

    const invitationRole = resolveInvitationRole(invitation.role);
    const existingMembership = await findWorkspaceMembership(
      db as any,
      invitation.workspaceId,
      userId
    );

    let membershipId: string | null = null;
    if (!existingMembership) {
      const membership = await createWorkspaceMembership(db as any, {
        workspaceId: invitation.workspaceId,
        userId,
        role: invitationRole,
        status: "active",
      });
      membershipId = membership._id;
    } else {
      membershipId = existingMembership._id;
      const nextRole = hasWorkspaceRoleAtLeast(existingMembership.role, invitationRole)
        ? existingMembership.role
        : invitationRole;
      await updateWorkspaceMembershipById(db as any, existingMembership._id, {
        status: "active",
        role: nextRole,
        joinedAt: existingMembership.joinedAt || new Date(),
      });
    }

    const shouldSwitchActiveWorkspace =
      INVITE_ACCEPT_SWITCH_POLICY === "always_switch"
        ? true
        : !user.activeWorkspaceId;

    let activeWorkspaceId: string | null = user.activeWorkspaceId || null;
    if (shouldSwitchActiveWorkspace) {
      const activeWorkspace = await setActiveWorkspaceForUser(
        db as any,
        userId,
        invitation.workspaceId
      );
      activeWorkspaceId = activeWorkspace.id;
    }

    const acceptResult = await markWorkspaceInvitationAccepted(db as any, token, userId, {
      acceptedMembershipId: membershipId,
    });
    if (!acceptResult?.matchedCount) {
      const latest = await findWorkspaceInvitationByToken(db as any, token);
      if (!latest || latest.status !== "accepted" || latest.acceptedByUserId !== userId) {
        return apiError(409, "conflict", "Invitation is no longer active.");
      }
    }

    void recordWorkspaceActionMetric({
      userId,
      action: "workspace.invite.accept",
      workspaceId: invitation.workspaceId,
      outcome: "success",
      metadata: {
        switchedActiveWorkspace: Boolean(shouldSwitchActiveWorkspace),
        membershipId,
      },
    });

    return apiSuccess({
      workspace: {
        id: invitation.workspaceId,
        name: invitation.workspaceName,
      },
      switchedActiveWorkspace: Boolean(shouldSwitchActiveWorkspace),
      activeWorkspaceId,
      membershipId,
    });
  } catch (error) {
    const userId = await getSessionUserId().catch(() => null);
    void recordWorkspaceActionMetric({
      userId,
      action: "workspace.invite.accept",
      outcome: "error",
    });
    return mapApiError(error, "Failed to accept workspace invitation.");
  }
}
