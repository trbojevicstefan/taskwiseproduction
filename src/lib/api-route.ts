import { NextResponse } from "next/server";
import { z } from "zod";
import { recordRouteMetric } from "@/lib/observability-metrics";
import {
  attachCorrelationIdHeader,
  createLogger,
  ensureCorrelationId,
  getRequestCorrelationId,
  serializeError,
  type StructuredLogger,
} from "@/lib/observability";

export class ApiRouteError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export type ApiResponseInit = ResponseInit & {
  correlationId?: string | null;
};

export const apiSuccess = <T extends Record<string, unknown>>(
  payload: T,
  init?: ApiResponseInit
) => {
  const { correlationId, ...responseInit } = init || {};
  const response = NextResponse.json({ ok: true, ...payload }, responseInit);
  return attachCorrelationIdHeader(response, correlationId);
};

export const apiError = (
  status: number,
  code: string,
  message: string,
  details?: unknown,
  init?: ApiResponseInit
) => {
  const { correlationId, ...responseInit } = init || {};
  const response = NextResponse.json(
    {
      ok: false,
      error: message,
      errorCode: code,
      ...(details !== undefined ? { details } : {}),
    },
    { ...responseInit, status }
  );
  return attachCorrelationIdHeader(response, correlationId);
};

export const parseJsonBody = async <TSchema extends z.ZodTypeAny>(
  request: Request,
  schema: TSchema,
  invalidMessage = "Invalid request payload."
): Promise<z.infer<TSchema>> => {
  const body = await request
    .json()
    .catch(() => {
      throw new ApiRouteError(400, "invalid_json", "Invalid JSON body.");
    });

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiRouteError(400, "invalid_payload", invalidMessage, parsed.error.flatten());
  }
  return parsed.data;
};

type RouteContextOptions = {
  request?: Request | null;
  route: string;
  method: string;
  logger?: StructuredLogger;
};

type RouteMetricOutcome = "success" | "error";

export type RouteContext = {
  correlationId: string;
  logger: StructuredLogger;
  durationMs: () => number;
  setMetricUserId: (userId: string | null) => void;
  emitMetric: (
    statusCode: number,
    outcome: RouteMetricOutcome,
    metadata?: Record<string, unknown>
  ) => void;
};

export const createRouteRequestContext = (
  options: RouteContextOptions
): RouteContext => {
  const correlationId = options.request
    ? getRequestCorrelationId(options.request)
    : ensureCorrelationId();
  const logger =
    options.logger ||
    createLogger({
      scope: "api.route",
      route: options.route,
      method: options.method,
      correlationId,
    });
  const startedAtMs = Date.now();
  let metricUserId: string | null = null;

  logger.info("api.request.started");

  return {
    correlationId,
    logger,
    durationMs: () => Date.now() - startedAtMs,
    setMetricUserId: (userId: string | null) => {
      metricUserId = userId;
    },
    emitMetric: (
      statusCode: number,
      outcome: RouteMetricOutcome,
      metadata?: Record<string, unknown>
    ) => {
      void recordRouteMetric({
        correlationId,
        userId: metricUserId,
        route: options.route,
        method: options.method,
        statusCode,
        durationMs: Date.now() - startedAtMs,
        outcome,
        metadata,
      });
    },
  };
};

type MapApiErrorOptions = {
  correlationId?: string | null;
  logger?: StructuredLogger;
  context?: Record<string, unknown>;
};

const defaultApiLogger = createLogger({ scope: "api.route" });

export const mapApiError = (
  error: unknown,
  fallbackMessage = "Internal server error.",
  options?: MapApiErrorOptions
) => {
  const resolvedCorrelationId = options?.correlationId
    ? ensureCorrelationId(options.correlationId)
    : null;
  const logger = options?.logger || defaultApiLogger;
  const context = {
    ...(options?.context || {}),
    ...(resolvedCorrelationId ? { correlationId: resolvedCorrelationId } : {}),
  };

  if (error instanceof ApiRouteError) {
    const logLevel = error.status >= 500 ? logger.error : logger.warn;
    logLevel("api.request.failed", {
      ...context,
      status: error.status,
      errorCode: error.code,
      error: serializeError(error),
    });
    return apiError(error.status, error.code, error.message, error.details, {
      correlationId: resolvedCorrelationId,
    });
  }

  if (error instanceof z.ZodError) {
    logger.warn("api.request.failed", {
      ...context,
      status: 400,
      errorCode: "invalid_payload",
      error: serializeError(error),
    });
    return apiError(
      400,
      "invalid_payload",
      "Invalid request payload.",
      error.flatten(),
      {
        correlationId: resolvedCorrelationId,
      }
    );
  }

  logger.error("api.request.failed", {
    ...context,
    status: 500,
    errorCode: "internal_error",
    error: serializeError(error),
  });
  return apiError(500, "internal_error", fallbackMessage, undefined, {
    correlationId: resolvedCorrelationId,
  });
};

export const getApiErrorStatus = (error: unknown, fallback = 500) => {
  if (error instanceof ApiRouteError) {
    return error.status;
  }
  return fallback;
};
