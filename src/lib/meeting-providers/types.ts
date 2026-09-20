/**
 * Meeting note-taker provider abstraction.
 *
 * Provider adapters normalize provider-specific APIs/webhooks into one
 * `NormalizedProviderMeeting`, which the shared ingestion pipeline handles.
 */

export type MeetingProviderId =
  | "fathom"
  | "fireflies"
  | "grain"
  | "tldv"
  | "otter"
  | "meetgeek"
  | "read";

export const MEETING_PROVIDER_IDS: readonly MeetingProviderId[] = [
  "fathom",
  "fireflies",
  "grain",
  "tldv",
  "otter",
  "meetgeek",
  "read",
] as const;

export const isMeetingProviderId = (value: unknown): value is MeetingProviderId =>
  typeof value === "string" &&
  (MEETING_PROVIDER_IDS as readonly string[]).includes(value);

export type MeetingProviderConnectionMode = "api-key" | "webhook-only";

export type MeetingProviderCapabilities = {
  connectionMode: MeetingProviderConnectionMode;
  manualSync: boolean;
  supportsWebhookSecret: boolean;
};

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

export type NormalizedTranscriptSegment = {
  speaker: string | null;
  text: string;
  offsetSeconds?: number | null;
};

export type NormalizedProviderParticipant = {
  name: string;
  email?: string | null;
  title?: string | null;
};

export interface NormalizedProviderMeeting {
  externalId: string;
  title: string | null;
  startTime: Date | null;
  endTime: Date | null;
  durationSeconds: number | null;
  recordingUrl: string | null;
  shareUrl: string | null;
  organizerEmail: string | null;
  participants: NormalizedProviderParticipant[];
  transcript: string | NormalizedTranscriptSegment[];
  summary?: string | null;
  actionItems?: string[];
  raw?: unknown;
}

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
  | { kind: "meeting"; meeting: NormalizedProviderMeeting }
  | { kind: "ref"; externalMeetingId: string }
  | { kind: "ignore"; reason: string };

export interface MeetingProviderAdapter {
  provider: MeetingProviderId;
  displayName: string;
  legacyWebhook?: boolean;
  capabilities?: MeetingProviderCapabilities;

  verifyWebhookRequest(
    rawBody: string,
    headers: Headers,
    secret: string | null
  ): boolean | Promise<boolean>;

  parseWebhookPayload(payload: unknown): ParsedProviderWebhook;

  fetchMeeting?(
    connection: MeetingProviderConnection,
    externalMeetingId: string
  ): Promise<NormalizedProviderMeeting | null>;

  listMeetings?(
    connection: MeetingProviderConnection,
    opts: { since?: Date; limit?: number }
  ): Promise<string[]>;

  validateCredentials(credentials: {
    apiKey: string;
  }): Promise<{ ok: boolean; accountName?: string | null; error?: string }>;
}
