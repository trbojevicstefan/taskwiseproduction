/**
 * Fireflies.ai meeting provider adapter (Phase 7).
 *
 * Turns Fireflies webhooks + GraphQL API responses into
 * `NormalizedProviderMeeting` for the shared ingest pipeline
 * (src/lib/meeting-providers/ingest-pipeline.ts). No LLM calls here; task
 * extraction happens downstream via the shared pipeline.
 *
 * External API assumptions — VERIFY-ON-FIRST-LIVE-RUN:
 * - Endpoint: `POST https://api.fireflies.ai/graphql` with headers
 *   `Authorization: Bearer <apiKey>` and `Content-Type: application/json`.
 * - Credential check: `query { user { name email } }` — with no id argument
 *   the `user` query returns the owner of the API key.
 * - `transcript(id: $id)` fields used: `id`, `title`, `date` (epoch
 *   milliseconds, Float), `duration` (MINUTES, Float — converted to seconds
 *   here), `transcript_url` (Fireflies share link -> shareUrl), `audio_url` /
 *   `video_url` (-> recordingUrl, video preferred), `host_email` /
 *   `organizer_email`, `participants` ([String] of emails),
 *   `meeting_attendees { displayName email name }`,
 *   `sentences { speaker_name text start_time }` (start_time in seconds),
 *   `summary { overview action_items keywords }`.
 * - `summary.action_items` is a newline-separated string in the current API
 *   (older accounts returned a string array) — both shapes are handled;
 *   markdown bullet prefixes and `**Speaker**` heading-only lines are
 *   stripped.
 * - Listing: `transcripts(limit: $limit, fromDate: $fromDate) { id }`,
 *   `limit` max 50, `fromDate` ISO 8601 DateTime, results newest first.
 * - GraphQL errors surface in `body.errors[]` with
 *   `extensions.code === "object_not_found"` for missing transcripts.
 * - Webhooks: JSON body such as
 *   `{ meetingId, eventType: "Transcription completed", clientReferenceId? }`
 *   (v1) or `{ meeting_id, event: "transcription.completed" }` (Webhooks V2).
 *   Signed with HMAC-SHA256 of the RAW body, hex digest in the
 *   `x-hub-signature` header formatted `sha256=<hex>`; compared timing-safe.
 *   Per the pinned fathom precedent, requests are accepted when NO webhook
 *   secret is stored on the connection.
 */

import { createHmac, timingSafeEqual } from "crypto";
import { z } from "zod";
import type {
  MeetingProviderAdapter,
  MeetingProviderConnection,
  NormalizedProviderMeeting,
  NormalizedProviderParticipant,
  NormalizedTranscriptSegment,
  ParsedProviderWebhook,
} from "@/lib/meeting-providers/types";

export const FIREFLIES_GRAPHQL_ENDPOINT = "https://api.fireflies.ai/graphql";

/** Fireflies caps `transcripts(limit:)` at 50 per query. VERIFY-ON-FIRST-LIVE-RUN. */
const FIREFLIES_LIST_LIMIT_MAX = 50;
const FIREFLIES_LIST_LIMIT_DEFAULT = 25;

// ---------------------------------------------------------------------------
// Lenient zod shapes (never throw on odd payloads — fall back to undefined)
// ---------------------------------------------------------------------------

const lenientString = z.string().optional().catch(undefined);
const lenientNumber = z.number().optional().catch(undefined);

const firefliesWebhookSchema = z
  .object({
    meetingId: lenientString,
    meeting_id: lenientString,
    transcriptId: lenientString,
    transcript_id: lenientString,
    eventType: lenientString,
    event: lenientString,
  })
  .passthrough();

const firefliesUserSchema = z
  .object({
    name: lenientString,
    email: lenientString,
  })
  .passthrough();

const firefliesSentenceSchema = z
  .object({
    speaker_name: z.string().nullish().catch(undefined),
    text: z.string().nullish().catch(undefined),
    start_time: z.number().nullish().catch(undefined),
  })
  .passthrough();

const firefliesAttendeeSchema = z
  .object({
    displayName: z.string().nullish().catch(undefined),
    email: z.string().nullish().catch(undefined),
    name: z.string().nullish().catch(undefined),
  })
  .passthrough();

const firefliesSummarySchema = z
  .object({
    overview: z.string().nullish().catch(undefined),
    action_items: z.unknown().optional(),
  })
  .passthrough();

const firefliesTranscriptSchema = z
  .object({
    id: lenientString,
    title: z.string().nullish().catch(undefined),
    date: lenientNumber,
    duration: lenientNumber,
    transcript_url: z.string().nullish().catch(undefined),
    audio_url: z.string().nullish().catch(undefined),
    video_url: z.string().nullish().catch(undefined),
    host_email: z.string().nullish().catch(undefined),
    organizer_email: z.string().nullish().catch(undefined),
    participants: z.array(z.unknown()).nullish().catch(undefined),
    meeting_attendees: z.array(z.unknown()).nullish().catch(undefined),
    sentences: z.array(z.unknown()).nullish().catch(undefined),
    summary: z.unknown().optional(),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// GraphQL transport
// ---------------------------------------------------------------------------

type FirefliesGraphqlResult =
  | { ok: true; data: any }
  | { ok: false; status: number | null; code: string | null; error: string };

const firefliesGraphqlRequest = async (
  apiKey: string,
  query: string,
  variables: Record<string, unknown>
): Promise<FirefliesGraphqlResult> => {
  let response: Response;
  try {
    response = await fetch(FIREFLIES_GRAPHQL_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });
  } catch (error) {
    return {
      ok: false,
      status: null,
      code: null,
      error: `Fireflies request failed: ${
        error instanceof Error ? error.message : "network error"
      }`,
    };
  }

  let body: any = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  const firstError = Array.isArray(body?.errors) ? body.errors[0] : null;
  const errorCode =
    typeof firstError?.extensions?.code === "string"
      ? firstError.extensions.code
      : null;
  const errorMessage =
    typeof firstError?.message === "string" && firstError.message.trim()
      ? firstError.message.trim()
      : null;

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      code: errorCode,
      error: errorMessage || `Fireflies API returned HTTP ${response.status}.`,
    };
  }
  if (firstError) {
    return {
      ok: false,
      status: response.status,
      code: errorCode,
      error: errorMessage || "Fireflies API error.",
    };
  }
  return { ok: true, data: body?.data ?? null };
};

const isNotFoundResult = (result: Extract<FirefliesGraphqlResult, { ok: false }>) =>
  result.status === 404 ||
  result.code === "object_not_found" ||
  /not found/i.test(result.error);

const requireConnectionApiKey = (connection: MeetingProviderConnection): string => {
  const apiKey = String(connection?.apiKey || "").trim();
  if (!apiKey) {
    throw new Error("Fireflies connection is missing an API key.");
  }
  return apiKey;
};

// ---------------------------------------------------------------------------
// Normalization helpers
// ---------------------------------------------------------------------------

const cleanString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
};

const cleanEmail = (value: unknown): string | null => {
  const email = cleanString(value);
  return email && email.includes("@") ? email.toLowerCase() : null;
};

const nameFromEmail = (email: string): string => {
  const localPart = email.split("@")[0] || email;
  return localPart.replace(/[._-]+/g, " ").trim() || email;
};

/** Dedupe by email first, then by lowercased name; keep the richest entry. */
const normalizeParticipants = (
  attendees: unknown[] | null | undefined,
  participantEmails: unknown[] | null | undefined
): NormalizedProviderParticipant[] => {
  const byKey = new Map<string, NormalizedProviderParticipant>();

  for (const entry of attendees || []) {
    const parsed = firefliesAttendeeSchema.safeParse(entry);
    if (!parsed.success) continue;
    const email = cleanEmail(parsed.data.email);
    const name =
      cleanString(parsed.data.displayName) ||
      cleanString(parsed.data.name) ||
      (email ? nameFromEmail(email) : null);
    if (!name) continue;
    const key = email || `name:${name.toLowerCase()}`;
    if (!byKey.has(key)) byKey.set(key, { name, email });
  }

  for (const entry of participantEmails || []) {
    const email = cleanEmail(entry);
    if (!email || byKey.has(email)) continue;
    byKey.set(email, { name: nameFromEmail(email), email });
  }

  return Array.from(byKey.values());
};

const normalizeSentences = (
  sentences: unknown[] | null | undefined
): NormalizedTranscriptSegment[] => {
  const segments: NormalizedTranscriptSegment[] = [];
  for (const entry of sentences || []) {
    const parsed = firefliesSentenceSchema.safeParse(entry);
    if (!parsed.success) continue;
    const text = cleanString(parsed.data.text);
    if (!text) continue;
    segments.push({
      speaker: cleanString(parsed.data.speaker_name),
      text,
      offsetSeconds:
        typeof parsed.data.start_time === "number" &&
        Number.isFinite(parsed.data.start_time)
          ? parsed.data.start_time
          : null,
    });
  }
  return segments;
};

/**
 * `summary.action_items` arrives as a newline-separated string (current API)
 * or a string array (older accounts). Bullet prefixes and `**Speaker**`
 * heading-only lines are stripped.
 */
const normalizeActionItems = (raw: unknown): string[] => {
  const lines: string[] = [];
  if (typeof raw === "string") {
    lines.push(...raw.split(/\r?\n/));
  } else if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === "string") lines.push(...item.split(/\r?\n/));
    }
  }
  const items: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^\*\*[^*]*\*\*:?$/.test(trimmed)) continue; // speaker heading line
    const cleaned = trimmed.replace(/^(?:[-*•]|\d+[.)])\s+/, "").trim();
    if (cleaned) items.push(cleaned);
  }
  return items;
};

const normalizeFirefliesTranscript = (
  transcript: unknown,
  requestedId: string
): NormalizedProviderMeeting | null => {
  const parsed = firefliesTranscriptSchema.safeParse(transcript);
  if (!parsed.success) return null;
  const data = parsed.data;

  const externalId = cleanString(data.id) || cleanString(requestedId);
  if (!externalId) return null;

  const startTime =
    typeof data.date === "number" && Number.isFinite(data.date) && data.date > 0
      ? new Date(data.date)
      : null;
  // `duration` is minutes (Float). VERIFY-ON-FIRST-LIVE-RUN.
  const durationSeconds =
    typeof data.duration === "number" &&
    Number.isFinite(data.duration) &&
    data.duration > 0
      ? Math.round(data.duration * 60)
      : null;
  const endTime =
    startTime && durationSeconds
      ? new Date(startTime.getTime() + durationSeconds * 1000)
      : null;

  const summaryParsed = firefliesSummarySchema.safeParse(data.summary);
  const summary = summaryParsed.success
    ? cleanString(summaryParsed.data.overview)
    : null;
  const actionItems = summaryParsed.success
    ? normalizeActionItems(summaryParsed.data.action_items)
    : [];

  return {
    externalId,
    title: cleanString(data.title),
    startTime,
    endTime,
    durationSeconds,
    recordingUrl: cleanString(data.video_url) || cleanString(data.audio_url),
    shareUrl: cleanString(data.transcript_url),
    organizerEmail:
      cleanEmail(data.organizer_email) || cleanEmail(data.host_email),
    participants: normalizeParticipants(data.meeting_attendees, data.participants),
    transcript: normalizeSentences(data.sentences),
    summary,
    actionItems,
    raw: transcript,
  };
};

// ---------------------------------------------------------------------------
// Webhook helpers
// ---------------------------------------------------------------------------

const isTranscriptionCompletedEvent = (eventType: string): boolean => {
  const normalized = eventType.toLowerCase().replace(/[._-]+/g, " ").trim();
  return (
    normalized === "transcription completed" ||
    (normalized.includes("transcription") && normalized.includes("completed"))
  );
};

// ---------------------------------------------------------------------------
// GraphQL documents
// ---------------------------------------------------------------------------

const VALIDATE_CREDENTIALS_QUERY = /* GraphQL */ `
  query ValidateFirefliesApiKey {
    user {
      name
      email
    }
  }
`;

const TRANSCRIPT_QUERY = /* GraphQL */ `
  query FirefliesTranscript($transcriptId: String!) {
    transcript(id: $transcriptId) {
      id
      title
      date
      duration
      transcript_url
      audio_url
      video_url
      host_email
      organizer_email
      participants
      meeting_attendees {
        displayName
        email
        name
      }
      sentences {
        speaker_name
        text
        start_time
      }
      summary {
        overview
        action_items
        keywords
      }
    }
  }
`;

const TRANSCRIPTS_LIST_QUERY = /* GraphQL */ `
  query FirefliesTranscripts($limit: Int, $fromDate: DateTime) {
    transcripts(limit: $limit, fromDate: $fromDate) {
      id
    }
  }
`;

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export const firefliesMeetingProvider: MeetingProviderAdapter = {
  provider: "fireflies",
  displayName: "Fireflies.ai",

  verifyWebhookRequest(
    rawBody: string,
    headers: Headers,
    secret: string | null
  ): boolean {
    // Pinned fathom precedent: no stored secret => accept.
    if (!secret) return true;

    const header = (headers.get("x-hub-signature") || "").trim();
    const match = /^sha256=([0-9a-f]{64})$/i.exec(header);
    if (!match) return false;

    const provided = Buffer.from(match[1].toLowerCase(), "hex");
    const expected = createHmac("sha256", secret)
      .update(rawBody, "utf8")
      .digest();
    if (provided.length !== expected.length) return false;
    return timingSafeEqual(provided, expected);
  },

  parseWebhookPayload(payload: unknown): ParsedProviderWebhook {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return { kind: "ignore", reason: "Payload is not a JSON object." };
    }
    const parsed = firefliesWebhookSchema.safeParse(payload);
    if (!parsed.success) {
      return { kind: "ignore", reason: "Unrecognized webhook payload shape." };
    }

    const meetingId =
      cleanString(parsed.data.meetingId) ||
      cleanString(parsed.data.meeting_id) ||
      cleanString(parsed.data.transcriptId) ||
      cleanString(parsed.data.transcript_id);
    if (!meetingId) {
      return { kind: "ignore", reason: "Webhook payload has no meeting id." };
    }

    const eventType =
      cleanString(parsed.data.eventType) || cleanString(parsed.data.event);
    if (eventType && !isTranscriptionCompletedEvent(eventType)) {
      return { kind: "ignore", reason: `Unsupported event type: ${eventType}` };
    }

    // Fireflies webhooks never carry the transcript inline — always fetch.
    return { kind: "ref", externalMeetingId: meetingId };
  },

  async fetchMeeting(
    connection: MeetingProviderConnection,
    externalMeetingId: string
  ): Promise<NormalizedProviderMeeting | null> {
    const apiKey = requireConnectionApiKey(connection);
    const transcriptId = String(externalMeetingId || "").trim();
    if (!transcriptId) return null;

    const result = await firefliesGraphqlRequest(apiKey, TRANSCRIPT_QUERY, {
      transcriptId,
    });
    if (!result.ok) {
      if (isNotFoundResult(result)) return null;
      throw new Error(`Fireflies transcript fetch failed: ${result.error}`);
    }

    const transcript = result.data?.transcript;
    if (!transcript || typeof transcript !== "object") return null;
    return normalizeFirefliesTranscript(transcript, transcriptId);
  },

  async listMeetings(
    connection: MeetingProviderConnection,
    opts: { since?: Date; limit?: number }
  ): Promise<string[]> {
    const apiKey = requireConnectionApiKey(connection);
    const limit = Math.max(
      1,
      Math.min(
        FIREFLIES_LIST_LIMIT_MAX,
        Math.floor(opts?.limit || FIREFLIES_LIST_LIMIT_DEFAULT)
      )
    );
    const fromDate =
      opts?.since instanceof Date && !Number.isNaN(opts.since.getTime())
        ? opts.since.toISOString()
        : null;

    const result = await firefliesGraphqlRequest(apiKey, TRANSCRIPTS_LIST_QUERY, {
      limit,
      fromDate,
    });
    if (!result.ok) {
      throw new Error(`Fireflies transcript list failed: ${result.error}`);
    }

    const transcripts = Array.isArray(result.data?.transcripts)
      ? result.data.transcripts
      : [];
    const ids: string[] = [];
    for (const entry of transcripts) {
      const id = cleanString((entry as any)?.id);
      if (id && !ids.includes(id)) ids.push(id);
    }
    return ids;
  },

  async validateCredentials(credentials: {
    apiKey: string;
  }): Promise<{ ok: boolean; accountName?: string | null; error?: string }> {
    const apiKey = String(credentials?.apiKey || "").trim();
    if (!apiKey) {
      return { ok: false, error: "Fireflies API key is required." };
    }

    const result = await firefliesGraphqlRequest(
      apiKey,
      VALIDATE_CREDENTIALS_QUERY,
      {}
    );
    if (!result.ok) {
      return { ok: false, error: result.error };
    }

    const user = firefliesUserSchema.safeParse(result.data?.user);
    const accountName = user.success
      ? cleanString(user.data.name) || cleanEmail(user.data.email)
      : null;
    return { ok: true, accountName };
  },
};
