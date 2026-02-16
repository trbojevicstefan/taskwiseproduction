import { ApiRouteError, apiError, apiSuccess, mapApiError } from "@/lib/api-route";
import { getDb } from "@/lib/db";
import { runMeetingRescanJob } from "@/lib/jobs/handlers/meeting-rescan-job";
import { enqueueJob } from "@/lib/jobs/store";
import type { MeetingRescanMode } from "@/lib/jobs/types";
import { kickJobWorker } from "@/lib/jobs/worker";
import { recordRouteMetric } from "@/lib/observability-metrics";
import { createLogger, getRequestCorrelationId } from "@/lib/observability";
import { getSessionUserId } from "@/lib/server-auth";
import { z } from "zod";

const bodySchema = z
  .object({
    mode: z.enum(["completed", "new", "both"]).optional(),
    fullReanalysis: z.boolean().optional(),
    sync: z.boolean().optional(),
  })
  .partial()
  .optional();

const resolveMode = (body: z.infer<typeof bodySchema>): MeetingRescanMode => {
  if (body?.mode) {
    return body.mode;
  }
  return body?.fullReanalysis ? "both" : "completed";
};

const ROUTE = "/api/meetings/[id]/rescan";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const { id } = await params;
    if (!id) {
      emitMetric(400, "error", { reason: "missing_meeting_id" });
      logger.warn("api.request.invalid", {
        reason: "missing_meeting_id",
        durationMs: Date.now() - startedAtMs,
      });
      return apiError(400, "invalid_request", "Meeting ID is required.", undefined, {
        correlationId,
      });
    }

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
    const mode = resolveMode(body);
    const runSync = new URL(request.url).searchParams.get("sync") === "1" || Boolean(body?.sync);

    if (runSync) {
      const result = await runMeetingRescanJob({
        userId,
        meetingId: id,
        mode,
        correlationId,
        logger,
      });
      logger.info("api.request.succeeded", {
        execution: "sync",
        status: 200,
        durationMs: Date.now() - startedAtMs,
      });
      emitMetric(200, "success", { execution: "sync" });
      return apiSuccess(result, { correlationId });
    }

    const db = await getDb();
    const job = await enqueueJob(db, {
      type: "meeting-rescan",
      userId,
      correlationId,
      payload: {
        meetingId: id,
        mode,
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
    });
    emitMetric(202, "success", {
      execution: "queued",
      jobId: job._id,
      jobType: job.type,
    });
    return response;
  } catch (error) {
    const statusCode = error instanceof ApiRouteError ? error.status : 500;
    emitMetric(statusCode, "error");
    return mapApiError(error, "Failed to rescan meeting.", {
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
