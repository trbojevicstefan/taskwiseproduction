/**
 * Grain adapter helpers — HTTP access, defensive zod payload schemas, and
 * recording-detail normalization. Split out of grain.ts to keep the adapter
 * file under the ~400-line house limit. See grain.ts for the full list of
 * VERIFY-ON-FIRST-LIVE-RUN external-API assumptions.
 */

import { z } from "zod";
import {
  asFiniteNumber,
  asLowerEmail,
  asTrimmedString,
  looksLikeVtt,
  mapJsonSegments,
  parseVttTranscript,
} from "@/lib/meeting-providers/grain-transcript";
import type {
  NormalizedProviderParticipant,
  NormalizedTranscriptSegment,
} from "@/lib/meeting-providers/types";

export const GRAIN_API_BASE_URL = (
  process.env.GRAIN_API_BASE_URL || "https://api.grain.com/_/public-api"
).replace(/\/+$/, "");

// ---------------------------------------------------------------------------
// Zod schemas (all passthrough + optional so odd payloads degrade, not throw)
// ---------------------------------------------------------------------------

const idSchema = z.union([z.string(), z.number()]);

export const grainWebhookPayloadSchema = z
  .object({
    type: z.string().optional(),
    event: z.string().optional(),
    id: idSchema.optional(),
    data: z
      .object({
        id: idSchema.optional(),
        recording_id: idSchema.optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const grainMeSchema = z
  .object({
    name: z.string().optional().nullable(),
    email: z.string().optional().nullable(),
  })
  .passthrough();

export const grainRecordingsListSchema = z
  .object({
    recordings: z.array(z.unknown()).optional(),
    data: z.array(z.unknown()).optional(),
    cursor: z.string().optional().nullable(),
  })
  .passthrough();

export const grainListItemSchema = z
  .object({
    id: idSchema.optional(),
    start_datetime: z.unknown().optional(),
    started_at: z.unknown().optional(),
  })
  .passthrough();

const participantSchema = z
  .object({
    name: z.unknown().optional(),
    email: z.unknown().optional(),
    title: z.unknown().optional(),
  })
  .passthrough();

const highlightSchema = z
  .object({
    text: z.unknown().optional(),
    transcript: z.unknown().optional(),
  })
  .passthrough();

export const grainRecordingDetailSchema = z
  .object({
    id: idSchema.optional(),
    title: z.unknown().optional(),
    url: z.unknown().optional(),
    media_url: z.unknown().optional(),
    start_datetime: z.unknown().optional(),
    end_datetime: z.unknown().optional(),
    duration_seconds: z.unknown().optional(),
    owners: z.array(z.unknown()).optional(),
    owner_email: z.unknown().optional(),
    participants: z.array(z.unknown()).optional(),
    attendees: z.array(z.unknown()).optional(),
    highlights: z.array(z.unknown()).optional(),
    summary: z.unknown().optional(),
    intelligence_notes: z.unknown().optional(),
    action_items: z.array(z.unknown()).optional(),
    transcript_json: z.unknown().optional(),
    transcript_vtt: z.unknown().optional(),
    transcript: z.unknown().optional(),
    transcript_url: z.unknown().optional(),
  })
  .passthrough();

export type GrainRecordingDetail = z.infer<typeof grainRecordingDetailSchema>;

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

export const grainApiFetch = (apiKey: string, pathWithQuery: string) =>
  fetch(`${GRAIN_API_BASE_URL}${pathWithQuery}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
  });

const isSameOriginAsApi = (url: string) => {
  try {
    return new URL(url).origin === new URL(GRAIN_API_BASE_URL).origin;
  } catch {
    return false;
  }
};

const fetchTranscriptFromUrl = async (
  apiKey: string,
  transcriptUrl: string
): Promise<NormalizedTranscriptSegment[] | string> => {
  try {
    // The Bearer token is only sent when the transcript URL lives on the API
    // origin — signed CDN URLs must not receive it.
    const response = await fetch(transcriptUrl, {
      headers: isSameOriginAsApi(transcriptUrl)
        ? { Authorization: `Bearer ${apiKey}` }
        : undefined,
    });
    if (!response.ok) return "";
    const contentType = String(response.headers?.get?.("content-type") || "");
    if (contentType.includes("json")) {
      const body = await response.json().catch(() => null);
      return mapJsonSegments(body);
    }
    const text = await response.text().catch(() => "");
    if (!text.trim()) return "";
    return looksLikeVtt(text) ? parseVttTranscript(text) : text.trim();
  } catch {
    return "";
  }
};

// ---------------------------------------------------------------------------
// Recording-detail normalization
// ---------------------------------------------------------------------------

/**
 * Transcript preference order (VERIFY-ON-FIRST-LIVE-RUN): inline JSON
 * segments (`transcript_json`), inline `transcript` (segments, VTT, or plain
 * text), inline VTT (`transcript_vtt`), then `transcript_url` fetch. Empty
 * string when nothing usable exists (pipeline => `no_transcript`).
 */
export const resolveGrainTranscript = async (
  apiKey: string,
  detail: GrainRecordingDetail
): Promise<NormalizedTranscriptSegment[] | string> => {
  const jsonSegments = mapJsonSegments(detail.transcript_json);
  if (jsonSegments.length) return jsonSegments;

  if (Array.isArray(detail.transcript)) {
    const segments = mapJsonSegments(detail.transcript);
    if (segments.length) return segments;
  } else if (typeof detail.transcript === "string" && detail.transcript.trim()) {
    return looksLikeVtt(detail.transcript)
      ? parseVttTranscript(detail.transcript)
      : detail.transcript.trim();
  }

  const vtt = asTrimmedString(detail.transcript_vtt);
  if (vtt) return parseVttTranscript(vtt);

  const transcriptUrl = asTrimmedString(detail.transcript_url);
  if (transcriptUrl) return fetchTranscriptFromUrl(apiKey, transcriptUrl);

  return "";
};

/** Dedupe by lowercased email (or name); name falls back to the email local part. */
export const normalizeGrainParticipants = (
  ...lists: (unknown[] | undefined)[]
): NormalizedProviderParticipant[] => {
  const seen = new Set<string>();
  const participants: NormalizedProviderParticipant[] = [];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      let name: string | null = null;
      let email: string | null = null;
      let title: string | null = null;
      if (typeof entry === "string") {
        email = asLowerEmail(entry);
        name = email ? email.split("@")[0] : asTrimmedString(entry);
      } else {
        const parsed = participantSchema.safeParse(entry);
        if (!parsed.success) continue;
        email = asLowerEmail(parsed.data.email);
        name =
          asTrimmedString(parsed.data.name) ||
          (email ? email.split("@")[0] : null);
        title = asTrimmedString(parsed.data.title);
      }
      if (!name) continue;
      const key = email || name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      participants.push({ name, email, title });
    }
  }
  return participants;
};

/** Organizer email from `owner_email` or the first email-bearing `owners` entry. */
export const resolveGrainOrganizerEmail = (detail: GrainRecordingDetail) => {
  const direct = asLowerEmail(detail.owner_email);
  if (direct) return direct;
  for (const owner of detail.owners || []) {
    if (typeof owner === "string") {
      const email = asLowerEmail(owner);
      if (email) return email;
    } else if (owner && typeof owner === "object") {
      const email = asLowerEmail((owner as Record<string, unknown>).email);
      if (email) return email;
    }
  }
  return null;
};

/** Summary text, falling back to a bullet list built from highlights. */
export const resolveGrainSummary = (detail: GrainRecordingDetail) => {
  const summary =
    asTrimmedString(detail.summary) || asTrimmedString(detail.intelligence_notes);
  if (summary) return summary;
  const highlightTexts = (detail.highlights || [])
    .map((entry) => {
      const parsed = highlightSchema.safeParse(entry);
      if (!parsed.success) return null;
      return asTrimmedString(parsed.data.text) || asTrimmedString(parsed.data.transcript);
    })
    .filter((text): text is string => Boolean(text));
  return highlightTexts.length
    ? `Highlights:\n${highlightTexts.map((text) => `- ${text}`).join("\n")}`
    : null;
};

/** Action items as plain strings (string entries or `{ text }` objects). */
export const resolveGrainActionItems = (detail: GrainRecordingDetail) => {
  const items: string[] = [];
  for (const entry of detail.action_items || []) {
    const text =
      asTrimmedString(entry) ||
      (entry && typeof entry === "object"
        ? asTrimmedString((entry as Record<string, unknown>).text)
        : null);
    if (text) items.push(text);
  }
  return items;
};

/** Duration from the datetime pair; `duration_seconds` only as a fallback. */
export const resolveGrainDurationSeconds = (
  startTime: Date | null,
  endTime: Date | null,
  detail: GrainRecordingDetail
): number | null =>
  startTime && endTime && endTime.getTime() > startTime.getTime()
    ? Math.round((endTime.getTime() - startTime.getTime()) / 1000)
    : asFiniteNumber(detail.duration_seconds);
