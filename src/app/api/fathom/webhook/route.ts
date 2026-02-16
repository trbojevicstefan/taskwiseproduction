import crypto from "crypto";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-route";
import { isQueueFirstWebhookIngestionEnabled } from "@/lib/core-first-flags";
import { getDb } from "@/lib/db";
import {
  getFathomInstallation,
  getValidFathomAccessToken,
  hashFathomRecordingId,
} from "@/lib/fathom";
import { ingestFathomMeeting } from "@/lib/fathom-ingest";
import { findUserByFathomWebhookToken } from "@/lib/db/users";
import { logFathomIntegration } from "@/lib/fathom-logs";
import { enqueueJob } from "@/lib/jobs/store";
import { kickJobWorker } from "@/lib/jobs/worker";

const getSignaturesFromHeader = (headerValue: string) => {
  return headerValue
    .trim()
    .split(/\s+/)
    .map((chunk: any) => chunk.split(",", 2))
    .filter((parts: any) => parts.length === 2)
    .map(([, signature]) => signature);
};

const decodeWebhookSecret = (secret: string) => {
  const trimmed = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  const normalized = trimmed.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = (4 - (normalized.length % 4)) % 4;
  const padded = normalized.padEnd(normalized.length + padLength, "=");

  try {
    return Buffer.from(padded, "base64");
  } catch {
    return Buffer.from(secret, "utf8");
  }
};

const buildSignedPayload = (id: string, timestamp: string, body: string) =>
  `${id}.${timestamp}.${body}`;

const MAX_WEBHOOK_AGE_MS = 5 * 60 * 1000;

const parseWebhookTimestamp = (value: string | null) => {
  if (!value) return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return numeric > 1e12 ? numeric : numeric * 1000;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
};

const verifyWebhookSignature = (
  rawBody: string,
  signatureHeader: string | null,
  secret: string | null,
  webhookId: string | null,
  webhookTimestamp: string | null
) => {
  if (!secret) return true;
  if (!signatureHeader) return false;
  if (!webhookId || !webhookTimestamp) return false;

  const timestampMs = parseWebhookTimestamp(webhookTimestamp);
  if (!timestampMs) return false;
  if (Math.abs(Date.now() - timestampMs) > MAX_WEBHOOK_AGE_MS) {
    return false;
  }

  const signingPayload = buildSignedPayload(
    webhookId,
    webhookTimestamp,
    rawBody
  );
  const decodedSecret = decodeWebhookSecret(secret);
  const expected = crypto
    .createHmac("sha256", decodedSecret)
    .update(signingPayload, "utf8")
    .digest("base64");

  const signatures = getSignaturesFromHeader(signatureHeader);
  const expectedBuffer = Buffer.from(expected);
  return signatures.some((sig: any) => {
    const signatureBuffer = Buffer.from(sig);
    if (signatureBuffer.length !== expectedBuffer.length) return false;
    return crypto.timingSafeEqual(signatureBuffer, expectedBuffer);
  });
};

const normalizePayload = (payload: any) => payload?.data ?? payload ?? {};

export async function POST(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  if (!token) {
    return apiError(400, "request_error", "Missing webhook token.");
  }

  const rawBody = await request.text();

  const user = await findUserByFathomWebhookToken(token);
  if (!user) {
    return apiError(404, "request_error", "Unknown webhook token.");
  }

  const signatureHeader = request.headers.get("webhook-signature");
  const webhookId = request.headers.get("webhook-id");
  const webhookTimestamp = request.headers.get("webhook-timestamp");
  const installation = await getFathomInstallation(user._id.toString());
  const secret =
    installation?.webhookSecret || process.env.FATHOM_WEBHOOK_SECRET || null;
  if (
    !verifyWebhookSignature(
      rawBody,
      signatureHeader,
      secret,
      webhookId,
      webhookTimestamp
    )
  ) {
    return apiError(401, "request_error", "Invalid webhook signature.");
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch (error) {
    return apiError(400, "request_error", "Invalid JSON payload.");
  }
  const data = normalizePayload(payload);
  const eventType = payload?.event || payload?.event_type || payload?.type;
  if (
    eventType &&
    ![
      "new-meeting-content-ready",
      "new_meeting_content_ready",
      "newMeeting",
      "new_meeting",
    ].includes(eventType)
  ) {
    await logFathomIntegration(
      user._id.toString(),
      "info",
      "webhook.receive",
      "Ignored webhook event type.",
      { eventType }
    );
    return NextResponse.json({ status: "ignored", eventType });
  }

  const recordingId =
    data.recording_id ||
    data.recordingId ||
    data?.recording?.id ||
    data?.recording?.recording_id ||
    data?.recording_id;
  if (!recordingId) {
    await logFathomIntegration(
      user._id.toString(),
      "warn",
      "webhook.receive",
      "Webhook missing recording ID."
    );
    return apiError(400, "request_error", "Missing recording ID.");
  }

  const recordingIdHash = hashFathomRecordingId(
    user._id.toString(),
    String(recordingId)
  );

  if (isQueueFirstWebhookIngestionEnabled()) {
    const db = await getDb();
    const job = await enqueueJob(db, {
      type: "fathom-webhook-ingest",
      userId: user._id.toString(),
      payload: {
        recordingId: String(recordingId),
        data:
          data && typeof data === "object"
            ? (data as Record<string, unknown>)
            : {},
      },
    });
    void kickJobWorker();

    await logFathomIntegration(
      user._id.toString(),
      "info",
      "webhook.enqueue",
      "Webhook accepted and queued for async ingestion.",
      { recordingIdHash, jobId: job._id }
    );

    return NextResponse.json(
      {
        status: "accepted",
        jobId: job._id,
      },
      { status: 202 }
    );
  }

  const accessToken = await getValidFathomAccessToken(user._id.toString());
  const result = await ingestFathomMeeting({
    user,
    recordingId: String(recordingId),
    data,
    accessToken,
  });

  if (result.status === "duplicate") {
    await logFathomIntegration(
      user._id.toString(),
      "info",
      "webhook.ingest",
      "Duplicate meeting received; updated existing meeting.",
      { recordingIdHash }
    );
    return NextResponse.json({ status: "duplicate", meetingId: result.meetingId });
  }

  if (result.status === "no_transcript") {
    await logFathomIntegration(
      user._id.toString(),
      "warn",
      "webhook.ingest",
      "Transcript missing for recording.",
      { recordingIdHash }
    );
    return apiError(422, "request_error", "Transcript unavailable for recording.");
  }

  await logFathomIntegration(
    user._id.toString(),
    "info",
    "webhook.ingest",
    "Meeting ingested from webhook.",
    { recordingIdHash, meetingId: result.meetingId }
  );

  return NextResponse.json({ status: "ok", meetingId: result.meetingId });
}
