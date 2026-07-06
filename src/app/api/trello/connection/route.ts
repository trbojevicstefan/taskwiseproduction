/**
 * GET    /api/trello/connection — connection status for the workspace (never
 *        the token) plus the server-built Trello authorize URL for the
 *        token-paste connect flow.
 * DELETE /api/trello/connection — revoke the workspace connection (soft
 *        delete; drops the stored token).
 */

import {
  apiError,
  apiSuccess,
  createRouteRequestContext,
  getApiErrorStatus,
  mapApiError,
} from "@/lib/api-route";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { buildTrelloAuthorizeUrl, isTrelloConfigured } from "@/lib/trelloAPI";
import {
  findTrelloConnectionForWorkspace,
  revokeTrelloConnection,
  serializeTrelloConnection,
} from "@/lib/trello-connections";
import { resolveWorkspaceScopeForUser } from "@/lib/workspace-scope";

const ROUTE = "/api/trello/connection";

export async function GET(request: Request) {
  const routeContext = createRouteRequestContext({
    request,
    route: ROUTE,
    method: "GET",
  });
  const { correlationId, logger, durationMs, setMetricUserId, emitMetric } =
    routeContext;

  try {
    const userId = await getSessionUserId();
    if (!userId) {
      emitMetric(401, "error", { reason: "unauthorized" });
      return apiError(401, "request_error", "Unauthorized", undefined, {
        correlationId,
      });
    }
    setMetricUserId(userId);

    const db = await getDb();
    const { workspaceId } = await resolveWorkspaceScopeForUser(db, userId, {
      minimumRole: "member",
      adminVisibilityKey: "integrations",
    });

    const connection = await findTrelloConnectionForWorkspace(db, workspaceId);

    logger.info("api.request.succeeded", {
      status: 200,
      durationMs: durationMs(),
      workspaceId,
    });
    emitMetric(200, "success");
    return apiSuccess(
      {
        configured: isTrelloConfigured(),
        authorizeUrl: buildTrelloAuthorizeUrl(),
        connection: serializeTrelloConnection(connection),
      },
      { correlationId }
    );
  } catch (error) {
    const statusCode = getApiErrorStatus(error);
    emitMetric(statusCode, "error");
    return mapApiError(error, "Failed to load the Trello connection.", {
      correlationId,
      logger,
      context: { route: ROUTE, method: "GET", durationMs: durationMs() },
    });
  }
}

export async function DELETE(request: Request) {
  const routeContext = createRouteRequestContext({
    request,
    route: ROUTE,
    method: "DELETE",
  });
  const { correlationId, logger, durationMs, setMetricUserId, emitMetric } =
    routeContext;

  try {
    const userId = await getSessionUserId();
    if (!userId) {
      emitMetric(401, "error", { reason: "unauthorized" });
      return apiError(401, "request_error", "Unauthorized", undefined, {
        correlationId,
      });
    }
    setMetricUserId(userId);

    const db = await getDb();
    const { workspaceId } = await resolveWorkspaceScopeForUser(db, userId, {
      minimumRole: "member",
      adminVisibilityKey: "integrations",
    });

    const connection = await revokeTrelloConnection(db, workspaceId);
    if (!connection) {
      emitMetric(404, "error", { reason: "connection_not_found" });
      return apiError(
        404,
        "not_found",
        "No Trello connection exists for this workspace.",
        undefined,
        { correlationId }
      );
    }

    logger.info("api.request.succeeded", {
      status: 200,
      durationMs: durationMs(),
      workspaceId,
    });
    emitMetric(200, "success");
    return apiSuccess(
      { connection: serializeTrelloConnection(connection) },
      { correlationId }
    );
  } catch (error) {
    const statusCode = getApiErrorStatus(error);
    emitMetric(statusCode, "error");
    return mapApiError(error, "Failed to disconnect Trello.", {
      correlationId,
      logger,
      context: { route: ROUTE, method: "DELETE", durationMs: durationMs() },
    });
  }
}
