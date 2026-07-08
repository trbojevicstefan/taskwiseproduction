/**
 * Grain meeting-provider adapter (Phase 7).
 *
 * Helpers live in grain-api.ts (HTTP + schemas + detail normalization) and
 * grain-transcript.ts (coercion + JSON/VTT transcript parsing).
 *
 * External-API assumptions (no live calls exist in tests — everything below
 * is marked VERIFY-ON-FIRST-LIVE-RUN):
 *
 * - Base URL: `https://api.grain.com/_/public-api` (overridable via
 *   `GRAIN_API_BASE_URL` for testing/proxying). VERIFY-ON-FIRST-LIVE-RUN.
 * - Auth: `Authorization: Bearer <PAT or workspace token>` on every request.
 *   VERIFY-ON-FIRST-LIVE-RUN.
 * - `GET /me` -> identity of the token owner (`{ name?, email? }`); used by
 *   `validateCredentials` as the cheapest auth probe. VERIFY-ON-FIRST-LIVE-RUN.
 * - `GET /recordings` -> `{ recordings: [{ id, title, start_datetime, ... }],
 *   cursor }`, newest first, paginated via `?cursor=<cursor>`. No server-side
 *   `since` filter is assumed, so `opts.since` is applied client-side against
 *   `start_datetime` (pagination stops at the first item older than `since`).
 *   VERIFY-ON-FIRST-LIVE-RUN.
 * - `GET /recordings/{id}?transcript_format=json&include_highlights=true&include_participants=true`
 *   -> recording detail. Transcript preference order: inline JSON segments
 *   (`transcript_json` as an array or `{ segments: [...] }`), inline
 *   `transcript`, inline VTT (`transcript_vtt`), then `transcript_url`
 *   (fetched; JSON parsed as segments, anything else parsed as VTT/plain
 *   text). Segment `timestamp` is assumed MILLISECONDS (Grain highlight
 *   timestamps are ms); `start`/`start_time`/`offset` are assumed seconds.
 *   VERIFY-ON-FIRST-LIVE-RUN.
 * - `Authorization` is only sent to `transcript_url` when it lives on the
 *   same origin as the API base (signed CDN URLs must not receive the token).
 * - Webhooks (Grain "hooks"): Grain POSTs JSON like
 *   `{ type: "recording_added" | "recording_updated" | ..., data: { id } }`.
 *   Hooks are registered with a shared secret echoed verbatim in the
 *   `grain-hook-secret` request header; verification is a timing-safe exact
 *   match against the stored webhookSecret. When NO secret is stored the
 *   request is accepted (fathom precedent, pinned by the webhook route
 *   tests). VERIFY-ON-FIRST-LIVE-RUN.
 *
 * All external payloads are parsed defensively (zod `.safeParse` + lenient
 * coercion); unexpected shapes yield `{ kind: "ignore" }` / `null` / empty
 * values instead of throwing.
 */

import crypto from "crypto";
import {
  grainApiFetch,
  grainListItemSchema,
  grainMeSchema,
  grainRecordingDetailSchema,
  grainRecordingsListSchema,
  grainWebhookPayloadSchema,
  normalizeGrainParticipants,
  resolveGrainActionItems,
  resolveGrainDurationSeconds,
  resolveGrainOrganizerEmail,
  resolveGrainSummary,
  resolveGrainTranscript,
} from "@/lib/meeting-providers/grain-api";
import {
  asDate,
  asLowerEmail,
  asTrimmedString,
} from "@/lib/meeting-providers/grain-transcript";
import type {
  MeetingProviderAdapter,
  MeetingProviderConnection,
  NormalizedProviderMeeting,
  ParsedProviderWebhook,
} from "@/lib/meeting-providers/types";

export const GRAIN_WEBHOOK_SECRET_HEADER = "grain-hook-secret";

/** Grain hook event types that reference an ingestable recording. */
const RELEVANT_RECORDING_EVENTS = new Set([
  "recording_added",
  "recording_updated",
  "recording_ready",
  "recording_processed",
  "recording_created",
]);

const MAX_LIST_PAGES = 20;
const DEFAULT_LIST_LIMIT = 25;

const timingSafeStringEqual = (a: string, b: string) => {
  // Hash both sides so buffer lengths match; equality remains exact-match.
  const digestA = crypto.createHash("sha256").update(a, "utf8").digest();
  const digestB = crypto.createHash("sha256").update(b, "utf8").digest();
  return crypto.timingSafeEqual(digestA, digestB);
};

const requireApiKey = (connection: MeetingProviderConnection): string | null =>
  typeof connection?.apiKey === "string" && connection.apiKey.trim()
    ? connection.apiKey.trim()
    : null;

export const grainMeetingProvider: MeetingProviderAdapter = {
  provider: "grain",
  displayName: "Grain",

  verifyWebhookRequest(
    _rawBody: string,
    headers: Headers,
    secret: string | null
  ): boolean {
    // Fathom precedent (pinned): no stored secret => accept.
    if (!secret) return true;
    const provided = headers?.get?.(GRAIN_WEBHOOK_SECRET_HEADER);
    if (typeof provided !== "string" || !provided) return false;
    return timingSafeStringEqual(provided, secret);
  },

  parseWebhookPayload(payload: unknown): ParsedProviderWebhook {
    const parsed = grainWebhookPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      return { kind: "ignore", reason: "Unrecognized Grain webhook payload." };
    }
    const rawType =
      asTrimmedString(parsed.data.type) || asTrimmedString(parsed.data.event);
    if (!rawType) {
      return { kind: "ignore", reason: "Grain webhook payload has no event type." };
    }
    const eventType = rawType.toLowerCase().replace(/[.\s-]+/g, "_");
    if (!RELEVANT_RECORDING_EVENTS.has(eventType)) {
      return { kind: "ignore", reason: `Ignored Grain event type "${rawType}".` };
    }
    const externalMeetingId =
      asTrimmedString(parsed.data.data?.recording_id) ||
      asTrimmedString(parsed.data.data?.id) ||
      asTrimmedString(parsed.data.id);
    if (!externalMeetingId) {
      return { kind: "ignore", reason: "Grain recording event has no recording id." };
    }
    return { kind: "ref", externalMeetingId };
  },

  async fetchMeeting(
    connection: MeetingProviderConnection,
    externalMeetingId: string
  ): Promise<NormalizedProviderMeeting | null> {
    const apiKey = requireApiKey(connection);
    const recordingId = asTrimmedString(externalMeetingId);
    if (!apiKey || !recordingId) return null;

    let response: Response;
    try {
      response = await grainApiFetch(
        apiKey,
        `/recordings/${encodeURIComponent(recordingId)}?transcript_format=json&include_highlights=true&include_participants=true`
      );
    } catch {
      return null;
    }
    if (!response.ok) return null;

    const body = await response.json().catch(() => null);
    const parsed = grainRecordingDetailSchema.safeParse(body);
    if (!parsed.success) return null;
    const detail = parsed.data;

    const startTime = asDate(detail.start_datetime);
    const endTime = asDate(detail.end_datetime);
    const shareUrl = asTrimmedString(detail.url);
    const transcript = await resolveGrainTranscript(apiKey, detail);
    const actionItems = resolveGrainActionItems(detail);

    return {
      externalId: asTrimmedString(detail.id) || recordingId,
      title: asTrimmedString(detail.title),
      startTime,
      endTime,
      durationSeconds: resolveGrainDurationSeconds(startTime, endTime, detail),
      recordingUrl: asTrimmedString(detail.media_url) || shareUrl,
      shareUrl,
      organizerEmail: resolveGrainOrganizerEmail(detail),
      participants: normalizeGrainParticipants(detail.participants, detail.attendees),
      transcript,
      summary: resolveGrainSummary(detail),
      ...(actionItems.length ? { actionItems } : {}),
      raw: body,
    };
  },

  async listMeetings(
    connection: MeetingProviderConnection,
    opts: { since?: Date; limit?: number }
  ): Promise<string[]> {
    const apiKey = requireApiKey(connection);
    if (!apiKey) return [];

    const limit = Math.max(1, Math.floor(opts?.limit ?? DEFAULT_LIST_LIMIT));
    const since =
      opts?.since instanceof Date && !Number.isNaN(opts.since.getTime())
        ? opts.since
        : null;

    const ids: string[] = [];
    let cursor: string | null = null;

    for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
      const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
      const response = await grainApiFetch(apiKey, `/recordings${query}`);
      if (!response.ok) {
        throw new Error(`Grain recordings list failed with status ${response.status}.`);
      }
      const body = await response.json().catch(() => null);
      const parsed = grainRecordingsListSchema.safeParse(body);
      const items = parsed.success
        ? parsed.data.recordings || parsed.data.data || []
        : Array.isArray(body)
          ? body
          : [];

      let sawOlderThanSince = false;
      for (const entry of items) {
        const item = grainListItemSchema.safeParse(entry);
        if (!item.success) continue;
        const id = asTrimmedString(item.data.id);
        if (!id) continue;
        const startedAt =
          asDate(item.data.start_datetime) || asDate(item.data.started_at);
        if (since && startedAt && startedAt.getTime() < since.getTime()) {
          // List is newest-first: everything past this point is older.
          sawOlderThanSince = true;
          continue;
        }
        if (!ids.includes(id)) ids.push(id);
        if (ids.length >= limit) break;
      }

      cursor = parsed.success ? asTrimmedString(parsed.data.cursor) : null;
      if (ids.length >= limit || sawOlderThanSince || !cursor || !items.length) break;
    }

    return ids.slice(0, limit);
  },

  async validateCredentials(credentials: {
    apiKey: string;
  }): Promise<{ ok: boolean; accountName?: string | null; error?: string }> {
    const apiKey = asTrimmedString(credentials?.apiKey);
    if (!apiKey) {
      return { ok: false, error: "Grain API token is required." };
    }
    try {
      const response = await grainApiFetch(apiKey, "/me");
      if (response.status === 401 || response.status === 403) {
        return { ok: false, error: "Invalid Grain API token." };
      }
      if (!response.ok) {
        return { ok: false, error: `Grain API returned status ${response.status}.` };
      }
      const body = await response.json().catch(() => null);
      const parsed = grainMeSchema.safeParse(body);
      const accountName = parsed.success
        ? asTrimmedString(parsed.data.name) || asLowerEmail(parsed.data.email)
        : null;
      return { ok: true, accountName };
    } catch (error) {
      return {
        ok: false,
        error: `Could not reach the Grain API: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  },
};
