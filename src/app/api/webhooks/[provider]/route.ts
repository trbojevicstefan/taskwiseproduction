/**
 * Phase 7 — generic provider webhook receiver.
 *
 * POST /api/webhooks/[provider]?token=<connection.webhookToken>
 *
 * Fathom keeps its bespoke /api/fathom/webhook route (managed webhook URLs
 * are pinned to that path) — this route 404s for it. Connection resolution
 * mirrors fathom's token-in-query pattern: the `token` query param maps to
 * `meetingConnections.webhookToken`; when the provider cannot embed a token
 * we fall back to the single active connection for that provider (ambiguous
 * => 404). Signature verification is delegated to the adapter with the
 * connection's stored webhookSecret; per the fathom precedent (pinned by
 * tests) adapters accept requests when NO secret is stored — this route does
 * not tighten or loosen that.
 *
 * Heavy ingestion never runs inline: valid payloads are queued as a
 * `meeting-provider-webhook-ingest` job and the route answers 202.
 */

import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-route";
import { getDb } from "@/lib/db";
import { enqueueJob } from "@/lib/jobs/store";
import { kickJobWorker } from "@/lib/jobs/worker";
import {
  findMeetingConnectionByWebhookToken,
  listActiveMeetingConnectionsForProvider,
  type MeetingConnectionDoc,
} from "@/lib/meeting-connections";
import {
  getMeetingProviderAdapter,
  ProviderNotImplementedError,
} from "@/lib/meeting-providers";

export async function POST(
  request: Request,
  {
    params,
  }: {
    params: { provider: string } | Promise<{ provider: string }>;
  }
) {
  const { provider: rawProvider } = await Promise.resolve(params);
  const providerId = (rawProvider || "").trim().toLowerCase();

  const adapter = getMeetingProviderAdapter(providerId);
  if (!adapter || adapter.legacyWebhook) {
    // Unknown providers and legacy-webhook providers (fathom) both 404.
    return apiError(404, "not_found", "Unknown webhook provider.");
  }

  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  const rawBody = await request.text();
  const db = await getDb();

  let connection: MeetingConnectionDoc | null = null;
  if (token) {
    connection = await findMeetingConnectionByWebhookToken(
      db as any,
      adapter.provider,
      token
    );
    if (connection && connection.status !== "active") {
      connection = null;
    }
  } else {
    const activeConnections = await listActiveMeetingConnectionsForProvider(
      db as any,
      adapter.provider
    );
    connection = activeConnections.length === 1 ? activeConnections[0] : null;
  }
  if (!connection) {
    return apiError(404, "request_error", "Unknown webhook token.");
  }

  try {
    const verified = await adapter.verifyWebhookRequest(
      rawBody,
      request.headers,
      connection.webhookSecret ?? null
    );
    if (!verified) {
      return apiError(401, "request_error", "Invalid webhook signature.");
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return apiError(400, "request_error", "Invalid JSON payload.");
    }

    const parsed = adapter.parseWebhookPayload(payload);
    if (parsed.kind === "ignore") {
      return NextResponse.json({ status: "ignored", reason: parsed.reason });
    }

    const job = await enqueueJob(db, {
      type: "meeting-provider-webhook-ingest",
      userId: connection.userId,
      payload: {
        provider: adapter.provider,
        connectionId: connection._id,
        payload:
          payload && typeof payload === "object"
            ? (payload as Record<string, unknown>)
            : {},
      },
    });
    void kickJobWorker();

    return NextResponse.json(
      { status: "accepted", jobId: job._id },
      { status: 202 }
    );
  } catch (error) {
    if (error instanceof ProviderNotImplementedError) {
      return apiError(
        501,
        "not_implemented",
        `Provider "${adapter.provider}" webhooks are not implemented yet.`
      );
    }
    console.error(`Provider webhook handling failed (${adapter.provider}):`, error);
    return apiError(500, "internal_error", "Failed to process webhook.");
  }
}
