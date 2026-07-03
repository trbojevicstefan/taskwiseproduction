/**
 * Phase 7 — meeting note-taker provider abstraction (pinned contract).
 *
 * A provider adapter turns provider-specific webhooks/APIs into a
 * `NormalizedProviderMeeting`, which the shared pipeline
 * (`src/lib/meeting-providers/ingest-pipeline.ts`) ingests exactly like a
 * Fathom meeting: dedupe -> LLM task extraction -> meeting + planningSession
 * docs -> `meeting.ingested` domain event -> Slack automation. Adapters must
 * NEVER fork task extraction or the domain-event rail.
 *
 * Deviations from the originally sketched interface (documented per house
 * rules):
 * - `parseWebhookPayload` returns `{ kind: "meeting" | "ref" | "ignore" }`
 *   exactly as specified.
 * - Connection-taking methods receive a structural
 *   `MeetingProviderConnection` (not the full `MeetingConnectionDoc` from
 *   `src/lib/meeting-connections.ts`) to avoid a type-import cycle;
 *   `MeetingConnectionDoc` satisfies it.
 * - `MeetingProviderAdapter` carries a `legacyWebhook` flag so the registry
 *   can mark Fathom (which keeps its own `/api/fathom/webhook` route and
 *   OAuth connections) as not served by `/api/webhooks/[provider]`.
 * - `transcript` accepts either pre-normalized text ("M:SS - Speaker: text"
 *   lines, Fathom parity) or raw segments; the shared pipeline formats
 *   segments with `formatProviderTranscriptSegments`.
 */

export type MeetingProviderId = "fathom" | "fireflies" | "grain";

export const MEETING_PROVIDER_IDS: readonly MeetingProviderId[] = [
  "fathom",
  "fireflies",
  "grain",
] as const;

export const isMeetingProviderId = (value: unknown): value is MeetingProviderId =>
  typeof value === "string" &&
  (MEETING_PROVIDER_IDS as readonly string[]).includes(value);

/** Thrown by stub adapter methods that a parallel agent has not implemented yet. */
export class ProviderNotImplementedError extends Error {
  provider: MeetingProviderId;
  method: string | null;

  constructor(provider: MeetingProviderId, method?: string) {
    super(
      `Meeting provider "${provider}" is not implemented yet${
        method ? ` (${method})` : ""
      }.`
    );
    this.name = "ProviderNotImplementedError";
    this.provider = provider;
    this.method = method || null;
  }
}

/** One transcript utterance when a provider exposes segments instead of text. */
export type NormalizedTranscriptSegment = {
  /** Display name of the speaker; null when the provider omits it. */
  speaker: string | null;
  /** Utterance text (plain text, no markup). */
  text: string;
  /** Offset from the start of the recording, in seconds (used for the "M:SS" prefix). */
  offsetSeconds?: number | null;
};

/** A meeting participant in the shape `people-sync` expects ({name, email, title}). */
export type NormalizedProviderParticipant = {
  /** Human-readable display name (required — people upserts key on it). */
  name: string;
  /** Lowercased email when known; enables Phase 6 personType classification. */
  email?: string | null;
  /** Job title when the provider exposes one. */
  title?: string | null;
};

/**
 * The provider-agnostic meeting the shared pipeline consumes.
 * Field mapping mirrors the meeting doc written by
 * `buildCreatedFathomMeetingRecords` (see scout normalizedMeetingShape).
 */
export interface NormalizedProviderMeeting {
  /**
   * The provider's stable external id for this meeting/recording/transcript.
   * Drives idempotent dedupe (hashed into `recordingIdHash` under the
   * connection scope) and is persisted as `providerSourceId`.
   */
  externalId: string;
  /** Meeting title; null lets the pipeline fall back to the AI session title. */
  title: string | null;
  /** Meeting start as a Date (persisted to `startTime`); null when unknown. */
  startTime: Date | null;
  /** Meeting end as a Date (persisted to `endTime`); null when unknown. */
  endTime: Date | null;
  /** Duration in seconds (persisted to `duration`); null when unknown. */
  durationSeconds: number | null;
  /** Playable recording URL (persisted to `recordingUrl`). */
  recordingUrl: string | null;
  /** Shareable link to the meeting page (persisted to `shareUrl`). */
  shareUrl: string | null;
  /** Organizer/host email, lowercased (persisted to `organizerEmail`). */
  organizerEmail: string | null;
  /** Participants; merged with AI-detected attendees during ingestion. */
  participants: NormalizedProviderParticipant[];
  /**
   * Transcript: either pre-normalized text ("M:SS - Speaker: text" lines) or
   * raw segments the pipeline formats. Empty => ingest returns
   * `no_transcript` (Fathom parity).
   */
  transcript: string | NormalizedTranscriptSegment[];
  /** Provider-generated summary text/markdown; the AI summary wins when present. */
  summary?: string | null;
  /**
   * Provider-generated action items. NOT mapped into extractedTasks (Fathom
   * parity: canonical tasks come only from the shared LLM extraction).
   * Persisted verbatim on the meeting doc as `providerActionItems`.
   */
  actionItems?: string[];
  /** Original provider payload for debugging; never persisted by the pipeline. */
  raw?: unknown;
}

/**
 * Structural connection shape adapters receive. `MeetingConnectionDoc`
 * (src/lib/meeting-connections.ts) satisfies this. `apiKey` follows the
 * fathomConnections precedent: stored as-is on the connection doc.
 */
export type MeetingProviderConnection = {
  _id: string;
  workspaceId: string;
  userId: string;
  provider: MeetingProviderId;
  status: string;
  apiKey: string | null;
  accountName: string | null;
  webhookSecret: string | null;
};

export type ParsedProviderWebhook =
  /** Payload contained the full meeting content — ingest it directly. */
  | { kind: "meeting"; meeting: NormalizedProviderMeeting }
  /** Payload only referenced a meeting — fetch it with `fetchMeeting`. */
  | { kind: "ref"; externalMeetingId: string }
  /** Payload is irrelevant (wrong event type, ping, etc.). */
  | { kind: "ignore"; reason: string };

export interface MeetingProviderAdapter {
  provider: MeetingProviderId;
  displayName: string;
  /**
   * True when the provider keeps its own bespoke webhook/connection routes
   * (Fathom). `/api/webhooks/[provider]` and `/api/integrations/[provider]`
   * return 404 for such providers.
   */
  legacyWebhook?: boolean;

  /**
   * Verify an incoming webhook request. Fathom precedent (pinned by tests):
   * when `secret` is null the request MUST be accepted — do not silently
   * tighten or loosen this.
   */
  verifyWebhookRequest(
    rawBody: string,
    headers: Headers,
    secret: string | null
  ): boolean | Promise<boolean>;

  /** Classify + normalize a parsed webhook JSON payload. Must not throw on odd shapes. */
  parseWebhookPayload(payload: unknown): ParsedProviderWebhook;

  /** Fetch one meeting by external id (used for `kind: "ref"` webhooks and sync). */
  fetchMeeting?(
    connection: MeetingProviderConnection,
    externalMeetingId: string
  ): Promise<NormalizedProviderMeeting | null>;

  /** List external meeting ids for backfill sync, newest first. */
  listMeetings?(
    connection: MeetingProviderConnection,
    opts: { since?: Date; limit?: number }
  ): Promise<string[]>;

  /** Validate an API key at connect time; never throw for bad credentials. */
  validateCredentials(credentials: {
    apiKey: string;
  }): Promise<{ ok: boolean; accountName?: string | null; error?: string }>;
}
