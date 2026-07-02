import { randomBytes } from "crypto";
import { z } from "zod";
import { apiError, apiSuccess, mapApiError, parseJsonBody } from "@/lib/api-route";
import {
  deleteFathomWebhook,
  ensureFathomConnectionWebhook,
  FATHOM_WEBHOOK_EVENT,
  getFathomWebhookUrl,
  pruneFathomManagedWebhooks,
} from "@/lib/fathom";
import { getValidFathomAccessTokenForConnection } from "@/lib/fathom-auth";
import {
  findFathomConnectionById,
  serializeFathomConnection,
  updateFathomConnectionById,
  type FathomConnectionDoc,
} from "@/lib/fathom-connections";
import { requireWorkspaceRouteAccess } from "@/lib/workspace-route-access";

const deleteWebhookSchema = z
  .object({
    ids: z.array(z.union([z.string(), z.record(z.any())])).optional(),
    deleteAll: z.boolean().optional(),
  })
  .optional()
  .default({});

const canManageWorkspaceConnections = (role: string | null | undefined) =>
  role === "owner" || role === "admin";

const canManageConnection = (
  connection: FathomConnectionDoc,
  userId: string,
  role: string | null | undefined
) =>
  connection.createdByUserId === userId || canManageWorkspaceConnections(role);

const serializeManagedWebhook = (entry: any) => ({
  id: entry?.id || null,
  url: entry?.url || null,
  created_at: entry?.createdAt || null,
  include_transcript: entry?.includeTranscript ?? null,
  include_summary: entry?.includeSummary ?? null,
  include_action_items: entry?.includeActionItems ?? null,
  include_crm_matches: entry?.includeCrmMatches ?? null,
  triggered_for: entry?.triggeredFor ?? null,
});

const buildConfiguredWebhooks = (connection: FathomConnectionDoc) =>
  connection.webhook.managedWebhooks?.length
    ? connection.webhook.managedWebhooks
    : connection.webhook.webhookId || connection.webhook.webhookUrl
      ? [
          {
            id: connection.webhook.webhookId || null,
            url: connection.webhook.webhookUrl || null,
            createdAt: connection.updatedAt || connection.createdAt || null,
            includeTranscript: null,
            includeSummary: null,
            includeActionItems: null,
            includeCrmMatches: null,
            triggeredFor: null,
          },
        ]
      : [];

const getConnectionWebhookUrl = (connection: FathomConnectionDoc) =>
  connection.webhook.webhookUrl ||
  (connection.webhook.token ? getFathomWebhookUrl(connection.webhook.token) : null);

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

const toConnectionResponse = (
  connection: FathomConnectionDoc,
  input: {
    currentUserId: string;
    currentUserRole: string | null | undefined;
  }
) => ({
  ...serializeFathomConnection(connection),
  connectedByCurrentUser: connection.createdByUserId === input.currentUserId,
  canManage: canManageConnection(connection, input.currentUserId, input.currentUserRole),
});

export async function GET(
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

    return apiSuccess({
      workspaceId,
      connectionId,
      webhookUrl: getConnectionWebhookUrl(connection),
      webhooks: buildConfiguredWebhooks(connection).map(serializeManagedWebhook),
      connection: toConnectionResponse(connection, {
        currentUserId: access.userId,
        currentUserRole: access.membership?.role || null,
      }),
    });
  } catch (error) {
    if (error instanceof Error && error.message === "workspace_mismatch") {
      return apiError(403, "forbidden", "Fathom connection does not belong to this workspace.");
    }
    return mapApiError(error, "Failed to load Fathom webhooks.");
  }
}

export async function POST(
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
    if (!canManageConnection(connection, access.userId, access.membership?.role || null)) {
      return apiError(403, "forbidden", "You do not have access to manage this connection.");
    }
    if (connection.status !== "active") {
      return apiError(
        409,
        "conflict",
        "Reconnect this Fathom connection before creating a webhook."
      );
    }

    const webhookToken = randomBytes(24).toString("hex");

    await updateFathomConnectionById(access.db as any, connectionId, {
      updatedByUserId: access.userId,
      webhook: {
        ...connection.webhook,
        token: webhookToken,
        status: "not_configured",
        lastError: null,
      },
    });

    try {
      const accessToken = await getValidFathomAccessTokenForConnection(connectionId);
      const result = await ensureFathomConnectionWebhook(
        connectionId,
        accessToken,
        webhookToken,
        { updatedByUserId: access.userId }
      );
      const webhookUrl = result.webhookUrl || getFathomWebhookUrl(webhookToken);
      const pruned = await pruneFathomManagedWebhooks(accessToken, {
        webhookId: result.webhookId || null,
        webhookUrl,
        managedWebhooks: result.managedWebhooks || [],
      });

      const updated = await updateFathomConnectionById(access.db as any, connectionId, {
        updatedByUserId: access.userId,
        webhook: {
          token: webhookToken,
          secret: result.webhookSecret || null,
          status: "active",
          webhookId: result.webhookId || null,
          webhookUrl: result.webhookUrl || webhookUrl,
          webhookEvent: FATHOM_WEBHOOK_EVENT,
          managedWebhooks: pruned.managedWebhooks,
          lastSyncedAt: new Date(),
          lastError: pruned.cleanupErrors.length
            ? {
                message: `Stale webhook cleanup had ${pruned.cleanupErrors.length} error(s).`,
              }
            : null,
        },
      });
      if (!updated) {
        return apiError(404, "not_found", "Fathom connection not found.");
      }

      return apiSuccess({
        workspaceId,
        connectionId,
        status: result.status,
        webhookId: result.webhookId || null,
        webhookUrl,
        staleWebhooksDeleted: pruned.deletedCount,
        cleanupErrors: pruned.cleanupErrors,
        webhooks: buildConfiguredWebhooks(updated).map(serializeManagedWebhook),
        connection: toConnectionResponse(updated, {
          currentUserId: access.userId,
          currentUserRole: access.membership?.role || null,
        }),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Webhook setup failed.";
      await updateFathomConnectionById(access.db as any, connectionId, {
        updatedByUserId: access.userId,
        webhook: {
          ...connection.webhook,
          token: webhookToken,
          status: "error",
          lastSyncedAt: new Date(),
          lastError: { message },
        },
      });
      throw error;
    }
  } catch (error) {
    if (error instanceof Error && error.message === "workspace_mismatch") {
      return apiError(403, "forbidden", "Fathom connection does not belong to this workspace.");
    }
    return mapApiError(error, "Failed to create Fathom webhook.");
  }
}

export async function DELETE(
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
    if (!canManageConnection(connection, access.userId, access.membership?.role || null)) {
      return apiError(403, "forbidden", "You do not have access to manage this connection.");
    }

    const body = await parseJsonBody(
      request,
      deleteWebhookSchema,
      "Invalid webhook delete payload."
    );
    const configuredWebhooks = buildConfiguredWebhooks(connection);
    const requestedItems = Array.isArray(body?.ids) ? body.ids : [];
    const requestedIds = requestedItems
      .map((item) => (typeof item === "string" ? item : item?.id))
      .filter((value): value is string => Boolean(value));
    const requestedUrls = requestedItems
      .map((item) => (typeof item === "string" ? null : item?.url))
      .filter((value): value is string => Boolean(value));
    const webhookTargets = body?.deleteAll
      ? configuredWebhooks
      : configuredWebhooks.filter(
          (entry) =>
            (entry.id && requestedIds.includes(entry.id)) ||
            (entry.url && requestedUrls.includes(entry.url))
        );

    if (!webhookTargets.length) {
      return apiError(400, "request_error", "No webhook IDs provided.");
    }

    const accessToken = await getValidFathomAccessTokenForConnection(connectionId);
    for (const webhook of webhookTargets) {
      await deleteFathomWebhook(accessToken, webhook as any);
    }

    const deletedIds = webhookTargets
      .map((item: any) => item?.id)
      .filter((value: string | null | undefined): value is string => Boolean(value));
    const deletedUrls = webhookTargets
      .map((item: any) => item?.url)
      .filter((value: string | null | undefined): value is string => Boolean(value));
    const remainingWebhooks =
      connection.webhook.managedWebhooks?.filter(
        (entry: any) =>
          !deletedIds.includes(entry.id || "") &&
          !deletedUrls.includes(entry.url || "")
      ) || [];
    const removedPrimary =
      (connection.webhook.webhookId && deletedIds.includes(connection.webhook.webhookId)) ||
      (connection.webhook.webhookUrl && deletedUrls.includes(connection.webhook.webhookUrl)) ||
      false;

    const updated = await updateFathomConnectionById(access.db as any, connectionId, {
      updatedByUserId: access.userId,
      webhook: {
        ...connection.webhook,
        status:
          remainingWebhooks.length || !removedPrimary ? connection.webhook.status : "not_configured",
        webhookId: removedPrimary ? null : connection.webhook.webhookId || null,
        webhookUrl: removedPrimary ? null : connection.webhook.webhookUrl || null,
        managedWebhooks: remainingWebhooks,
        lastSyncedAt: new Date(),
        lastError: null,
      },
    });
    if (!updated) {
      return apiError(404, "not_found", "Fathom connection not found.");
    }

    return apiSuccess({
      workspaceId,
      connectionId,
      deleted: webhookTargets.length,
      webhookUrl: getConnectionWebhookUrl(updated),
      webhooks: buildConfiguredWebhooks(updated).map(serializeManagedWebhook),
      connection: toConnectionResponse(updated, {
        currentUserId: access.userId,
        currentUserRole: access.membership?.role || null,
      }),
    });
  } catch (error) {
    if (error instanceof Error && error.message === "workspace_mismatch") {
      return apiError(403, "forbidden", "Fathom connection does not belong to this workspace.");
    }
    return mapApiError(error, "Failed to delete Fathom webhook(s).");
  }
}
