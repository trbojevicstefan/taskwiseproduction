import { z } from "zod";
import { getDb } from "@/lib/db";
import { findUserById } from "@/lib/db/users";
import { getSessionUserId } from "@/lib/server-auth";
import {
  createWorkspaceInvitation,
  ensureWorkspaceInvitationIndexes,
} from "@/lib/workspace-invitations";
import { apiError, apiSuccess, mapApiError, parseJsonBody } from "@/lib/api-route";
import {
  assertWorkspaceAccess,
  ensureWorkspaceBootstrapForUser,
  getActiveWorkspaceForUser,
} from "@/lib/workspace-context";
import { normalizeWorkspaceRole } from "@/lib/workspace-roles";

const createInvitationSchema = z.object({
  invitedEmail: z.string().email().optional().nullable(),
  role: z.enum(["member", "admin"]).optional(),
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
    role: invitation.role || "member",
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
    const db = await getDb();
    await Promise.all([
      ensureWorkspaceBootstrapForUser(db as any, userId),
      ensureWorkspaceInvitationIndexes(db as any),
    ]);
    const activeWorkspace = await getActiveWorkspaceForUser(db as any, userId);
    if (!activeWorkspace?.id || !activeWorkspace.name) {
      return apiError(
        400,
        "request_error",
        "Active workspace is not configured for this account."
      );
    }
    await assertWorkspaceAccess(db as any, userId, activeWorkspace.id, "admin");
    const inviter = await findUserById(userId);

    const expiresInDays = input.expiresInDays ?? 7;
    const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);
    const role = normalizeWorkspaceRole(input.role || "member");

    const invitation = await createWorkspaceInvitation(db as any, {
      workspaceId: activeWorkspace.id,
      workspaceName: activeWorkspace.name,
      inviterUserId: userId,
      inviterEmail: inviter?.email || null,
      role: role === "owner" ? "member" : role,
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
