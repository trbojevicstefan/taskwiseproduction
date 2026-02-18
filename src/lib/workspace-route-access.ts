import { apiError, ApiRouteError } from "@/lib/api-route";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import {
  assertWorkspaceAccess,
  ensureWorkspaceBootstrapForUser,
} from "@/lib/workspace-context";
import { isWorkspaceMembershipGuardEnabled } from "@/lib/workspace-flags";
import type { WorkspaceRole } from "@/lib/workspace-roles";

type WorkspaceRouteAccessResult =
  | {
      ok: true;
      db: Awaited<ReturnType<typeof getDb>>;
      userId: string;
    }
  | {
      ok: false;
      response: ReturnType<typeof apiError>;
    };

export const requireWorkspaceRouteAccess = async (
  workspaceId: string,
  minimumRole: WorkspaceRole = "member"
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
    return { ok: true, db, userId };
  }

  try {
    await ensureWorkspaceBootstrapForUser(db, userId);
    await assertWorkspaceAccess(db, userId, workspaceId, minimumRole);
    return { ok: true, db, userId };
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
