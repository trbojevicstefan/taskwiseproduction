import { z } from "zod";
import { apiError, apiSuccess, mapApiError, parseJsonBody } from "@/lib/api-route";
import {
  deleteFathomWebhook,
} from "@/lib/fathom";
import { getValidFathomAccessTokenForConnection } from "@/lib/fathom-auth";
import {
  findFathomConnectionById,
  listFathomConnectionsForWorkspace,
  serializeFathomConnection,
  updateFathomConnectionById,
  type FathomConnectionDoc,
} from "@/lib/fathom-connections";
import { findWorkspaceById, updateWorkspaceById } from "@/lib/workspaces";
import { requireWorkspaceRouteAccess } from "@/lib/workspace-route-access";

const updateConnectionSchema = z.object({
  label: z.string().trim().min(1).max(80).optional(),
  setPreferred: z.boolean().optional(),
}).refine((value) => Boolean(value.label) || value.setPreferred === true, {
  message: "Provide a label update or setPreferred=true.",
});

const canManageWorkspaceConnections = (role: string | null | undefined) =>
  role === "owner" || role === "admin";

const canManageConnection = (
  connection: FathomConnectionDoc,
  userId: string,
  role: string | null | undefined
) =>
  connection.createdByUserId === userId || canManageWorkspaceConnections(role);

const buildWebhookDeleteTargets = (connection: FathomConnectionDoc) =>
  connection.webhook.managedWebhooks?.length
    ? connection.webhook.managedWebhooks
    : connection.webhook.webhookId || connection.webhook.webhookUrl
      ? [
          {
            id: connection.webhook.webhookId || null,
            url: connection.webhook.webhookUrl || null,
          },
        ]
      : [];

const loadConnectionForWorkspace = async (
  db: any,
  workspaceId: string,
  connectionId: string
) => {
  const connection = await findFathomConnectionById(db, connectionId);
  if (!connection) {
    return null;
  }
  if (connection.workspaceId !== workspaceId) {
    throw new Error("workspace_mismatch");
  }
  return connection;
};

const setWorkspacePreferredFathomConnection = async (
  db: any,
  workspaceId: string,
  connectionId: string | null
) => {
  const workspace = await findWorkspaceById(db, workspaceId);
  if (!workspace) {
    throw new Error("workspace_missing");
  }
  const nextSettings = {
    ...(workspace.settings || {}),
    integrations: {
      ...(workspace.settings?.integrations || {}),
      preferredFathomConnectionId: connectionId,
    },
  };
  await updateWorkspaceById(db, workspaceId, { settings: nextSettings as any });
};

export async function PATCH(
  request: Request,
  {
    params,
  }: {
    params:
      | { workspaceId: string; connectionId: string }
      | Promise<{ workspaceId: string; connectionId: string }>;
  }
) {
  try {
    const { workspaceId: rawWorkspaceId, connectionId: rawConnectionId } =
      await Promise.resolve(params);
    const workspaceId = rawWorkspaceId?.trim();
    const connectionId = rawConnectionId?.trim();
    if (!workspaceId) {
      return apiError(400, "request_error", "Workspace ID is required.");
    }
    if (!connectionId) {
      return apiError(400, "request_error", "Connection ID is required.");
    }

    const access = await requireWorkspaceRouteAccess(workspaceId, "member", {
      adminVisibilityKey: "integrations",
    });
    if (!access.ok) {
      return access.response;
    }

    const connection = await loadConnectionForWorkspace(access.db as any, workspaceId, connectionId);
    if (!connection) {
      return apiError(404, "not_found", "Fathom connection not found.");
    }
    if (
      !canManageConnection(connection, access.userId, access.membership?.role || null)
    ) {
      return apiError(403, "forbidden", "You do not have access to update this connection.");
    }

    const body = await parseJsonBody(
      request,
      updateConnectionSchema,
      "Invalid connection update payload."
    );
    const nextLabel = body.label?.trim() || null;
    if (nextLabel && nextLabel !== connection.label) {
      const existing = await listFathomConnectionsForWorkspace(access.db as any, workspaceId);
      const duplicate = existing.find(
        (candidate) => candidate._id !== connectionId && candidate.label === nextLabel
      );
      if (duplicate) {
        return apiError(
          409,
          "conflict",
          "A Fathom connection with this label already exists in the workspace."
        );
      }
    }

    if (body.setPreferred === true) {
      await setWorkspacePreferredFathomConnection(access.db as any, workspaceId, connectionId);
    }
    const updated =
      nextLabel && nextLabel !== connection.label
        ? await updateFathomConnectionById(access.db as any, connectionId, {
            label: nextLabel,
            updatedByUserId: access.userId,
          })
        : connection;
    if (!updated) {
      return apiError(404, "not_found", "Fathom connection not found.");
    }

    return apiSuccess({
      workspaceId,
      preferredConnectionId: body.setPreferred === true ? connectionId : null,
      connection: {
        ...serializeFathomConnection(updated),
        connectedByCurrentUser: updated.createdByUserId === access.userId,
        canManage: canManageConnection(updated, access.userId, access.membership?.role || null),
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "workspace_mismatch") {
      return apiError(403, "forbidden", "Fathom connection does not belong to this workspace.");
    }
    if (error instanceof Error && error.message === "workspace_missing") {
      return apiError(404, "not_found", "Workspace not found.");
    }
    return mapApiError(error, "Failed to update Fathom connection.");
  }
}

export async function DELETE(
  _request: Request,
  {
    params,
  }: {
    params:
      | { workspaceId: string; connectionId: string }
      | Promise<{ workspaceId: string; connectionId: string }>;
  }
) {
  try {
    const { workspaceId: rawWorkspaceId, connectionId: rawConnectionId } =
      await Promise.resolve(params);
    const workspaceId = rawWorkspaceId?.trim();
    const connectionId = rawConnectionId?.trim();
    if (!workspaceId) {
      return apiError(400, "request_error", "Workspace ID is required.");
    }
    if (!connectionId) {
      return apiError(400, "request_error", "Connection ID is required.");
    }

    const access = await requireWorkspaceRouteAccess(workspaceId, "member", {
      adminVisibilityKey: "integrations",
    });
    if (!access.ok) {
      return access.response;
    }

    const connection = await loadConnectionForWorkspace(access.db as any, workspaceId, connectionId);
    if (!connection) {
      return apiError(404, "not_found", "Fathom connection not found.");
    }
    if (
      !canManageConnection(connection, access.userId, access.membership?.role || null)
    ) {
      return apiError(403, "forbidden", "You do not have access to revoke this connection.");
    }

    const webhookTargets = buildWebhookDeleteTargets(connection);
    const webhookErrors: string[] = [];
    let deletedWebhooks = 0;

    if (
      connection.status !== "revoked" &&
      webhookTargets.length > 0 &&
      connection.oauth.accessToken
    ) {
      try {
        const accessToken = await getValidFathomAccessTokenForConnection(connectionId);
        for (const webhook of webhookTargets) {
          try {
            await deleteFathomWebhook(accessToken, webhook as any);
            deletedWebhooks += 1;
          } catch (error) {
            webhookErrors.push(error instanceof Error ? error.message : String(error));
          }
        }
      } catch (error) {
        webhookErrors.push(error instanceof Error ? error.message : String(error));
      }
    }

    const updated = await updateFathomConnectionById(access.db as any, connectionId, {
      status: "revoked",
      updatedByUserId: access.userId,
      revokedAt: new Date(),
      webhook: {
        ...connection.webhook,
        status: "revoked",
        webhookId: null,
        webhookUrl: null,
        managedWebhooks: [],
        lastSyncedAt: new Date(),
        lastError: webhookErrors.length
          ? { message: `Webhook cleanup had ${webhookErrors.length} error(s).` }
          : null,
      },
    });
    if (!updated) {
      return apiError(404, "not_found", "Fathom connection not found.");
    }
    const workspace = await findWorkspaceById(access.db as any, workspaceId);
    if (workspace?.settings?.integrations?.preferredFathomConnectionId === connectionId) {
      await setWorkspacePreferredFathomConnection(access.db as any, workspaceId, null);
    }

    return apiSuccess({
      workspaceId,
      deletedWebhooks,
      webhookErrors,
      connection: {
        ...serializeFathomConnection(updated),
        connectedByCurrentUser: updated.createdByUserId === access.userId,
        canManage: canManageConnection(updated, access.userId, access.membership?.role || null),
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "workspace_mismatch") {
      return apiError(403, "forbidden", "Fathom connection does not belong to this workspace.");
    }
    if (error instanceof Error && error.message === "workspace_missing") {
      return apiError(404, "not_found", "Workspace not found.");
    }
    return mapApiError(error, "Failed to revoke Fathom connection.");
  }
}
