import { z } from "zod";
import { apiError, apiSuccess, mapApiError, parseJsonBody } from "@/lib/api-route";
import {
  createMcpApiKey,
  listMcpApiKeysForWorkspace,
  serializeMcpApiKey,
} from "@/lib/mcp-api-keys";
import { logMcpAuditEvent } from "@/lib/mcp-audit-logs";
import { requireWorkspaceRouteAccess } from "@/lib/workspace-route-access";

const createMcpKeySchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  scopes: z.array(z.enum(["mcp:read", "mcp:write"])).min(1),
  expiresAt: z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((value) => (value ? value : null)),
});

const canManageWorkspaceIntegrations = (role: string | null | undefined) =>
  role === "owner" || role === "admin";

export async function GET(
  _request: Request,
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

    const keys = await listMcpApiKeysForWorkspace(access.db as any, workspaceId);
    return apiSuccess({
      workspaceId,
      keys: keys.map((key) => serializeMcpApiKey(key)),
      totalCount: keys.length,
    });
  } catch (error) {
    return mapApiError(error, "Failed to load MCP API keys.");
  }
}

export async function POST(
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
    if (!canManageWorkspaceIntegrations(access.membership?.role || null)) {
      return apiError(403, "forbidden", "You do not have access to create MCP API keys.");
    }

    const input = await parseJsonBody(
      request,
      createMcpKeySchema,
      "Invalid MCP key create payload."
    );

    const expiresAt =
      input.expiresAt && input.expiresAt.trim()
        ? (() => {
            const parsed = new Date(input.expiresAt);
            if (Number.isNaN(parsed.getTime())) {
              throw new Error("invalid_expires_at");
            }
            return parsed;
          })()
        : null;

    const { apiKey, record } = await createMcpApiKey(access.db as any, {
      workspaceId,
      name: input.name,
      description: input.description || null,
      scopes: input.scopes,
      createdByUserId: access.userId,
      expiresAt,
    });

    await logMcpAuditEvent(access.db as any, {
      workspaceId,
      actorType: "user",
      actorUserId: access.userId,
      action: "mcp.key.created",
      resourceType: "mcpKey",
      resourceId: record._id,
      status: "success",
      message: `Created MCP key "${record.name}"`,
      metadata: {
        keyId: record._id,
        keyName: record.name,
        scopes: record.scopes,
      },
    });

    return apiSuccess(
      {
        workspaceId,
        key: serializeMcpApiKey(record),
        apiKey,
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof Error && error.message === "invalid_expires_at") {
      return apiError(400, "invalid_payload", "expiresAt must be a valid date.");
    }
    if ((error as any)?.code === 11000) {
      return apiError(409, "conflict", "A key with this name already exists.");
    }
    return mapApiError(error, "Failed to create MCP API key.");
  }
}
