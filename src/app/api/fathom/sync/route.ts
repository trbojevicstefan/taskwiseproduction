import {
  ApiRouteError,
  apiError,
  apiSuccess,
  mapApiError,
} from "@/lib/api-route";
import { getDb } from "@/lib/db";
import { runFathomSyncJob } from "@/lib/jobs/handlers/fathom-sync-job";
import { enqueueJob } from "@/lib/jobs/store";
import type { FathomSyncRange } from "@/lib/jobs/types";
import { kickJobWorker } from "@/lib/jobs/worker";
import { recordRouteMetric } from "@/lib/observability-metrics";
import { createLogger, getRequestCorrelationId } from "@/lib/observability";
import { getSessionUserId } from "@/lib/server-auth";
import { z } from "zod";

const bodySchema = z
  .object({
    sync: z.boolean().optional(),
  })
  .partial()
  .optional();

const parseRange = (value: string | null): FathomSyncRange => {
  const range = (value || "all") as FathomSyncRange;
  return ["today", "this_week", "last_week", "this_month", "all"].includes(range)
    ? range
    : "all";
};

const ROUTE = "/api/fathom/sync";

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

    const url = new URL(request.url);
    const range = parseRange(url.searchParams.get("range"));
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
    const runSync = url.searchParams.get("sync") === "1" || Boolean(body?.sync);

    if (runSync) {
      const result = await runFathomSyncJob({
        userId,
        range,
        correlationId,
        logger,
      });
      logger.info("api.request.succeeded", {
        execution: "sync",
        status: 200,
        durationMs: Date.now() - startedAtMs,
      });
      emitMetric(200, "success", { execution: "sync", range });
      return apiSuccess(result, { correlationId });
    }

    const db = await getDb();
    const job = await enqueueJob(db, {
      type: "fathom-sync",
      userId,
      correlationId,
      payload: { range },
    });
    void kickJobWorker();

    const response = apiSuccess(
      {
        jobId: job._id,
        status: job.status,
        range,
      },
      { status: 202, correlationId }
    );
    logger.info("api.request.succeeded", {
      execution: "queued",
      status: 202,
      durationMs: Date.now() - startedAtMs,
      jobId: job._id,
      jobType: job.type,
      range,
    });
    emitMetric(202, "success", {
      execution: "queued",
      jobId: job._id,
      jobType: job.type,
      range,
    });
    return response;
  } catch (error) {
    const statusCode = error instanceof ApiRouteError ? error.status : 500;
    emitMetric(statusCode, "error");
    return mapApiError(error, "Failed to sync Fathom meetings.", {
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
