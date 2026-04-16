import { apiError, apiSuccess, mapApiError } from "@/lib/api-route";
import {
  findMcpApiKeyById,
  revokeMcpApiKeyById,
  serializeMcpApiKey,
} from "@/lib/mcp-api-keys";
import { logMcpAuditEvent } from "@/lib/mcp-audit-logs";
import { requireWorkspaceRouteAccess } from "@/lib/workspace-route-access";

const canManageWorkspaceIntegrations = (role: string | null | undefined) =>
  role === "owner" || role === "admin";

export async function DELETE(
  _request: Request,
  {
    params,
  }: {
    params:
      | { workspaceId: string; keyId: string }
      | Promise<{ workspaceId: string; keyId: string }>;
  }
) {
  try {
    const { workspaceId: rawWorkspaceId, keyId: rawKeyId } = await Promise.resolve(params);
    const workspaceId = rawWorkspaceId?.trim();
    const keyId = rawKeyId?.trim();

    if (!workspaceId) {
      return apiError(400, "request_error", "Workspace ID is required.");
    }
    if (!keyId) {
      return apiError(400, "request_error", "Key ID is required.");
    }

    const access = await requireWorkspaceRouteAccess(workspaceId, "member", {
      adminVisibilityKey: "integrations",
    });
    if (!access.ok) {
      return access.response;
    }
    if (!canManageWorkspaceIntegrations(access.membership?.role || null)) {
      return apiError(403, "forbidden", "You do not have access to revoke MCP API keys.");
    }

    const existing = await findMcpApiKeyById(access.db as any, keyId);
    if (!existing || existing.workspaceId !== workspaceId) {
      return apiError(404, "not_found", "MCP API key not found.");
    }

    const revoked = await revokeMcpApiKeyById(access.db as any, keyId, access.userId);
    if (!revoked) {
      return apiError(404, "not_found", "MCP API key not found.");
    }

    await logMcpAuditEvent(access.db as any, {
      workspaceId,
      actorType: "user",
      actorUserId: access.userId,
      action: "mcp.key.revoked",
      resourceType: "mcpKey",
      resourceId: keyId,
      status: "success",
      message: `Revoked MCP key "${existing.name}"`,
      metadata: {
        keyId,
        keyName: existing.name,
      },
    });

    return apiSuccess({
      workspaceId,
      key: serializeMcpApiKey(revoked),
      revoked: true,
    });
  } catch (error) {
    return mapApiError(error, "Failed to revoke MCP API key.");
  }
}
