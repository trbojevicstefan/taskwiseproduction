import crypto from "crypto";
import { NextResponse } from "next/server";
import {
  getFathomInstallation,
  getValidFathomAccessToken,
} from "@/lib/fathom";
import { ingestFathomMeeting } from "@/lib/fathom-ingest";
import { findUserByFathomWebhookToken } from "@/lib/db/users";

const getSignaturesFromHeader = (headerValue: string) => {
  return headerValue
    .trim()
    .split(/\s+/)
    .map((chunk) => chunk.split(",", 2))
    .filter((parts) => parts.length === 2)
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
  return signatures.some((sig) => {
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
    return NextResponse.json(
      { error: "Missing webhook token." },
      { status: 400 }
    );
  }

  const rawBody = await request.text();

  const user = await findUserByFathomWebhookToken(token);
  if (!user) {
    return NextResponse.json({ error: "Unknown webhook token." }, { status: 404 });
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
    return NextResponse.json(
      { error: "Invalid webhook signature." },
      { status: 401 }
    );
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch (error) {
    return NextResponse.json(
      { error: "Invalid JSON payload." },
      { status: 400 }
    );
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
    return NextResponse.json({ status: "ignored", eventType });
  }

  const recordingId =
    data.recording_id ||
    data.recordingId ||
    data?.recording?.id ||
    data?.recording?.recording_id ||
    data?.recording_id;
  if (!recordingId) {
    return NextResponse.json(
      { error: "Missing recording ID." },
      { status: 400 }
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
    return NextResponse.json({ status: "duplicate", meetingId: result.meetingId });
  }

  if (result.status === "no_transcript") {
    return NextResponse.json(
      { error: "Transcript unavailable for recording." },
      { status: 422 }
    );
  }

  return NextResponse.json({ status: "ok", meetingId: result.meetingId });
}
