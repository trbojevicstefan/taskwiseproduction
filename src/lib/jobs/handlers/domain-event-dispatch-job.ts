import { ApiRouteError } from "@/lib/api-route";
import { getDb } from "@/lib/db";
import { dispatchQueuedDomainEventById } from "@/lib/domain-events";
import {
  createLogger,
  ensureCorrelationId,
  type StructuredLogger,
} from "@/lib/observability";

export const runDomainEventDispatchJob = async ({
  userId,
  eventId,
  correlationId,
  logger: baseLogger,
}: {
  userId: string;
  eventId: string;
  correlationId?: string;
  logger?: StructuredLogger;
}) => {
  const resolvedCorrelationId = ensureCorrelationId(correlationId);
  const logger = (baseLogger || createLogger({ scope: "jobs.domain-event-dispatch" })).child({
    correlationId: resolvedCorrelationId,
    userId,
    eventId,
  });
  const startedAtMs = Date.now();
  logger.info("jobs.domain-event-dispatch.started");

  const db = await getDb();
  const dispatchResult = await dispatchQueuedDomainEventById(db, eventId, userId);
  if (!dispatchResult) {
    throw new ApiRouteError(404, "not_found", "Domain event not found.");
  }

  logger.info("jobs.domain-event-dispatch.succeeded", {
    durationMs: Date.now() - startedAtMs,
    eventType: dispatchResult.eventType,
    result: dispatchResult.result,
  });

  return {
    eventId,
    eventType: dispatchResult.eventType,
    status: dispatchResult.status,
  };
};
