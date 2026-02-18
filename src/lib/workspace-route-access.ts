import { apiError, ApiRouteError } from "@/lib/api-route";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import {
  assertWorkspaceAccess,
  ensureWorkspaceBootstrapForUser,
} from "@/lib/workspace-context";
import { isWorkspaceMembershipGuardEnabled } from "@/lib/workspace-flags";
import type { WorkspaceRole } from "@/lib/workspace-roles";
import {
  isWorkspaceAdminVisibilityAllowed,
  type WorkspaceAdminVisibilityKey,
} from "@/lib/workspace-settings";

type WorkspaceRouteAccessResult =
  | {
      ok: true;
      db: Awaited<ReturnType<typeof getDb>>;
      userId: string;
      workspace: any;
      membership: any;
    }
  | {
      ok: false;
      response: ReturnType<typeof apiError>;
    };

export const requireWorkspaceRouteAccess = async (
  workspaceId: string,
  minimumRole: WorkspaceRole = "member",
  options?: { adminVisibilityKey?: WorkspaceAdminVisibilityKey }
): Promise<WorkspaceRouteAccessResult> => {
  const userId = await getSessionUserId();
  if (!userId) {
    return {
      ok: false,
      response: apiError(401, "request_error", "Unauthorized"),
    };
  }

  if (!workspaceId?.trim()) {
    return {
      ok: false,
      response: apiError(400, "request_error", "Workspace ID is required."),
    };
  }

  const db = await getDb();
  if (!isWorkspaceMembershipGuardEnabled()) {
    return {
      ok: true,
      db,
      userId,
      workspace: null,
      membership: { role: "owner", status: "active" },
    };
  }

  try {
    await ensureWorkspaceBootstrapForUser(db, userId);
    const access = await assertWorkspaceAccess(db, userId, workspaceId, minimumRole);
    if (
      options?.adminVisibilityKey &&
      !isWorkspaceAdminVisibilityAllowed(
        access.membership.role,
        access.workspace.settings,
        options.adminVisibilityKey
      )
    ) {
      return {
        ok: false,
        response: apiError(403, "forbidden", "Workspace admin access is disabled."),
      };
    }
    return { ok: true, db, userId, workspace: access.workspace, membership: access.membership };
  } catch (error) {
    if (error instanceof ApiRouteError) {
      return {
        ok: false,
        response: apiError(error.status, error.code, error.message, error.details),
      };
    }
    throw error;
  }
};
