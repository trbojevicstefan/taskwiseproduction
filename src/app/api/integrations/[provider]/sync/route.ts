/**
 * Phase 7 — on-demand backfill sync for adapter-based meeting providers.
 *
 * POST /api/integrations/[provider]/sync { since? } -> enqueues a
 * `meeting-provider-sync` job and kicks the worker; answers 202. Fathom and
 * unknown providers 404 (fathom has its own /api/fathom/sync).
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
import { enqueueJob } from "@/lib/jobs/store";
import { kickJobWorker } from "@/lib/jobs/worker";
import { findMeetingConnectionForWorkspace } from "@/lib/meeting-connections";
import { getMeetingProviderAdapter } from "@/lib/meeting-providers";
import { getSessionUserId } from "@/lib/server-auth";
import { resolveWorkspaceScopeForUser } from "@/lib/workspace-scope";

const ROUTE = "/api/integrations/[provider]/sync";

const syncRequestSchema = z
  .object({
    since: z.string().datetime().optional().nullable(),
  })
  .optional()
  .nullable();

export async function POST(
  request: Request,
  {
    params,
  }: {
    params: { provider: string } | Promise<{ provider: string }>;
  }
) {
  const routeContext = createRouteRequestContext({
    request,
    route: ROUTE,
    method: "POST",
  });
  const { correlationId, logger, durationMs, setMetricUserId, emitMetric } =
    routeContext;

  try {
    const { provider: rawProvider } = await Promise.resolve(params);
    const providerId = (rawProvider || "").trim().toLowerCase();
    const adapter = getMeetingProviderAdapter(providerId);
    if (!adapter || adapter.legacyWebhook) {
      emitMetric(404, "error", { reason: "unknown_provider" });
      return apiError(404, "not_found", "Unknown integration provider.");
    }

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

    // Body is optional; tolerate an empty body.
    const body = await parseJsonBody(request, syncRequestSchema).catch(() => null);

    const connection = await findMeetingConnectionForWorkspace(
      db,
      workspaceId,
      adapter.provider
    );
    if (!connection || connection.status !== "active") {
      emitMetric(404, "error", { reason: "connection_not_found" });
      return apiError(
        404,
        "not_found",
        "No active connection exists for this provider.",
        undefined,
        { correlationId }
      );
    }

    const job = await enqueueJob(db, {
      type: "meeting-provider-sync",
      userId,
      correlationId,
      payload: {
        provider: adapter.provider,
        connectionId: connection._id,
        since: body?.since ?? null,
      },
    });
    void kickJobWorker();

    logger.info("api.request.succeeded", {
      status: 202,
      durationMs: durationMs(),
      provider: adapter.provider,
      workspaceId,
      jobId: job._id,
    });
    emitMetric(202, "success", { provider: adapter.provider });
    return apiSuccess(
      { status: "accepted", provider: adapter.provider, jobId: job._id },
      { correlationId, status: 202 }
    );
  } catch (error) {
    const statusCode = getApiErrorStatus(error);
    emitMetric(statusCode, "error");
    return mapApiError(error, "Failed to start the provider sync.", {
      correlationId,
      logger,
      context: { route: ROUTE, method: "POST", durationMs: durationMs() },
    });
  }
}
