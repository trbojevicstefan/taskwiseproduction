import { z } from "zod";
import { apiError, apiSuccess, mapApiError, parseJsonBody } from "@/lib/api-route";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { ensureWorkspaceBootstrapForUser, setActiveWorkspaceForUser } from "@/lib/workspace-context";
import { findActiveWorkspaceMembership } from "@/lib/workspace-memberships";
import { recordWorkspaceActionMetric } from "@/lib/observability-metrics";

const switchWorkspaceSchema = z.object({
  workspaceId: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return apiError(401, "request_error", "Unauthorized");
    }

    const input = await parseJsonBody(
      request,
      switchWorkspaceSchema,
      "Invalid workspace switch payload."
    );
    const workspaceId = input.workspaceId.trim();
    if (!workspaceId) {
      return apiError(400, "request_error", "Workspace ID is required.");
    }

    const db = await getDb();
    await ensureWorkspaceBootstrapForUser(db, userId);

    const workspace = await setActiveWorkspaceForUser(db, userId, workspaceId);
    const membership = await findActiveWorkspaceMembership(db, workspace.id, userId);

    void recordWorkspaceActionMetric({
      userId,
      action: "workspace.switch",
      workspaceId: workspace.id,
      outcome: "success",
      metadata: {
        role: membership?.role || null,
      },
    });

    return apiSuccess({
      workspace,
      membership: membership
        ? {
            id: membership._id,
            role: membership.role,
            status: membership.status,
          }
        : null,
      activeWorkspaceId: workspace.id,
    });
  } catch (error) {
    const userId = await getSessionUserId().catch(() => null);
    void recordWorkspaceActionMetric({
      userId,
      action: "workspace.switch",
      outcome: "error",
    });
    return mapApiError(error, "Failed to switch workspace.");
  }
}
