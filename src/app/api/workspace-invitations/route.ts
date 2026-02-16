import { z } from "zod";
import { getDb } from "@/lib/db";
import { findUserById } from "@/lib/db/users";
import { getSessionUserId } from "@/lib/server-auth";
import {
  createWorkspaceInvitation,
  ensureWorkspaceInvitationIndexes,
} from "@/lib/workspace-invitations";
import { apiError, apiSuccess, mapApiError, parseJsonBody } from "@/lib/api-route";

const createInvitationSchema = z.object({
  invitedEmail: z.string().email().optional().nullable(),
  expiresInDays: z.number().int().min(1).max(30).optional(),
});

const serializeInvitation = (
  request: Request,
  invitation: Awaited<ReturnType<typeof createWorkspaceInvitation>>
) => {
  const origin = new URL(request.url).origin;
  return {
    token: invitation._id,
    workspaceId: invitation.workspaceId,
    workspaceName: invitation.workspaceName,
    invitedEmail: invitation.invitedEmail,
    inviterEmail: invitation.inviterEmail,
    status: invitation.status,
    createdAt: invitation.createdAt.toISOString(),
    expiresAt: invitation.expiresAt.toISOString(),
    invitationUrl: `${origin}/invite/${invitation._id}`,
  };
};

export async function POST(request: Request) {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return apiError(401, "request_error", "Unauthorized");
    }

    const input = await parseJsonBody(
      request,
      createInvitationSchema,
      "Invalid invitation payload."
    );

    const inviter = await findUserById(userId);
    if (!inviter) {
      return apiError(404, "not_found", "User not found.");
    }

    const workspaceId = inviter.workspace?.id;
    const workspaceName = inviter.workspace?.name;
    if (!workspaceId || !workspaceName) {
      return apiError(
        400,
        "request_error",
        "Workspace is not configured for this account."
      );
    }

    const db = await getDb();
    await ensureWorkspaceInvitationIndexes(db as any);

    const expiresInDays = input.expiresInDays ?? 7;
    const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);

    const invitation = await createWorkspaceInvitation(db as any, {
      workspaceId,
      workspaceName,
      inviterUserId: userId,
      inviterEmail: inviter.email || null,
      invitedEmail: input.invitedEmail || null,
      expiresAt,
    });

    return apiSuccess({
      invitation: serializeInvitation(request, invitation),
    });
  } catch (error) {
    return mapApiError(error, "Failed to create workspace invitation.");
  }
}

