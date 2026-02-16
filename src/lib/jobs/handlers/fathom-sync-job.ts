import { ApiRouteError } from "@/lib/api-route";
import { getDb } from "@/lib/db";
import { findUserById } from "@/lib/db/users";
import {
  fetchFathomMeetings,
  getValidFathomAccessToken,
  hashFathomRecordingId,
} from "@/lib/fathom";
import { ingestFathomMeeting } from "@/lib/fathom-ingest";
import { logFathomIntegration } from "@/lib/fathom-logs";
import type { FathomSyncRange } from "@/lib/jobs/types";
import { recordExternalApiFailure } from "@/lib/observability-metrics";
import {
  createLogger,
  ensureCorrelationId,
  serializeError,
  type StructuredLogger,
} from "@/lib/observability";

const extractRecordingId = (meeting: any) =>
  meeting?.recording_id ||
  meeting?.recordingId ||
  meeting?.recording?.id ||
  meeting?.recording?.recording_id ||
  meeting?.id ||
  null;

const toErrorPayload = (error: unknown) => ({
  message: error instanceof Error ? error.message : String(error),
  stack: error instanceof Error ? error.stack : null,
});

const toDate = (value: unknown) => {
  if (!value) return null;
  const date = new Date(value as string);
  return Number.isNaN(date.getTime()) ? null : date;
};

const getMeetingDate = (meeting: any) =>
  toDate(
    meeting?.recording_start_time ||
      meeting?.recording_end_time ||
      meeting?.scheduled_start_time ||
      meeting?.created_at
  );

const startOfDay = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());

const startOfWeek = (date: Date) => {
  const day = date.getDay();
  const diff = (day + 6) % 7;
  const start = new Date(date);
  start.setDate(date.getDate() - diff);
  start.setHours(0, 0, 0, 0);
  return start;
};

const startOfMonth = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), 1);

const resolveRangeBounds = (range: FathomSyncRange) => {
  const now = new Date();
  switch (range) {
    case "today":
      return { rangeStart: startOfDay(now), rangeEnd: now };
    case "this_week":
      return { rangeStart: startOfWeek(now), rangeEnd: now };
    case "last_week": {
      const thisWeekStart = startOfWeek(now);
      const lastWeekEnd = new Date(thisWeekStart.getTime() - 1);
      return { rangeStart: startOfWeek(lastWeekEnd), rangeEnd: lastWeekEnd };
    }
    case "this_month":
      return { rangeStart: startOfMonth(now), rangeEnd: now };
    case "all":
    default:
      return { rangeStart: null, rangeEnd: null };
  }
};

export const runFathomSyncJob = async ({
  userId,
  range,
  correlationId,
  logger: baseLogger,
}: {
  userId: string;
  range: FathomSyncRange;
  correlationId?: string;
  logger?: StructuredLogger;
}) => {
  const resolvedCorrelationId = ensureCorrelationId(correlationId);
  const logger = (baseLogger || createLogger({ scope: "jobs.fathom-sync" })).child({
    correlationId: resolvedCorrelationId,
    userId,
    range,
  });
  const startedAtMs = Date.now();
  logger.info("jobs.fathom-sync.started");

  const user = await findUserById(userId);
  if (!user) {
    throw new ApiRouteError(404, "not_found", "User not found.");
  }

  await logFathomIntegration(userId, "info", "sync.start", "Fathom sync started.", {
    range,
    correlationId: resolvedCorrelationId,
  });

  let accessToken: string;
  try {
    accessToken = await getValidFathomAccessToken(userId);
  } catch (error) {
    void recordExternalApiFailure({
      provider: "fathom",
      operation: "oauth.token",
      userId,
      correlationId: resolvedCorrelationId,
      durationMs: Date.now() - startedAtMs,
      error,
      metadata: { range },
    });
    await logFathomIntegration(
      userId,
      "error",
      "sync.token.failed",
      "Failed to get access token.",
      {
        ...toErrorPayload(error),
        range,
        correlationId: resolvedCorrelationId,
      }
    );
    logger.error("jobs.fathom-sync.token.failed", {
      error: serializeError(error),
    });
    throw error;
  }

  let meetings: any[] = [];
  try {
    meetings = await fetchFathomMeetings(accessToken);
  } catch (error) {
    void recordExternalApiFailure({
      provider: "fathom",
      operation: "meetings.list",
      userId,
      correlationId: resolvedCorrelationId,
      durationMs: Date.now() - startedAtMs,
      error,
      metadata: { range },
    });
    await logFathomIntegration(
      userId,
      "error",
      "sync.fetch.failed",
      "Failed to fetch meetings.",
      {
        ...toErrorPayload(error),
        range,
        correlationId: resolvedCorrelationId,
      }
    );
    logger.error("jobs.fathom-sync.fetch.failed", {
      error: serializeError(error),
    });
    throw error;
  }

  const { rangeStart, rangeEnd } = resolveRangeBounds(range);
  const filteredMeetings = meetings.filter((meeting: any) => {
    if (!rangeStart || !rangeEnd) return true;
    const meetingDate = getMeetingDate(meeting);
    if (!meetingDate) return false;
    return meetingDate >= rangeStart && meetingDate <= rangeEnd;
  });

  const db = await getDb();
  const recordingIds = filteredMeetings
    .map((meeting: any) => extractRecordingId(meeting))
    .filter((id: any): id is string | number => Boolean(id))
    .map((id: any) => String(id));
  const recordingIdHashes = recordingIds.map((id: any) => hashFathomRecordingId(userId, id));
  const existing = recordingIds.length
    ? await db
        .collection("meetings")
        .find({
          userId,
          $or: [
            { recordingIdHash: { $in: recordingIdHashes } },
            { recordingId: { $in: recordingIds } },
          ],
        })
        .project({ recordingId: 1, recordingIdHash: 1 })
        .toArray()
    : [];

  const existingHashes = new Set(
    existing
      .map((meeting: any) => meeting.recordingIdHash)
      .filter((value: any) => typeof value === "string")
  );
  const existingIds = new Set(
    existing
      .map((meeting: any) => meeting.recordingId)
      .filter((value: any) => typeof value === "string")
      .map((value: any) => String(value))
  );

  let created = 0;
  let duplicate = 0;
  let skipped = 0;

  for (const meeting of filteredMeetings) {
    const recordingId = extractRecordingId(meeting);
    if (!recordingId) {
      skipped += 1;
      continue;
    }
    const recordingIdHash = hashFathomRecordingId(userId, String(recordingId));
    if (existingHashes.has(recordingIdHash) || existingIds.has(String(recordingId))) {
      duplicate += 1;
      continue;
    }

    let result: Awaited<ReturnType<typeof ingestFathomMeeting>> | null = null;
    try {
      result = await ingestFathomMeeting({
        user,
        recordingId: String(recordingId),
        data: meeting,
        accessToken,
      });
    } catch (error) {
      void recordExternalApiFailure({
        provider: "fathom",
        operation: "meetings.ingest",
        userId,
        correlationId: resolvedCorrelationId,
        error,
        metadata: {
          recordingId: String(recordingId),
          range,
        },
      });
      skipped += 1;
      await logFathomIntegration(
        userId,
        "error",
        "sync.ingest.failed",
        "Failed to ingest Fathom meeting.",
        {
          recordingId: String(recordingId),
          ...toErrorPayload(error),
          correlationId: resolvedCorrelationId,
        }
      );
      logger.warn("jobs.fathom-sync.ingest.failed", {
        recordingId: String(recordingId),
        error: serializeError(error),
      });
      continue;
    }

    if (result?.status === "created") created += 1;
    else if (result?.status === "duplicate") duplicate += 1;
    else skipped += 1;
  }

  await logFathomIntegration(userId, "info", "sync.complete", "Fathom sync completed.", {
    range,
    created,
    duplicate,
    skipped,
    correlationId: resolvedCorrelationId,
  });
  logger.info("jobs.fathom-sync.succeeded", {
    durationMs: Date.now() - startedAtMs,
    created,
    duplicate,
    skipped,
    total: filteredMeetings.length,
  });

  return {
    status: "ok",
    created,
    duplicate,
    skipped,
    range,
  };
};


