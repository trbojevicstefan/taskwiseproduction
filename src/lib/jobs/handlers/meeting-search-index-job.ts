/**
 * Semantic search chunk indexing for one meeting. Enqueued from the
 * `meeting.ingested` / `meeting.updated` domain-event handler
 * (src/lib/domain-events.ts) so Fathom, Fireflies, Grain, and manual
 * meetings all index consistently through the shared ingestion rails.
 * The underlying indexer (src/lib/meeting-search-chunks.ts) is idempotent
 * and degrades gracefully when embeddings are unavailable.
 */

import { getDb } from "@/lib/db";
import { indexMeetingSearchChunksForMeeting } from "@/lib/meeting-search-chunks";
import {
  createLogger,
  ensureCorrelationId,
  type StructuredLogger,
} from "@/lib/observability";

export const runMeetingSearchIndexJob = async ({
  userId,
  meetingId,
  workspaceId,
  correlationId,
  logger: baseLogger,
}: {
  userId: string;
  meetingId: string;
  workspaceId?: string | null;
  correlationId?: string;
  logger?: StructuredLogger;
}) => {
  const resolvedCorrelationId = ensureCorrelationId(correlationId);
  const logger = (
    baseLogger || createLogger({ scope: "jobs.meeting-search-index" })
  ).child({
    correlationId: resolvedCorrelationId,
    userId,
    meetingId,
    workspaceId: workspaceId ?? null,
  });
  const startedAtMs = Date.now();
  logger.info("jobs.meeting-search-index.started");

  const db = await getDb();
  const result = await indexMeetingSearchChunksForMeeting(db as any, {
    meetingId,
    userId,
    workspaceId: workspaceId ?? null,
  });

  logger.info("jobs.meeting-search-index.finished", {
    durationMs: Date.now() - startedAtMs,
    status: result.status,
    chunkCount: result.chunkCount,
  });
  return {
    meetingId,
    status: result.status,
    chunkCount: result.chunkCount,
  };
};
