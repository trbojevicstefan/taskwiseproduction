import { ApiRouteError, apiError, apiSuccess, mapApiError } from "@/lib/api-route";
import { getDb } from "@/lib/db";
import { getJobByIdForUser, serializeJob } from "@/lib/jobs/store";
import { recordRouteMetric } from "@/lib/observability-metrics";
import { createLogger, getRequestCorrelationId } from "@/lib/observability";
import { getSessionUserId } from "@/lib/server-auth";

const ROUTE = "/api/jobs/[id]";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const correlationId = getRequestCorrelationId(request);
  const logger = createLogger({
    scope: "api.route",
    route: ROUTE,
    method: "GET",
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
      method: "GET",
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

    const { id } = await params;
    if (!id) {
      emitMetric(400, "error", { reason: "missing_job_id" });
      logger.warn("api.request.invalid", {
        reason: "missing_job_id",
        durationMs: Date.now() - startedAtMs,
      });
      return apiError(400, "invalid_request", "Job ID is required.", undefined, {
        correlationId,
      });
    }

    const db = await getDb();
    const job = await getJobByIdForUser(db, userId, id);
    if (!job) {
      emitMetric(404, "error", { reason: "job_not_found", jobId: id });
      logger.warn("api.request.not_found", {
        jobId: id,
        durationMs: Date.now() - startedAtMs,
      });
      return apiError(404, "not_found", "Job not found.", undefined, {
        correlationId,
      });
    }

    logger.info("api.request.succeeded", {
      status: 200,
      durationMs: Date.now() - startedAtMs,
      jobId: id,
      jobType: job.type,
      jobStatus: job.status,
    });
    emitMetric(200, "success", {
      jobId: id,
      jobType: job.type,
      jobStatus: job.status,
    });
    return apiSuccess({ job: serializeJob(job) }, { correlationId });
  } catch (error) {
    const statusCode = error instanceof ApiRouteError ? error.status : 500;
    emitMetric(statusCode, "error");
    return mapApiError(error, "Failed to fetch job status.", {
      correlationId,
      logger,
      context: {
        route: ROUTE,
        method: "GET",
        durationMs: Date.now() - startedAtMs,
      },
    });
  }
}
