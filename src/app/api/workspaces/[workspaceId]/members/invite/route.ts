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
} from "@/lib/workspace-context";
import { canWorkspaceRole, normalizeWorkspaceRole } from "@/lib/workspace-roles";
import { recordWorkspaceActionMetric } from "@/lib/observability-metrics";

const createWorkspaceMemberInviteSchema = z.object({
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

export async function POST(
  request: Request,
  {
    params,
  }: { params: { workspaceId: string } | Promise<{ workspaceId: string }> }
) {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return apiError(401, "request_error", "Unauthorized");
    }

    const { workspaceId: rawWorkspaceId } = await Promise.resolve(params);
    const workspaceId = rawWorkspaceId?.trim();
    if (!workspaceId) {
      return apiError(400, "request_error", "Workspace ID is required.");
    }

    const input = await parseJsonBody(
      request,
      createWorkspaceMemberInviteSchema,
      "Invalid invitation payload."
    );

    const db = await getDb();
    await Promise.all([
      ensureWorkspaceBootstrapForUser(db as any, userId),
      ensureWorkspaceInvitationIndexes(db as any),
    ]);

    const access = await assertWorkspaceAccess(db as any, userId, workspaceId, "admin");
    if (!canWorkspaceRole(access.membership.role, "workspace.invite")) {
      return apiError(403, "forbidden", "Forbidden");
    }

    const inviter = await findUserById(userId);
    const expiresInDays = input.expiresInDays ?? 7;
    const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);
    const role = normalizeWorkspaceRole(input.role || "member");

    const invitation = await createWorkspaceInvitation(db as any, {
      workspaceId: access.workspace._id,
      workspaceName: access.workspace.name,
      inviterUserId: userId,
      inviterEmail: inviter?.email || null,
      role: role === "owner" ? "member" : role,
      invitedEmail: input.invitedEmail || null,
      expiresAt,
    });

    void recordWorkspaceActionMetric({
      userId,
      action: "workspace.member.invite.create",
      workspaceId: access.workspace._id,
      outcome: "success",
      metadata: {
        invitedEmail: input.invitedEmail || null,
        role: role === "owner" ? "member" : role,
      },
    });

    return apiSuccess({
      invitation: serializeInvitation(request, invitation),
    });
  } catch (error) {
    const userId = await getSessionUserId().catch(() => null);
    void recordWorkspaceActionMetric({
      userId,
      action: "workspace.member.invite.create",
      outcome: "error",
    });
    return mapApiError(error, "Failed to create workspace invitation.");
  }
}
