import { z } from "zod";
import { apiError, apiSuccess, mapApiError, parseJsonBody } from "@/lib/api-route";
import { FATHOM_SCOPES } from "@/lib/fathom-utils";
import {
  findFathomConnectionById,
  findPreferredFathomConnectionForWorkspace,
  listFathomConnectionsForWorkspace,
  serializeFathomConnection,
  type FathomConnectionDoc,
} from "@/lib/fathom-connections";
import { requireWorkspaceRouteAccess } from "@/lib/workspace-route-access";

const createConnectionRequestSchema = z.object({
  label: z.string().trim().min(1).max(80).optional().nullable(),
  connectionId: z.string().trim().min(1).optional().nullable(),
});

const canManageWorkspaceConnections = (role: string | null | undefined) =>
  role === "owner" || role === "admin";

const canManageConnection = (
  connection: FathomConnectionDoc,
  userId: string,
  role: string | null | undefined
) =>
  connection.createdByUserId === userId || canManageWorkspaceConnections(role);

const toConnectionSummary = (
  connection: FathomConnectionDoc,
  input: {
    currentUserId: string;
    currentUserRole: string | null | undefined;
    preferredConnectionId: string | null;
  }
) => ({
  ...serializeFathomConnection(connection),
  isPreferred: connection._id === input.preferredConnectionId,
  connectedByCurrentUser: connection.createdByUserId === input.currentUserId,
  canManage: canManageConnection(connection, input.currentUserId, input.currentUserRole),
});

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

    const [connections, preferredConnection] = await Promise.all([
      listFathomConnectionsForWorkspace(access.db as any, workspaceId),
      findPreferredFathomConnectionForWorkspace(access.db as any, workspaceId, access.userId),
    ]);

    const serializedConnections = connections.map((connection) =>
      toConnectionSummary(connection, {
        currentUserId: access.userId,
        currentUserRole: access.membership?.role || null,
        preferredConnectionId: preferredConnection?._id || null,
      })
    );
    const activeConnectionCount = connections.filter(
      (connection) => connection.status === "active"
    ).length;

    return apiSuccess({
      workspace: {
        id: workspaceId,
        name: access.workspace?.name || null,
      },
      provider: "fathom",
      scopes: FATHOM_SCOPES,
      preferredConnectionId: preferredConnection?._id || null,
      activeConnectionCount,
      totalConnectionCount: connections.length,
      connections: serializedConnections,
    });
  } catch (error) {
    return mapApiError(error, "Failed to load workspace Fathom connections.");
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

    const body = await parseJsonBody(
      request,
      createConnectionRequestSchema,
      "Invalid connection create payload."
    );
    const requestedConnectionId = body.connectionId?.trim() || null;
    const requestedLabel = body.label?.trim() || null;

    const targetConnection = requestedConnectionId
      ? await findFathomConnectionById(access.db as any, requestedConnectionId)
      : null;
    if (requestedConnectionId && !targetConnection) {
      return apiError(404, "not_found", "Fathom connection not found.");
    }
    if (targetConnection && targetConnection.workspaceId !== workspaceId) {
      return apiError(403, "forbidden", "Fathom connection does not belong to this workspace.");
    }
    if (
      targetConnection &&
      !canManageConnection(targetConnection, access.userId, access.membership?.role || null)
    ) {
      return apiError(403, "forbidden", "You do not have access to update this connection.");
    }

    const query = new URLSearchParams({ workspaceId });
    if (requestedConnectionId) {
      query.set("connectionId", requestedConnectionId);
    }
    if (requestedLabel) {
      query.set("label", requestedLabel);
    }

    return apiSuccess({
      workspaceId,
      provider: "fathom",
      redirectUrl: `/api/fathom/oauth/start?${query.toString()}`,
      connectionId: targetConnection?._id || null,
      label: requestedLabel || targetConnection?.label || null,
      scopes: FATHOM_SCOPES,
    });
  } catch (error) {
    return mapApiError(error, "Failed to prepare Fathom connection setup.");
  }
}
