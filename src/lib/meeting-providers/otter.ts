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

export const OTTER_API_BASE_URL =
  process.env.OTTER_API_BASE_URL || "https://api.otter.ai/v1";

const DEFAULT_LIMIT = 25;
const MAX_PAGES = 20;

const otterFetch = (apiKey: string, path: string) =>
  fetch(`${OTTER_API_BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
  });

const normalizeConversation = (body: any, requestedId: string): NormalizedProviderMeeting | null => {
  const source = body?.conversation && typeof body.conversation === "object"
    ? body.conversation
    : body?.data && typeof body.data === "object" && !Array.isArray(body.data)
      ? body.data
      : body;
  if (!source || typeof source !== "object") return null;
  const externalId = firstString(source.id, source.conversation_id, requestedId);
  if (!externalId) return null;
  const startTime =
    asDate(source.start_time) || asDate(source.startTime) || asDate(source.started_at);
  const endTime = asDate(source.end_time) || asDate(source.endTime) || asDate(source.ended_at);
  const owner = source.owner && typeof source.owner === "object" ? source.owner : null;
  const relationships =
    source.relationships && typeof source.relationships === "object"
      ? source.relationships
      : {};
  const summary = firstString(
    source.abstract_summary,
    source.summary,
    source.summary?.text,
    source.summary?.overview,
    source.ai_summary
  );
  const actionItems = normalizeActionItems(
    relationships.action_items || source.action_items || source.actionItems
  );
  const participants = normalizeParticipants(
    source.calendar_guests || source.participants || source.attendees || source.guests
  );
  const transcriptContent = firstString(
    relationships.transcript?.content,
    source.transcript?.content,
    typeof source.transcript === "string" ? source.transcript : null
  );
  const transcriptSegments = normalizeTranscriptSegments(
    source.transcript || source.utterances || source.speech_segments || source.sentences,
    startTime
  );
  const transcript = transcriptContent || transcriptSegments;

  return {
    externalId,
    title: firstString(source.title, source.name, source.subject),
    startTime,
    endTime,
    durationSeconds:
      typeof source.duration_seconds === "number" && Number.isFinite(source.duration_seconds)
        ? Math.round(source.duration_seconds)
        : durationBetween(startTime, endTime),
    recordingUrl: firstString(source.recording_url, source.audio_url, source.video_url),
    shareUrl: firstString(source.url, source.share_url, source.conversation_url, source.conf_join_url),
    organizerEmail:
      cleanEmail(owner?.email) || cleanEmail(source.owner_email) || cleanEmail(source.organizer_email),
    participants,
    transcript,
    summary,
    ...(actionItems.length ? { actionItems } : {}),
    raw: body,
  };
};

const hasTranscript = (meeting: NormalizedProviderMeeting) =>
  typeof meeting.transcript === "string"
    ? Boolean(meeting.transcript.trim())
    : Array.isArray(meeting.transcript) && meeting.transcript.length > 0;

export const otterMeetingProvider: MeetingProviderAdapter = {
  provider: "otter",
  displayName: "Otter.ai",
  capabilities: {
    connectionMode: "api-key",
    manualSync: true,
    // The current public Otter workspace-webhook docs describe destination
    // URLs/events but not an HMAC/shared-secret verification contract.
    supportsWebhookSecret: false,
  },

  verifyWebhookRequest(_rawBody, _headers, secret) {
    // Tenant routing is protected by Taskwise's random webhook token. Do not
    // invent a provider signature scheme that Otter does not document.
    return !secret;
  },

  parseWebhookPayload(payload: unknown): ParsedProviderWebhook {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return { kind: "ignore", reason: "Unrecognized Otter webhook payload." };
    }
    const source = payload as any;
    const rawEvent = firstString(
      source.event,
      source.event_type,
      source.type,
      source.meta?.webhook?.event
    );
    const normalizedEvent = rawEvent?.toLowerCase().replace(/[._\s-]+/g, "") || "";
    if (
      normalizedEvent &&
      !normalizedEvent.includes("conversationcompleted") &&
      !normalizedEvent.includes("conversationshared") &&
      !normalizedEvent.includes("conversationready")
    ) {
      return { kind: "ignore", reason: `Ignored Otter event: ${rawEvent}` };
    }

    const inline =
      source.conversation ||
      source.data?.conversation ||
      (source.data && typeof source.data === "object" ? source.data : null);
    if (inline && typeof inline === "object") {
      const normalized = normalizeConversation(inline, firstString(inline.id) || "");
      if (normalized && hasTranscript(normalized)) {
        return { kind: "meeting", meeting: normalized };
      }
    }

    const externalMeetingId = firstString(
      source.conversation_id,
      source.conversationId,
      source.data?.conversation_id,
      source.data?.conversationId,
      source.data?.id,
      source.id
    );
    return externalMeetingId
      ? { kind: "ref", externalMeetingId }
      : { kind: "ignore", reason: "Otter webhook payload has no conversation id." };
  },

  async fetchMeeting(connection: MeetingProviderConnection, externalMeetingId: string) {
    const apiKey = requireApiKey(connection, "Otter.ai");
    const id = cleanString(externalMeetingId);
    if (!id) return null;
    const response = await otterFetch(
      apiKey,
      `/conversations/${encodeURIComponent(id)}?include=all`
    );
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Otter conversation fetch failed with status ${response.status}.`);
    return normalizeConversation(await safeJson(response), id);
  },

  async listMeetings(connection: MeetingProviderConnection, opts: { since?: Date; limit?: number }) {
    const apiKey = requireApiKey(connection, "Otter.ai");
    const limit = Math.max(1, Math.floor(opts?.limit || DEFAULT_LIMIT));
    const ids: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < MAX_PAGES && ids.length < limit; page += 1) {
      const params = new URLSearchParams({ limit: String(Math.min(100, limit)) });
      if (cursor) params.set("cursor", cursor);
      const response = await otterFetch(apiKey, `/conversations?${params.toString()}`);
      if (!response.ok) throw new Error(`Otter conversations list failed with status ${response.status}.`);
      const body = await safeJson(response);
      const items = arrayFromEnvelope(body, ["conversations", "data", "items"]);
      let reachedSince = false;
      for (const item of items) {
        const createdAt = asDate((item as any)?.created_at);
        if (opts?.since && createdAt && createdAt.getTime() < opts.since.getTime()) {
          reachedSince = true;
          continue;
        }
        const id = firstString((item as any)?.id, (item as any)?.conversation_id);
        if (id && !ids.includes(id)) ids.push(id);
        if (ids.length >= limit) break;
      }
      cursor = firstString(
        body?.meta?.next_cursor,
        body?.next_cursor,
        body?.cursor?.next,
        body?.pagination?.next_cursor
      );
      if (!cursor || !items.length || reachedSince) break;
    }
    return ids.slice(0, limit);
  },

  async validateCredentials({ apiKey }) {
    const key = cleanString(apiKey);
    if (!key) return { ok: false, error: "Otter.ai API key is required." };
    try {
      const response = await otterFetch(key, "/workspace");
      if (response.status === 401 || response.status === 403) {
        return {
          ok: false,
          error: "Invalid Otter.ai API key or Public API access is unavailable for this Enterprise workspace.",
        };
      }
      if (!response.ok) return { ok: false, error: `Otter.ai API returned status ${response.status}.` };
      const body = await safeJson(response);
      return {
        ok: true,
        accountName: firstString(body?.name, body?.workspace?.name, body?.data?.name),
      };
    } catch (error) {
      return { ok: false, error: `Otter.ai request failed: ${error instanceof Error ? error.message : "network error"}` };
    }
  },
};
