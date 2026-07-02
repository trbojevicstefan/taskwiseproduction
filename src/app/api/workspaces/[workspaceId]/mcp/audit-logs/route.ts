import { apiError, apiSuccess, mapApiError } from "@/lib/api-route";
import { listMcpAuditLogsForWorkspace, serializeMcpAuditLog } from "@/lib/mcp-audit-logs";
import { requireWorkspaceRouteAccess } from "@/lib/workspace-route-access";

const parseLimit = (value: string | null, fallback = 30) => {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(100, parsed));
};

export async function GET(
  request: Request,
  {
    params,
  }: {
    params: { workspaceId: string } | Promise<{ workspaceId: string }>;
  }
) {
  try {
    const { workspaceId: rawWorkspaceId } = await Promise.resolve(params);
    const workspaceId = rawWorkspaceId?.trim();
    if (!workspaceId) {
      return apiError(400, "request_error", "Workspace ID is required.");
    }

    const access = await requireWorkspaceRouteAccess(workspaceId, "member", {
      adminVisibilityKey: "integrations",
    });
    if (!access.ok) {
      return access.response;
    }

    const searchParams = new URL(request.url).searchParams;
    const limit = parseLimit(searchParams.get("limit"), 30);
    const logs = await listMcpAuditLogsForWorkspace(access.db as any, workspaceId, limit);

    return apiSuccess({
      workspaceId,
      logs: logs.map((log) => serializeMcpAuditLog(log)),
      totalCount: logs.length,
    });
  } catch (error) {
    return mapApiError(error, "Failed to load MCP audit logs.");
  }
}
