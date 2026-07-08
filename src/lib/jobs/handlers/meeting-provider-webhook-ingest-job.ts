/**
 * Phase 7 — async webhook ingestion for adapter-based meeting providers
 * (Fireflies, Grain). Mirrors `fathom-webhook-ingest-job`: the webhook route
 * enqueues fast, this handler re-parses the payload via the adapter, fetches
 * the full meeting when the webhook only carried a reference, and runs the
 * shared `ingestProviderMeeting` pipeline.
 */

import { ApiRouteError } from "@/lib/api-route";
import { getDb } from "@/lib/db";
import { findMeetingConnectionById } from "@/lib/meeting-connections";
import { getMeetingProviderAdapter } from "@/lib/meeting-providers";
import { ingestProviderMeeting } from "@/lib/meeting-providers/ingest-pipeline";
import {
  createLogger,
  ensureCorrelationId,
  type StructuredLogger,
} from "@/lib/observability";

export const runMeetingProviderWebhookIngestJob = async ({
  userId,
  provider,
  connectionId,
  payload,
  correlationId,
  logger: baseLogger,
}: {
  userId: string;
  provider: string;
  connectionId: string;
  payload?: Record<string, unknown>;
  correlationId?: string;
  logger?: StructuredLogger;
}) => {
  const resolvedCorrelationId = ensureCorrelationId(correlationId);
  const logger = (
    baseLogger || createLogger({ scope: "jobs.meeting-provider-webhook-ingest" })
  ).child({
    correlationId: resolvedCorrelationId,
    userId,
    provider,
    connectionId,
  });
  const startedAtMs = Date.now();
  logger.info("jobs.meeting-provider-webhook-ingest.started");

  const adapter = getMeetingProviderAdapter(provider);
  if (!adapter || adapter.legacyWebhook) {
    throw new ApiRouteError(404, "not_found", `Unknown meeting provider: ${provider}`);
  }

  const db = await getDb();
  const connection = await findMeetingConnectionById(db as any, connectionId);
  if (!connection || connection.provider !== adapter.provider) {
    throw new ApiRouteError(404, "not_found", "Meeting provider connection not found.");
  }
  if (connection.status !== "active") {
    logger.warn("jobs.meeting-provider-webhook-ingest.connection_inactive");
    return { status: "ignored", reason: "connection_inactive" };
  }

  const parsed = adapter.parseWebhookPayload(payload || {});
  if (parsed.kind === "ignore") {
    logger.info("jobs.meeting-provider-webhook-ingest.ignored", {
      reason: parsed.reason,
    });
    return { status: "ignored", reason: parsed.reason };
  }

  let meeting = parsed.kind === "meeting" ? parsed.meeting : null;
  if (!meeting) {
    const externalMeetingId =
      parsed.kind === "ref" ? parsed.externalMeetingId : null;
    if (!externalMeetingId || typeof adapter.fetchMeeting !== "function") {
      throw new ApiRouteError(
        422,
        "request_error",
        "Webhook referenced a meeting the provider adapter cannot fetch."
      );
    }
    meeting = await adapter.fetchMeeting(connection, externalMeetingId);
    if (!meeting) {
      logger.warn("jobs.meeting-provider-webhook-ingest.meeting_not_found", {
        externalMeetingId,
      });
      return { status: "not_found", externalMeetingId };
    }
  }

  const result = await ingestProviderMeeting({
    db,
    provider: adapter.provider,
    userId: connection.userId,
    workspaceId: connection.workspaceId,
    connectionId: connection._id,
    meeting,
    correlationId: resolvedCorrelationId,
    logger,
  });

  logger.info("jobs.meeting-provider-webhook-ingest.succeeded", {
    durationMs: Date.now() - startedAtMs,
    status: result.status,
    meetingId: "meetingId" in result ? result.meetingId : null,
  });

  return {
    status: result.status,
    meetingId: "meetingId" in result ? result.meetingId : null,
  };
};
