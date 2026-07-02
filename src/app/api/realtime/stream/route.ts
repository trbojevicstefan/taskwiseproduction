import { apiError } from "@/lib/api-route";
import { getDb } from "@/lib/db";
import { ensureDomainEventIndexes } from "@/lib/domain-events";
import { recordRouteMetric } from "@/lib/observability-metrics";
import { getRequestCorrelationId } from "@/lib/observability";
import {
  deriveRealtimeTopicsForDomainEvent,
  parseRealtimeTopicList,
  type RealtimeDomainUpdate,
} from "@/lib/realtime-events";
import { getSessionUserId } from "@/lib/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const POLL_INTERVAL_MS = 2000;
const HEARTBEAT_INTERVAL_MS = 25000;
const MAX_BATCH_SIZE = 200;
const MAX_STREAM_LIFETIME_MS = Math.min(
  295000,
  Math.max(10000, Number(process.env.REALTIME_STREAM_MAX_LIFETIME_MS || 285000))
);

const encoder = new TextEncoder();

const toMillis = (value: unknown) => {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value).getTime();
    if (!Number.isNaN(parsed)) return parsed;
  }
  return Date.now();
};

const formatSseChunk = (event: string, payload: unknown, id?: string) => {
  const lines: string[] = [];
  if (id) lines.push(`id: ${id}`);
  lines.push(`event: ${event}`);
  lines.push(`data: ${JSON.stringify(payload)}`);
  return `${lines.join("\n")}\n\n`;
};

export async function GET(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) {
    return apiError(401, "request_error", "Unauthorized");
  }
  const correlationId = getRequestCorrelationId(request);

  const db = await getDb();
  await ensureDomainEventIndexes(db);
  const { searchParams } = new URL(request.url);
  const subscribedTopics = parseRealtimeTopicList(searchParams.get("topics"));
  const subscribedTopicSet = new Set(subscribedTopics);

  let cursorMs = Date.now();
  let cursorId = "";

  const lastEventId = request.headers.get("last-event-id");
  if (lastEventId) {
    const lastEvent = await db.collection("domainEvents").findOne({
      _id: lastEventId,
      userId,
    });
    if (lastEvent) {
      cursorMs = toMillis(lastEvent.createdAt);
      cursorId = lastEventId;
    }
  }

  let closeStream: (() => void) | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let pollTimer: ReturnType<typeof setInterval> | null = null;
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
      let maxLifetimeTimer: ReturnType<typeof setTimeout> | null = null;
      let inFlight = false;
      let deliveredUpdates = 0;
      const connectedAtMs = Date.now();

      closeStream = () => {
        if (closed) return;
        closed = true;
        if (pollTimer) clearInterval(pollTimer);
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        if (maxLifetimeTimer) clearTimeout(maxLifetimeTimer);
        request.signal.removeEventListener("abort", closeStream as () => void);
        void recordRouteMetric({
          correlationId,
          userId,
          route: "/api/realtime/stream",
          method: "GET",
          statusCode: 200,
          durationMs: Date.now() - connectedAtMs,
          outcome: "success",
          metadata: {
            topics: subscribedTopics,
            updatesDelivered: deliveredUpdates,
          },
        });
        try {
          controller.close();
        } catch {
          // stream already closed
        }
      };

      const sendSse = (event: string, payload: unknown, id?: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(formatSseChunk(event, payload, id)));
        } catch {
          closeStream?.();
        }
      };

      const advanceCursor = (eventTimestampMs: number, eventId: string) => {
        cursorMs = eventTimestampMs;
        cursorId = eventId;
      };

      const pollEvents = async () => {
        if (closed || inFlight) return;
        inFlight = true;
        try {
          const cursorDate = new Date(cursorMs);
          const events = await db
            .collection("domainEvents")
            .find({
              userId,
              status: "handled",
              $or: [
                { createdAt: { $gt: cursorDate } },
                { createdAt: cursorDate, _id: { $gt: cursorId || "" } },
              ],
            })
            .project({ _id: 1, type: 1, payload: 1, createdAt: 1 })
            .sort({ createdAt: 1, _id: 1 })
            .limit(MAX_BATCH_SIZE)
            .toArray();

          events.forEach((eventDoc: any) => {
            const eventId = String(eventDoc?._id || "");
            if (!eventId) return;

            const eventTimestampMs = toMillis(eventDoc.createdAt);

            const topics = deriveRealtimeTopicsForDomainEvent(
              String(eventDoc.type || ""),
              eventDoc.payload
            );
            advanceCursor(eventTimestampMs, eventId);
            if (!topics.length) return;

            if (
              subscribedTopicSet.size > 0 &&
              !topics.some((topic: any) => subscribedTopicSet.has(topic))
            ) {
              return;
            }

            const update: RealtimeDomainUpdate = {
              id: eventId,
              type: String(eventDoc.type || ""),
              topics,
              createdAt: new Date(eventTimestampMs).toISOString(),
              payload: eventDoc.payload ?? null,
            };
            sendSse("update", update, eventId);
            deliveredUpdates += 1;
          });
        } catch (error) {
          console.error("Realtime stream poll failed:", error);
        } finally {
          inFlight = false;
        }
      };

      sendSse("ready", {
        connectedAt: new Date().toISOString(),
        topics: subscribedTopics,
      });
      void pollEvents();

      pollTimer = setInterval(() => {
        void pollEvents();
      }, POLL_INTERVAL_MS);

      heartbeatTimer = setInterval(() => {
        sendSse("ping", { ts: Date.now() });
      }, HEARTBEAT_INTERVAL_MS);

      maxLifetimeTimer = setTimeout(() => {
        closeStream?.();
      }, MAX_STREAM_LIFETIME_MS);

      request.signal.addEventListener("abort", closeStream);
    },
    cancel() {
      closeStream?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
