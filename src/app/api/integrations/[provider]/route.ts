/**
 * Phase 7 — generic meeting-provider connection management.
 *
 * POST   /api/integrations/[provider]  { apiKey } -> validateCredentials ->
 *        upsert the single (workspace, provider) connection. 400 on bad key.
 * GET    /api/integrations/[provider]  -> connection status (never the key).
 * DELETE /api/integrations/[provider]  -> mark the connection revoked.
 *
 * Member+ workspace scope with the "integrations" admin-visibility key,
 * mirroring the fathom connections routes. Fathom itself (OAuth, bespoke
 * routes) and unknown providers 404 here.
 */

import { z } from "zod";
import {
  apiError,
  apiSuccess,
  createRouteRequestContext,
  getApiErrorStatus,
  mapApiError,
  parseJsonBody,
} from "@/lib/api-route";
import { getDb } from "@/lib/db";
import {
  findMeetingConnectionForWorkspace,
  revokeMeetingConnection,
  serializeMeetingConnection,
  upsertMeetingConnection,
} from "@/lib/meeting-connections";
import {
  getMeetingProviderAdapter,
  ProviderNotImplementedError,
  type MeetingProviderAdapter,
} from "@/lib/meeting-providers";
import { getSessionUserId } from "@/lib/server-auth";
import { resolveWorkspaceScopeForUser } from "@/lib/workspace-scope";

const ROUTE = "/api/integrations/[provider]";

const connectRequestSchema = z.object({
  apiKey: z.string().trim().min(1, "API key is required."),
  webhookSecret: z.string().trim().min(1).optional().nullable(),
});

type ProviderRouteParams = {
  params: { provider: string } | Promise<{ provider: string }>;
};

const resolveAdapterOr404 = async (
  params: ProviderRouteParams["params"]
): Promise<{ adapter: MeetingProviderAdapter } | { response: ReturnType<typeof apiError> }> => {
  const { provider: rawProvider } = await Promise.resolve(params);
  const providerId = (rawProvider || "").trim().toLowerCase();
  const adapter = getMeetingProviderAdapter(providerId);
  if (!adapter || adapter.legacyWebhook) {
    // Unknown providers 404; fathom 404s too — it has its own routes.
    return {
      response: apiError(404, "not_found", "Unknown integration provider."),
    };
  }
  return { adapter };
};

export async function POST(request: Request, { params }: ProviderRouteParams) {
  const routeContext = createRouteRequestContext({
    request,
    route: ROUTE,
    method: "POST",
  });
  const { correlationId, logger, durationMs, setMetricUserId, emitMetric } =
    routeContext;

  try {
    const resolved = await resolveAdapterOr404(params);
    if ("response" in resolved) {
      emitMetric(404, "error", { reason: "unknown_provider" });
      return resolved.response;
    }
    const { adapter } = resolved;

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

    const body = await parseJsonBody(
      request,
      connectRequestSchema,
      "Invalid integration connect payload."
    );

    const validation = await adapter.validateCredentials({ apiKey: body.apiKey });
    if (!validation.ok) {
      emitMetric(400, "error", { reason: "invalid_credentials" });
      return apiError(
        400,
        "invalid_credentials",
        validation.error || "The provided API key is invalid.",
        undefined,
        { correlationId }
      );
    }

    const connection = await upsertMeetingConnection(db, {
      workspaceId,
      userId,
      provider: adapter.provider,
      apiKey: body.apiKey,
      accountName: validation.accountName ?? null,
      webhookSecret: body.webhookSecret ?? undefined,
    });

    logger.info("api.request.succeeded", {
      status: 200,
      durationMs: durationMs(),
      provider: adapter.provider,
      workspaceId,
    });
    emitMetric(200, "success", { provider: adapter.provider });
    return apiSuccess(
      {
        provider: adapter.provider,
        connection: serializeMeetingConnection(connection),
      },
      { correlationId }
    );
  } catch (error) {
    if (error instanceof ProviderNotImplementedError) {
      emitMetric(501, "error", { reason: "not_implemented" });
      return apiError(
        501,
        "not_implemented",
        `Provider "${error.provider}" is not implemented yet.`,
        undefined,
        { correlationId }
      );
    }
    const statusCode = getApiErrorStatus(error);
    emitMetric(statusCode, "error");
    return mapApiError(error, "Failed to connect the integration.", {
      correlationId,
      logger,
      context: { route: ROUTE, method: "POST", durationMs: durationMs() },
    });
  }
}

export async function GET(request: Request, { params }: ProviderRouteParams) {
  const routeContext = createRouteRequestContext({
    request,
    route: ROUTE,
    method: "GET",
  });
  const { correlationId, logger, durationMs, setMetricUserId, emitMetric } =
    routeContext;

  try {
    const resolved = await resolveAdapterOr404(params);
    if ("response" in resolved) {
      emitMetric(404, "error", { reason: "unknown_provider" });
      return resolved.response;
    }
    const { adapter } = resolved;

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

    const connection = await findMeetingConnectionForWorkspace(
      db,
      workspaceId,
      adapter.provider
    );

    logger.info("api.request.succeeded", {
      status: 200,
      durationMs: durationMs(),
      provider: adapter.provider,
      workspaceId,
    });
    emitMetric(200, "success", { provider: adapter.provider });
    return apiSuccess(
      {
        provider: adapter.provider,
        displayName: adapter.displayName,
        connection: serializeMeetingConnection(connection),
      },
      { correlationId }
    );
  } catch (error) {
    const statusCode = getApiErrorStatus(error);
    emitMetric(statusCode, "error");
    return mapApiError(error, "Failed to load the integration.", {
      correlationId,
      logger,
      context: { route: ROUTE, method: "GET", durationMs: durationMs() },
    });
  }
}

export async function DELETE(request: Request, { params }: ProviderRouteParams) {
  const routeContext = createRouteRequestContext({
    request,
    route: ROUTE,
    method: "DELETE",
  });
  const { correlationId, logger, durationMs, setMetricUserId, emitMetric } =
    routeContext;

  try {
    const resolved = await resolveAdapterOr404(params);
    if ("response" in resolved) {
      emitMetric(404, "error", { reason: "unknown_provider" });
      return resolved.response;
    }
    const { adapter } = resolved;

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

    const connection = await revokeMeetingConnection(
      db,
      workspaceId,
      adapter.provider
    );
    if (!connection) {
      emitMetric(404, "error", { reason: "connection_not_found" });
      return apiError(
        404,
        "not_found",
        "No connection exists for this provider.",
        undefined,
        { correlationId }
      );
    }

    logger.info("api.request.succeeded", {
      status: 200,
      durationMs: durationMs(),
      provider: adapter.provider,
      workspaceId,
    });
    emitMetric(200, "success", { provider: adapter.provider });
    return apiSuccess(
      {
        provider: adapter.provider,
        connection: serializeMeetingConnection(connection),
      },
      { correlationId }
    );
  } catch (error) {
    const statusCode = getApiErrorStatus(error);
    emitMetric(statusCode, "error");
    return mapApiError(error, "Failed to disconnect the integration.", {
      correlationId,
      logger,
      context: { route: ROUTE, method: "DELETE", durationMs: durationMs() },
    });
  }
}
