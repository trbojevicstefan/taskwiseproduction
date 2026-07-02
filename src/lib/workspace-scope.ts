import { ApiRouteError } from "@/lib/api-route";
import { getWorkspaceIdForUser } from "@/lib/workspace";
import { assertWorkspaceAccess, ensureWorkspaceBootstrapForUser } from "@/lib/workspace-context";
import { listActiveWorkspaceMembershipsForWorkspace } from "@/lib/workspace-memberships";
import type { WorkspaceRole } from "@/lib/workspace-roles";
import {
  isWorkspaceAdminVisibilityAllowed,
  type WorkspaceAdminVisibilityKey,
} from "@/lib/workspace-settings";

const normalizeWorkspaceId = (value: string | null | undefined) => {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || null;
};

export const resolveWorkspaceScopeForUser = async (
  db: any,
  userId: string,
  options: {
    requestedWorkspaceId?: string | null;
    minimumRole?: WorkspaceRole;
    adminVisibilityKey?: WorkspaceAdminVisibilityKey;
    includeMemberUserIds?: boolean;
  } = {}
) => {
  await ensureWorkspaceBootstrapForUser(db, userId);
  const resolvedWorkspaceId =
    normalizeWorkspaceId(options.requestedWorkspaceId) ||
    (await getWorkspaceIdForUser(db, userId));

  if (!resolvedWorkspaceId) {
    throw new ApiRouteError(400, "request_error", "Workspace is not configured.");
  }

  const access = await assertWorkspaceAccess(
    db,
    userId,
    resolvedWorkspaceId,
    options.minimumRole || "member"
  );

  if (
    options.adminVisibilityKey &&
    !isWorkspaceAdminVisibilityAllowed(
      access.membership.role,
      access.workspace.settings,
      options.adminVisibilityKey
    )
  ) {
    throw new ApiRouteError(403, "forbidden", "Workspace admin access is disabled.");
  }

  let workspaceMemberUserIds: string[] = [userId];
  if (options.includeMemberUserIds) {
    const memberships = await listActiveWorkspaceMembershipsForWorkspace(
      db,
      resolvedWorkspaceId
    );
    workspaceMemberUserIds = Array.from(
      new Set(memberships.map((membership: any) => String(membership.userId)).filter(Boolean))
    );
  }

  return {
    workspaceId: resolvedWorkspaceId,
    workspace: access.workspace,
    membership: access.membership,
    workspaceMemberUserIds,
  };
};
