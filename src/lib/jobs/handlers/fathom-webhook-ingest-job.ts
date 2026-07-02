import { ApiRouteError } from "@/lib/api-route";
import { findUserById } from "@/lib/db/users";
import {
  getFathomRecordingHashScope,
  getValidFathomAccessToken,
  getValidFathomAccessTokenForConnection,
  hashFathomRecordingId,
} from "@/lib/fathom";
import { ingestFathomMeeting } from "@/lib/fathom-ingest";
import { logFathomIntegration } from "@/lib/fathom-logs";
import {
  createLogger,
  ensureCorrelationId,
  type StructuredLogger,
} from "@/lib/observability";
import { recordExternalApiFailure } from "@/lib/observability-metrics";

export const runFathomWebhookIngestJob = async ({
  userId,
  recordingId,
  connectionId,
  providerSourceId,
  data,
  correlationId,
  logger: baseLogger,
}: {
  userId: string;
  recordingId: string;
  connectionId?: string | null;
  providerSourceId?: string | null;
  data?: Record<string, unknown>;
  correlationId?: string;
  logger?: StructuredLogger;
}) => {
  const resolvedCorrelationId = ensureCorrelationId(correlationId);
  const logger = (baseLogger || createLogger({ scope: "jobs.fathom-webhook-ingest" })).child({
    correlationId: resolvedCorrelationId,
    userId,
    connectionId: connectionId || null,
  });
  const startedAtMs = Date.now();
  logger.info("jobs.fathom-webhook-ingest.started");

  const user = await findUserById(userId);
  if (!user) {
    throw new ApiRouteError(404, "not_found", "User not found.");
  }

  let accessToken = "";
  try {
    accessToken = connectionId
      ? await getValidFathomAccessTokenForConnection(connectionId)
      : await getValidFathomAccessToken(userId);
  } catch (error) {
    void recordExternalApiFailure({
      provider: "fathom",
      operation: "oauth.token",
      userId,
      correlationId: resolvedCorrelationId,
      durationMs: Date.now() - startedAtMs,
      error,
      metadata: { recordingId },
    });
    throw error;
  }

  const recordingIdHash = hashFathomRecordingId(
    getFathomRecordingHashScope({ userId, connectionId }),
    recordingId
  );
  const result = await ingestFathomMeeting({
    user,
    recordingId,
    connectionId: connectionId || null,
    providerSourceId: providerSourceId || null,
    data: data || {},
    accessToken,
  });

  if (result.status === "duplicate") {
    await logFathomIntegration(
      userId,
      "info",
      "webhook.ingest",
      "Duplicate meeting received; updated existing meeting.",
      { recordingIdHash }
    );
  } else if (result.status === "no_transcript") {
    await logFathomIntegration(
      userId,
      "warn",
      "webhook.ingest",
      "Transcript missing for recording.",
      { recordingIdHash }
    );
  } else {
    await logFathomIntegration(
      userId,
      "info",
      "webhook.ingest",
      "Meeting ingested from webhook.",
      { recordingIdHash, meetingId: result.meetingId }
    );
  }

  logger.info("jobs.fathom-webhook-ingest.succeeded", {
    durationMs: Date.now() - startedAtMs,
    status: result.status,
    meetingId: "meetingId" in result ? result.meetingId : null,
  });

  return {
    status: result.status,
    meetingId: "meetingId" in result ? result.meetingId : null,
  };
};
