import type {
  MeetingProviderAdapter,
  MeetingProviderConnection,
  NormalizedProviderMeeting,
  ParsedProviderWebhook,
} from "@/lib/meeting-providers/types";
import {
  arrayFromEnvelope,
  asDate,
  cleanEmail,
  cleanString,
  durationBetween,
  firstString,
  normalizeActionItems,
  normalizeParticipants,
  normalizeTranscriptSegments,
  requireApiKey,
  safeJson,
} from "@/lib/meeting-providers/provider-utils";

export const MEETGEEK_API_BASE_URL =
  process.env.MEETGEEK_API_BASE_URL || "https://api.meetgeek.ai/v1";

const DEFAULT_LIMIT = 25;
const MAX_LIST_PAGES = 20;
const MAX_TRANSCRIPT_PAGES = 50;

const meetgeekFetch = (apiKey: string, path: string) =>
  fetch(`${MEETGEEK_API_BASE_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
  });

const normalizeDetail = ({
  detail,
  transcript,
  requestedId,
}: {
  detail: any;
  transcript: unknown[];
  requestedId: string;
}): NormalizedProviderMeeting | null => {
  const source = detail?.data && typeof detail.data === "object" && !Array.isArray(detail.data)
    ? detail.data
    : detail?.meeting && typeof detail.meeting === "object"
      ? detail.meeting
      : detail;
  if (!source || typeof source !== "object") return null;
  const externalId = firstString(source.id, source.meeting_id, requestedId);
  if (!externalId) return null;
  const startTime = asDate(source.start_time) || asDate(source.startTime) || asDate(source.started_at);
  const endTime = asDate(source.end_time) || asDate(source.endTime) || asDate(source.ended_at);
  const host = source.host && typeof source.host === "object" ? source.host : null;
  const actionItems = normalizeActionItems(source.action_items || source.actionItems);
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
    shareUrl: firstString(source.share_url, source.report_url, source.url),
    organizerEmail:
      cleanEmail(host?.email) || cleanEmail(source.host_email) || cleanEmail(source.organizer_email),
    participants: normalizeParticipants(source.participants || source.attendees || source.guests),
    transcript: normalizeTranscriptSegments(transcript, startTime),
    summary: firstString(source.summary, source.summary?.text, source.summary?.overview, source.overview),
    ...(actionItems.length ? { actionItems } : {}),
    raw: { detail, transcript },
  };
};

export const meetgeekMeetingProvider: MeetingProviderAdapter = {
  provider: "meetgeek",
  displayName: "MeetGeek",
  capabilities: {
    connectionMode: "api-key",
    manualSync: true,
    supportsWebhookSecret: true,
  },

  verifyWebhookRequest(_rawBody, headers, secret) {
    if (!secret) return true;
    const provided = firstString(
      headers.get("x-meetgeek-signature"),
      headers.get("x-webhook-secret"),
      headers.get("authorization")
    );
    return provided === secret || provided === `Bearer ${secret}`;
  },

  parseWebhookPayload(payload: unknown): ParsedProviderWebhook {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return { kind: "ignore", reason: "Unrecognized MeetGeek webhook payload." };
    }
    const source = payload as any;
    const rawEvent = firstString(source.event, source.event_type, source.type);
    const normalized = rawEvent?.toLowerCase().replace(/[._\s-]+/g, "") || "";
    if (
      normalized &&
      !normalized.includes("meetingcompleted") &&
      !normalized.includes("meetingprocessed") &&
      !normalized.includes("transcriptready")
    ) {
      return { kind: "ignore", reason: `Ignored MeetGeek event: ${rawEvent}` };
    }
    const externalMeetingId = firstString(
      source.meeting_id,
      source.meetingId,
      source.data?.meeting_id,
      source.data?.meetingId,
      source.data?.id,
      source.id
    );
    return externalMeetingId
      ? { kind: "ref", externalMeetingId }
      : { kind: "ignore", reason: "MeetGeek webhook payload has no meeting id." };
  },

  async fetchMeeting(connection: MeetingProviderConnection, externalMeetingId: string) {
    const apiKey = requireApiKey(connection, "MeetGeek");
    const id = cleanString(externalMeetingId);
    if (!id) return null;
    const encoded = encodeURIComponent(id);
    const detailResponse = await meetgeekFetch(apiKey, `/meetings/${encoded}`);
    if (detailResponse.status === 404) return null;
    if (!detailResponse.ok) {
      throw new Error(`MeetGeek meeting fetch failed with status ${detailResponse.status}.`);
    }
    const detail = await safeJson(detailResponse);

    const transcript: unknown[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < MAX_TRANSCRIPT_PAGES; page += 1) {
      const params = new URLSearchParams();
      if (cursor) params.set("cursor", cursor);
      const query = params.toString();
      const transcriptResponse = await meetgeekFetch(
        apiKey,
        `/meetings/${encoded}/transcript${query ? `?${query}` : ""}`
      );
      if (!transcriptResponse.ok) break;
      const body = await safeJson(transcriptResponse);
      const items = arrayFromEnvelope(body, ["transcript", "segments", "data", "items"]);
      transcript.push(...items);
      cursor = firstString(body?.next_cursor, body?.pagination?.next_cursor, body?.cursor?.next);
      if (!cursor || !items.length) break;
    }

    return normalizeDetail({ detail, transcript, requestedId: id });
  },

  async listMeetings(connection: MeetingProviderConnection, opts: { since?: Date; limit?: number }) {
    const apiKey = requireApiKey(connection, "MeetGeek");
    const limit = Math.max(1, Math.floor(opts?.limit || DEFAULT_LIMIT));
    const ids: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < MAX_LIST_PAGES && ids.length < limit; page += 1) {
      const params = new URLSearchParams({ limit: String(Math.min(100, limit)) });
      if (cursor) params.set("cursor", cursor);
      if (opts?.since) params.set("start_time_gte", opts.since.toISOString());
      const response = await meetgeekFetch(apiKey, `/meetings?${params.toString()}`);
      if (!response.ok) throw new Error(`MeetGeek meetings list failed with status ${response.status}.`);
      const body = await safeJson(response);
      const items = arrayFromEnvelope(body, ["meetings", "data", "items"]);
      for (const item of items) {
        const id = firstString((item as any)?.id, (item as any)?.meeting_id);
        if (id && !ids.includes(id)) ids.push(id);
        if (ids.length >= limit) break;
      }
      cursor = firstString(body?.next_cursor, body?.pagination?.next_cursor, body?.cursor?.next);
      if (!cursor || !items.length) break;
    }
    return ids.slice(0, limit);
  },

  async validateCredentials({ apiKey }) {
    const key = cleanString(apiKey);
    if (!key) return { ok: false, error: "MeetGeek API key is required." };
    try {
      const response = await meetgeekFetch(key, "/meetings?limit=1");
      if (response.status === 401 || response.status === 403) {
        return { ok: false, error: "Invalid MeetGeek API key. Check that the key matches the API region." };
      }
      if (!response.ok) return { ok: false, error: `MeetGeek API returned status ${response.status}.` };
      return { ok: true };
    } catch (error) {
      return { ok: false, error: `MeetGeek request failed: ${error instanceof Error ? error.message : "network error"}` };
    }
  },
};
