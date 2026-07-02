import { ApiRouteError, apiError, apiSuccess, mapApiError } from "@/lib/api-route";
import { getDb } from "@/lib/db";
import { runSlackUsersSyncJob } from "@/lib/jobs/handlers/slack-users-sync-job";
import { enqueueJob } from "@/lib/jobs/store";
import { kickJobWorker } from "@/lib/jobs/worker";
import { recordRouteMetric } from "@/lib/observability-metrics";
import { createLogger, getRequestCorrelationId } from "@/lib/observability";
import { getSessionUserId } from "@/lib/server-auth";
import { z } from "zod";

const bodySchema = z
  .object({
    selectedIds: z.array(z.string()).optional(),
    sync: z.boolean().optional(),
  })
  .partial()
  .optional();

const ROUTE = "/api/slack/users/sync";

export async function POST(request: Request) {
  const correlationId = getRequestCorrelationId(request);
  const logger = createLogger({
    scope: "api.route",
    route: ROUTE,
    method: "POST",
    correlationId,
  });
  const startedAtMs = Date.now();
  logger.info("api.request.started");
  let metricUserId: string | null = null;
  const emitMetric = (
    statusCode: number,
    outcome: "success" | "error",
    metadata?: Record<string, unknown>
  ) => {
    void recordRouteMetric({
      correlationId,
      userId: metricUserId,
      route: ROUTE,
      method: "POST",
      statusCode,
      durationMs: Date.now() - startedAtMs,
      outcome,
      metadata,
    });
  };

  try {
    const userId = await getSessionUserId();
    if (!userId) {
      emitMetric(401, "error", { reason: "unauthorized" });
      logger.warn("api.request.unauthorized", {
        durationMs: Date.now() - startedAtMs,
      });
      return apiError(401, "unauthorized", "Unauthorized", undefined, {
        correlationId,
      });
    }
    metricUserId = userId;

    const rawBody = await request
      .json()
      .catch(() => ({}));
    const parsedBody = bodySchema.safeParse(rawBody);
    if (!parsedBody.success) {
      throw new ApiRouteError(
        400,
        "invalid_payload",
        "Invalid request payload.",
        parsedBody.error.flatten()
      );
    }

    const body = parsedBody.data;
    const runSync = new URL(request.url).searchParams.get("sync") === "1" || Boolean(body?.sync);

    if (runSync) {
      const result = await runSlackUsersSyncJob({
        userId,
        selectedIds: body?.selectedIds,
        correlationId,
        logger,
      });
      logger.info("api.request.succeeded", {
        execution: "sync",
        status: 200,
        durationMs: Date.now() - startedAtMs,
      });
      emitMetric(200, "success", {
        execution: "sync",
        selectedCount: body?.selectedIds?.length || 0,
      });
      return apiSuccess(result, { correlationId });
    }

    const db = await getDb();
    const job = await enqueueJob(db, {
      type: "slack-users-sync",
      userId,
      correlationId,
      payload: {
        selectedIds: body?.selectedIds,
      },
    });
    void kickJobWorker();

    const response = apiSuccess(
      {
        jobId: job._id,
        status: job.status,
      },
      { status: 202, correlationId }
    );
    logger.info("api.request.succeeded", {
      execution: "queued",
      status: 202,
      durationMs: Date.now() - startedAtMs,
      jobId: job._id,
      jobType: job.type,
      selectedCount: body?.selectedIds?.length || 0,
    });
    emitMetric(202, "success", {
      execution: "queued",
      jobId: job._id,
      jobType: job.type,
      selectedCount: body?.selectedIds?.length || 0,
    });
    return response;
  } catch (error) {
    const statusCode = error instanceof ApiRouteError ? error.status : 500;
    emitMetric(statusCode, "error");
    return mapApiError(error, "Failed to sync Slack users.", {
      correlationId,
      logger,
      context: {
        route: ROUTE,
        method: "POST",
        durationMs: Date.now() - startedAtMs,
      },
    });
  }
}
