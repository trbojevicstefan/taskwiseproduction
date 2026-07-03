/**
 * Phase 7 — backfill sync for adapter-based meeting providers (Fireflies,
 * Grain). Mirrors `fathom-sync-job` at a smaller scale: list external
 * meeting ids via the adapter, fetch each meeting, and run the shared
 * `ingestProviderMeeting` pipeline (its dedupe skips already-ingested
 * meetings).
 */

import { ApiRouteError } from "@/lib/api-route";
import { getDb } from "@/lib/db";
import { findMeetingConnectionById } from "@/lib/meeting-connections";
import { getMeetingProviderAdapter } from "@/lib/meeting-providers";
import { ingestProviderMeeting } from "@/lib/meeting-providers/ingest-pipeline";
import {
  createLogger,
  ensureCorrelationId,
  serializeError,
  type StructuredLogger,
} from "@/lib/observability";

const DEFAULT_SYNC_LIMIT = Math.max(
  1,
  Number(process.env.MEETING_PROVIDER_SYNC_LIMIT || 25)
);

export const runMeetingProviderSyncJob = async ({
  userId,
  provider,
  connectionId,
  since,
  correlationId,
  logger: baseLogger,
}: {
  userId: string;
  provider: string;
  connectionId: string;
  since?: string | null;
  correlationId?: string;
  logger?: StructuredLogger;
}) => {
  const resolvedCorrelationId = ensureCorrelationId(correlationId);
  const logger = (
    baseLogger || createLogger({ scope: "jobs.meeting-provider-sync" })
  ).child({
    correlationId: resolvedCorrelationId,
    userId,
    provider,
    connectionId,
  });
  const startedAtMs = Date.now();
  logger.info("jobs.meeting-provider-sync.started");

  const adapter = getMeetingProviderAdapter(provider);
  if (!adapter || adapter.legacyWebhook) {
    throw new ApiRouteError(404, "not_found", `Unknown meeting provider: ${provider}`);
  }
  if (
    typeof adapter.listMeetings !== "function" ||
    typeof adapter.fetchMeeting !== "function"
  ) {
    throw new ApiRouteError(
      422,
      "request_error",
      `Meeting provider "${adapter.provider}" does not support sync.`
    );
  }

  const db = await getDb();
  const connection = await findMeetingConnectionById(db as any, connectionId);
  if (!connection || connection.provider !== adapter.provider) {
    throw new ApiRouteError(404, "not_found", "Meeting provider connection not found.");
  }
  if (connection.status !== "active") {
    throw new ApiRouteError(409, "request_error", "Connection is not active.");
  }

  const sinceDate = since ? new Date(since) : null;
  const externalIds = await adapter.listMeetings(connection, {
    since: sinceDate && !Number.isNaN(sinceDate.getTime()) ? sinceDate : undefined,
    limit: DEFAULT_SYNC_LIMIT,
  });

  let created = 0;
  let duplicates = 0;
  let noTranscript = 0;
  let failed = 0;

  for (const externalId of externalIds || []) {
    try {
      const meeting = await adapter.fetchMeeting(connection, externalId);
      if (!meeting) {
        failed += 1;
        continue;
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
      if (result.status === "created") created += 1;
      else if (result.status === "duplicate") duplicates += 1;
      else noTranscript += 1;
    } catch (error) {
      failed += 1;
      logger.warn("jobs.meeting-provider-sync.meeting_failed", {
        externalId,
        error: serializeError(error),
      });
    }
  }

  const summary = {
    listed: (externalIds || []).length,
    created,
    duplicates,
    noTranscript,
    failed,
  };
  logger.info("jobs.meeting-provider-sync.succeeded", {
    durationMs: Date.now() - startedAtMs,
    ...summary,
  });
  return summary;
};
