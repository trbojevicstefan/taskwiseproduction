import { apiError, apiSuccess, mapApiError } from "@/lib/api-route";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import {
  ensureWorkspaceBootstrapForUser,
  getActiveWorkspaceIdForUser,
  getActiveWorkspaceForUser,
} from "@/lib/workspace-context";
import { findActiveWorkspaceMembership } from "@/lib/workspace-memberships";

export async function GET() {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return apiError(401, "request_error", "Unauthorized");
    }

    const db = await getDb();
    await ensureWorkspaceBootstrapForUser(db, userId);

    const [activeWorkspaceId, workspace] = await Promise.all([
      getActiveWorkspaceIdForUser(db, userId),
      getActiveWorkspaceForUser(db, userId),
    ]);

    if (!workspace || !activeWorkspaceId) {
      return apiError(404, "not_found", "No active workspace found.");
    }

    const membership = await findActiveWorkspaceMembership(db, activeWorkspaceId, userId);
    if (!membership) {
      return apiError(403, "forbidden", "Forbidden");
    }

    return apiSuccess({
      workspace: {
        id: workspace.id,
        name: workspace.name,
      },
      membership: {
        id: membership._id,
        role: membership.role,
        status: membership.status,
      },
      activeWorkspaceId,
    });
  } catch (error) {
    return mapApiError(error, "Failed to fetch active workspace.");
  }
}
