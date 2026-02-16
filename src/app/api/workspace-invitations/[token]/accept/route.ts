import { getDb } from "@/lib/db";
import { findUserById, updateUserById } from "@/lib/db/users";
import { getSessionUserId } from "@/lib/server-auth";
import {
  ensureWorkspaceInvitationIndexes,
  findWorkspaceInvitationByToken,
  isWorkspaceInvitationExpired,
  markWorkspaceInvitationAccepted,
  markWorkspaceInvitationExpired,
  normalizeInviteEmail,
} from "@/lib/workspace-invitations";
import { apiError, apiSuccess, mapApiError } from "@/lib/api-route";

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

    await updateUserById(userId, {
      workspace: {
        id: invitation.workspaceId,
        name: invitation.workspaceName,
      },
    });
    await markWorkspaceInvitationAccepted(db as any, token, userId);

    return apiSuccess({
      workspace: {
        id: invitation.workspaceId,
        name: invitation.workspaceName,
      },
    });
  } catch (error) {
    return mapApiError(error, "Failed to accept workspace invitation.");
  }
}

