import { createHmac, timingSafeEqual } from "crypto";
import type {
  MeetingProviderAdapter,
  NormalizedProviderMeeting,
  ParsedProviderWebhook,
} from "@/lib/meeting-providers/types";
import {
  asDate,
  cleanEmail,
  cleanString,
  durationBetween,
  firstString,
  normalizeActionItems,
  normalizeParticipants,
  normalizeTranscriptSegments,
} from "@/lib/meeting-providers/provider-utils";

const normalizeReadMeeting = (payload: any): NormalizedProviderMeeting | null => {
  const source =
    payload?.meeting && typeof payload.meeting === "object"
      ? payload.meeting
      : payload?.data?.meeting && typeof payload.data.meeting === "object"
        ? payload.data.meeting
        : payload?.data && typeof payload.data === "object"
          ? payload.data
          : payload;
  if (!source || typeof source !== "object") return null;

  const externalId = firstString(source.id, source.meeting_id, source.meetingId, payload?.meeting_id);
  if (!externalId) return null;
  const startTime = asDate(source.start_time) || asDate(source.startTime) || asDate(source.started_at);
  const endTime = asDate(source.end_time) || asDate(source.endTime) || asDate(source.ended_at);
  const owner = source.owner && typeof source.owner === "object" ? source.owner : null;
  const participants = normalizeParticipants(source.participants || source.attendees || source.guests);
  const actionItems = normalizeActionItems(source.action_items || source.actionItems || source.actions);
  const transcript = normalizeTranscriptSegments(
    source.transcript || source.transcript_turns || source.turns || source.segments,
    startTime
  );

  return {
    externalId,
    title: firstString(source.title, source.name, source.subject),
    startTime,
    endTime,
    durationSeconds:
      typeof source.duration_seconds === "number" && Number.isFinite(source.duration_seconds)
        ? Math.round(source.duration_seconds)
        : durationBetween(startTime, endTime),
    recordingUrl: firstString(source.recording_url, source.video_url, source.audio_url),
    shareUrl: firstString(source.report_url, source.reportUrl, source.url, source.share_url),
    organizerEmail:
      cleanEmail(owner?.email) || cleanEmail(source.owner_email) || cleanEmail(source.organizer_email),
    participants,
    transcript,
    summary: firstString(
      source.summary,
      source.summary?.text,
      source.summary?.overview,
      source.report?.summary,
      source.overview
    ),
    ...(actionItems.length ? { actionItems } : {}),
    raw: payload,
  };
};

const safeHexEqual = (provided: string, expected: string) => {
  if (!/^[0-9a-f]+$/i.test(provided) || provided.length !== expected.length) return false;
  const a = Buffer.from(provided.toLowerCase(), "hex");
  const b = Buffer.from(expected.toLowerCase(), "hex");
  return a.length === b.length && timingSafeEqual(a, b);
};

export const readMeetingProvider: MeetingProviderAdapter = {
  provider: "read",
  displayName: "Read AI",
  capabilities: {
    connectionMode: "webhook-only",
    manualSync: false,
    supportsWebhookSecret: true,
  },

  verifyWebhookRequest(rawBody, headers, secret) {
    if (!secret) return true;
    const rawSignature = cleanString(headers.get("x-read-signature"));
    if (!rawSignature) return false;
    const provided = rawSignature.replace(/^sha256=/i, "").trim();
    const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
    return safeHexEqual(provided, expected);
  },

  parseWebhookPayload(payload: unknown): ParsedProviderWebhook {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return { kind: "ignore", reason: "Unrecognized Read AI webhook payload." };
    }
    const source = payload as any;
    const event = firstString(source.event_type, source.event, source.type);
    const normalized = event?.toLowerCase().replace(/[._\s-]+/g, "") || "";
    if (normalized.includes("meetingstart")) {
      return { kind: "ignore", reason: "Read AI meeting_start has no final transcript." };
    }
    if (normalized && !normalized.includes("meetingend") && !normalized.includes("meetingcomplete")) {
      return { kind: "ignore", reason: `Ignored Read AI event: ${event}` };
    }
    const meeting = normalizeReadMeeting(source);
    if (!meeting) {
      return { kind: "ignore", reason: "Read AI meeting_end payload has no meeting id." };
    }
    if (!Array.isArray(meeting.transcript) || meeting.transcript.length === 0) {
      return { kind: "ignore", reason: "Read AI meeting_end payload has no transcript." };
    }
    return { kind: "meeting", meeting };
  },

  async validateCredentials() {
    // Read AI's public REST API uses short-lived OAuth 2.1 access tokens and
    // rotating refresh tokens. Taskwise intentionally does not treat those as
    // durable API keys. The generic connect route skips this method for the
    // webhook-only connection mode.
    return { ok: false, error: "Read AI is configured with a webhook signing key, not a static API key." };
  },
};
