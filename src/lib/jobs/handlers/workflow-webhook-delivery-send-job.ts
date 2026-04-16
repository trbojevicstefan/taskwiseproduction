import { ApiRouteError } from "@/lib/api-route";
import { getDb } from "@/lib/db";
import { enqueueJob } from "@/lib/jobs/store";
import {
  appendWebhookDeliveryAttempt,
  findWebhookDeliveryById,
} from "@/lib/webhook-deliveries";
import {
  createLogger,
  ensureCorrelationId,
  serializeError,
  type StructuredLogger,
} from "@/lib/observability";

const MAX_RETRY_DELAY_MS = 5 * 60 * 1000;
const BASE_RETRY_DELAY_MS = 30 * 1000;

const resolveRetryDelayMs = (attemptNumber: number) => {
  const exponent = Math.max(0, attemptNumber - 1);
  return Math.min(MAX_RETRY_DELAY_MS, BASE_RETRY_DELAY_MS * 2 ** exponent);
};

const normalizeHeaders = (headers: Headers) => {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key] = value;
  });
  return result;
};

const toRequestBody = (body: unknown) => {
  if (typeof body === "string") {
    return body;
  }
  return JSON.stringify(body ?? {});
};

export const runWorkflowWebhookDeliverySendJob = async ({
  userId,
  deliveryId,
  correlationId,
  logger: baseLogger,
}: {
  userId: string;
  deliveryId: string;
  correlationId?: string;
  logger?: StructuredLogger;
}) => {
  const resolvedCorrelationId = ensureCorrelationId(correlationId);
  const logger = (baseLogger ||
    createLogger({ scope: "jobs.workflow-webhook-delivery-send" })).child({
    correlationId: resolvedCorrelationId,
    userId,
    deliveryId,
  });
  const startedAtMs = Date.now();
  logger.info("jobs.workflow-webhook-delivery-send.started");

  const db = await getDb();
  const delivery = await findWebhookDeliveryById(db as any, deliveryId);
  if (!delivery) {
    throw new ApiRouteError(404, "not_found", "Webhook delivery not found.");
  }
  if (delivery.status === "disabled" || delivery.status === "sent") {
    return {
      deliveryId,
      status: delivery.status,
      skipped: true,
    };
  }

  const attemptNumber = Math.max(1, delivery.attemptCount + 1);
  const requestBody = toRequestBody(delivery.request.body);
  const startedAt = new Date();

  try {
    const response = await fetch(delivery.request.url, {
      method: delivery.request.method || "POST",
      headers: (delivery.request.headers || {}) as HeadersInit,
      body: requestBody,
    });
    const finishedAt = new Date();
    const responseBody = await response.text().catch(() => null);

    if (response.ok) {
      const updated = await appendWebhookDeliveryAttempt(db as any, deliveryId, {
        attemptNumber,
        status: "sent",
        startedAt,
        finishedAt,
        request: delivery.request,
        response: {
          statusCode: response.status,
          headers: normalizeHeaders(response.headers),
          body: responseBody,
          durationMs: finishedAt.getTime() - startedAt.getTime(),
          receivedAt: finishedAt,
        },
        error: null,
      });

      logger.info("jobs.workflow-webhook-delivery-send.succeeded", {
        durationMs: Date.now() - startedAtMs,
        attemptNumber,
        statusCode: response.status,
      });
      return {
        deliveryId,
        status: updated?.status || "sent",
        attemptNumber,
        responseStatusCode: response.status,
      };
    }

    const canRetry = attemptNumber < delivery.maxAttempts;
    const nextAttemptAt = canRetry
      ? new Date(finishedAt.getTime() + resolveRetryDelayMs(attemptNumber))
      : null;
    const updated = await appendWebhookDeliveryAttempt(db as any, deliveryId, {
      attemptNumber,
      status: "failed",
      startedAt,
      finishedAt,
      request: delivery.request,
      response: {
        statusCode: response.status,
        headers: normalizeHeaders(response.headers),
        body: responseBody,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        receivedAt: finishedAt,
      },
      error: {
        message: `Webhook responded with status ${response.status}.`,
      },
      nextAttemptAt,
    });

    if (nextAttemptAt) {
      await enqueueJob(db as any, {
        type: "workflow-webhook-delivery-send",
        userId,
        correlationId: resolvedCorrelationId,
        payload: {
          deliveryId,
        },
        maxAttempts: 1,
        runAt: nextAttemptAt,
      });
    }

    logger.warn("jobs.workflow-webhook-delivery-send.failed", {
      durationMs: Date.now() - startedAtMs,
      attemptNumber,
      statusCode: response.status,
      nextAttemptAt: nextAttemptAt?.toISOString() || null,
    });
    return {
      deliveryId,
      status: updated?.status || "failed",
      attemptNumber,
      responseStatusCode: response.status,
      retryScheduled: Boolean(nextAttemptAt),
    };
  } catch (error) {
    const finishedAt = new Date();
    const canRetry = attemptNumber < delivery.maxAttempts;
    const nextAttemptAt = canRetry
      ? new Date(finishedAt.getTime() + resolveRetryDelayMs(attemptNumber))
      : null;
    const updated = await appendWebhookDeliveryAttempt(db as any, deliveryId, {
      attemptNumber,
      status: "failed",
      startedAt,
      finishedAt,
      request: delivery.request,
      error: serializeError(error),
      nextAttemptAt,
    });

    if (nextAttemptAt) {
      await enqueueJob(db as any, {
        type: "workflow-webhook-delivery-send",
        userId,
        correlationId: resolvedCorrelationId,
        payload: {
          deliveryId,
        },
        maxAttempts: 1,
        runAt: nextAttemptAt,
      });
    }

    logger.warn("jobs.workflow-webhook-delivery-send.exception", {
      durationMs: Date.now() - startedAtMs,
      attemptNumber,
      nextAttemptAt: nextAttemptAt?.toISOString() || null,
      error: serializeError(error),
    });
    return {
      deliveryId,
      status: updated?.status || "failed",
      attemptNumber,
      retryScheduled: Boolean(nextAttemptAt),
      error: serializeError(error),
    };
  }
};

