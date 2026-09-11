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
  normalizeParticipants,
  normalizeTranscriptSegments,
  requireApiKey,
  safeJson,
} from "@/lib/meeting-providers/provider-utils";

export const TLDV_API_BASE_URL =
  process.env.TLDV_API_BASE_URL || "https://pasta.tldv.io/v1alpha1";

const MAX_PAGES = 20;
const DEFAULT_LIMIT = 25;

const tldvFetch = (apiKey: string, path: string) =>
  fetch(`${TLDV_API_BASE_URL}${path}`, {
    headers: {
      "x-api-key": apiKey,
      Accept: "application/json",
    },
  });

const extractMeetingId = (payload: any) =>
  firstString(
    payload?.meetingId,
    payload?.meeting_id,
    payload?.meeting?.id,
    payload?.data?.meetingId,
    payload?.data?.meeting_id,
    payload?.data?.meeting?.id,
    payload?.data?.id,
    payload?.id
  );

const eventName = (payload: any) =>
  firstString(payload?.event, payload?.eventType, payload?.type, payload?.data?.event);

const deriveEndTime = (
  explicitEnd: Date | null,
  startTime: Date | null,
  durationSeconds: number | null
) => {
  if (explicitEnd) return explicitEnd;
  if (!startTime || durationSeconds === null) return null;
  return new Date(startTime.getTime() + durationSeconds * 1000);
};

const normalizeTldvMeeting = ({
  detail,
  transcript,
  notes,
  requestedId,
}: {
  detail: any;
  transcript: any;
  notes: any;
  requestedId: string;
}): NormalizedProviderMeeting | null => {
  const source = detail?.data && typeof detail.data === "object" ? detail.data : detail;
  if (!source || typeof source !== "object") return null;
  const externalId = firstString(source.id, source.meetingId, requestedId);
  if (!externalId) return null;

  const startTime =
    asDate(source.happenedAt) ||
    asDate(source.startedAt) ||
    asDate(source.startTime) ||
    asDate(source.start_time);
  const explicitEnd =
    asDate(source.endedAt) || asDate(source.endTime) || asDate(source.end_time);
  const rawDuration = source.durationSeconds ?? source.duration;
  const durationSeconds =
    typeof rawDuration === "number" && Number.isFinite(rawDuration) && rawDuration >= 0
      ? Math.round(rawDuration)
      : durationBetween(startTime, explicitEnd);
  const endTime = deriveEndTime(explicitEnd, startTime, durationSeconds);
  const organizer =
    source.organizer && typeof source.organizer === "object" ? source.organizer : null;

  const structuredNotes = arrayFromEnvelope(notes, ["structuredNotes", "data", "notes", "items"]);
  const topics = arrayFromEnvelope(notes, ["topics"]);
  const noteFallback = structuredNotes
    .map((item: any) => firstString(item?.text, item?.content, item?.note))
    .filter(Boolean)
    .join("\n");
  const topicFallback = topics
    .map((item: any) => {
      const title = firstString(item?.title);
      const summary = firstString(item?.summary);
      return title && summary ? `${title}: ${summary}` : summary || title;
    })
    .filter(Boolean)
    .join("\n");
  const summary =
    firstString(
      source.summary,
      notes?.markdownContent,
      notes?.summary,
      notes?.data?.summary,
      topicFallback,
      noteFallback
    ) || null;

  return {
    externalId,
    title: firstString(source.name, source.title),
    startTime,
    endTime,
    durationSeconds,
    recordingUrl: firstString(
      source.recordingUrl,
      source.recording_url,
      source.videoUrl,
      source.video_url
    ),
    shareUrl: firstString(source.url, source.shareUrl, source.share_url),
    organizerEmail: cleanEmail(organizer?.email) || cleanEmail(source.organizerEmail),
    participants: normalizeParticipants(
      source.invitees || source.participants || source.attendees
    ),
    transcript: normalizeTranscriptSegments(transcript, startTime),
    summary,
    raw: { detail, transcript, notes },
  };
};

export const tldvMeetingProvider: MeetingProviderAdapter = {
  provider: "tldv",
  displayName: "tl;dv",
  capabilities: {
    connectionMode: "api-key",
    manualSync: true,
    supportsWebhookSecret: false,
  },

  verifyWebhookRequest(_rawBody, _headers, secret) {
    // tl;dv's current public webhook docs do not define a signature header.
    // The random Taskwise webhook routing token remains mandatory per connection.
    return !secret;
  },

  parseWebhookPayload(payload: unknown): ParsedProviderWebhook {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return { kind: "ignore", reason: "Unrecognized tl;dv webhook payload." };
    }
    const rawEvent = eventName(payload as any);
    const normalizedEvent = rawEvent?.toLowerCase().replace(/[._\s-]+/g, "") || "";
    if (
      !normalizedEvent.includes("meetingready") &&
      !normalizedEvent.includes("transcriptready")
    ) {
      return {
        kind: "ignore",
        reason: `Ignored tl;dv event${rawEvent ? `: ${rawEvent}` : "."}`,
      };
    }
    const externalMeetingId = extractMeetingId(payload as any);
    return externalMeetingId
      ? { kind: "ref", externalMeetingId }
      : { kind: "ignore", reason: "tl;dv webhook payload has no meeting id." };
  },

  async fetchMeeting(connection: MeetingProviderConnection, externalMeetingId: string) {
    const apiKey = requireApiKey(connection, "tl;dv");
    const id = cleanString(externalMeetingId);
    if (!id) return null;
    const encoded = encodeURIComponent(id);
    const detailResponse = await tldvFetch(apiKey, `/meetings/${encoded}`);
    if (detailResponse.status === 404) return null;
    if (!detailResponse.ok) {
      throw new Error(`tl;dv meeting fetch failed with status ${detailResponse.status}.`);
    }
    const detail = await safeJson(detailResponse);

    const [transcriptResponse, notesResponse] = await Promise.all([
      tldvFetch(apiKey, `/meetings/${encoded}/transcript`),
      tldvFetch(apiKey, `/meetings/${encoded}/notes`),
    ]);
    const transcript = transcriptResponse.ok ? await safeJson(transcriptResponse) : [];
    const notes = notesResponse.ok ? await safeJson(notesResponse) : null;
    return normalizeTldvMeeting({ detail, transcript, notes, requestedId: id });
  },

  async listMeetings(connection: MeetingProviderConnection, opts: { since?: Date; limit?: number }) {
    const apiKey = requireApiKey(connection, "tl;dv");
    const limit = Math.max(1, Math.floor(opts?.limit || DEFAULT_LIMIT));
    const ids: string[] = [];

    for (let page = 0; page < MAX_PAGES && ids.length < limit; page += 1) {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(Math.min(100, limit)),
      });
      const response = await tldvFetch(apiKey, `/meetings?${params.toString()}`);
      if (!response.ok) {
        throw new Error(`tl;dv meetings list failed with status ${response.status}.`);
      }
      const body = await safeJson(response);
      const items = arrayFromEnvelope(body, ["results", "data", "meetings", "items"]);
      let reachedSince = false;
      for (const item of items) {
        const id = firstString((item as any)?.id, (item as any)?.meetingId);
        if (!id) continue;
        const started =
          asDate((item as any)?.happenedAt) ||
          asDate((item as any)?.startedAt) ||
          asDate((item as any)?.startTime);
        if (opts?.since && started && started.getTime() < opts.since.getTime()) {
          reachedSince = true;
          continue;
        }
        if (!ids.includes(id)) ids.push(id);
        if (ids.length >= limit) break;
      }

      const currentPage =
        typeof body?.page === "number" && Number.isFinite(body.page) ? body.page : page;
      const pages =
        typeof body?.pages === "number" && Number.isFinite(body.pages) ? body.pages : null;
      const hasNextPage = pages === null ? items.length > 0 : currentPage + 1 < pages;
      if (!hasNextPage || !items.length || reachedSince) break;
    }
    return ids.slice(0, limit);
  },

  async validateCredentials({ apiKey }) {
    const key = cleanString(apiKey);
    if (!key) return { ok: false, error: "tl;dv API key is required." };
    try {
      const response = await tldvFetch(key, "/meetings?page=0&pageSize=1");
      if (response.status === 401 || response.status === 403) {
        return { ok: false, error: "Invalid tl;dv API key." };
      }
      if (!response.ok) {
        return { ok: false, error: `tl;dv API returned status ${response.status}.` };
      }
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: `tl;dv request failed: ${error instanceof Error ? error.message : "network error"}`,
      };
    }
  },
};
