import crypto from "crypto";

const normalizeConfiguredUrl = (value?: string | null) => {
  const normalized = value?.trim();
  return normalized ? normalized.replace(/\/$/, "") : null;
};

const isLoopbackUrl = (value?: string | null) => {
  if (!value) return false;
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
};

const getBaseUrl = () => {
  const raw =
    process.env.NEXTAUTH_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
  if (!raw) {
    throw new Error("Missing base URL for Fathom OAuth redirect.");
  }
  return raw.replace(/\/$/, "");
};

export const FATHOM_SCOPES = "public_api";
export const FATHOM_WEBHOOK_EVENT = "new-meeting-content-ready";
export const FATHOM_WEBHOOK_TRIGGERED_FOR = [
  "my_recordings",
  "shared_with_me_external_recordings",
  "my_shared_with_team_recordings",
  "shared_team_recordings",
] as const;

export const getFathomPublicBaseUrl = () =>
  normalizeConfiguredUrl(process.env.FATHOM_PUBLIC_BASE_URL) || getBaseUrl();

export const getFathomRedirectUri = () => {
  const configuredRedirectUri = normalizeConfiguredUrl(
    process.env.FATHOM_OAUTH_REDIRECT_URI
  );
  const publicBaseUrl = normalizeConfiguredUrl(process.env.FATHOM_PUBLIC_BASE_URL);

  if (publicBaseUrl && (!configuredRedirectUri || isLoopbackUrl(configuredRedirectUri))) {
    return `${publicBaseUrl}/api/fathom/oauth/callback`;
  }

  return configuredRedirectUri || `${getFathomPublicBaseUrl()}/api/fathom/oauth/callback`;
};

export const getFathomWebhookUrl = (token: string) =>
  `${getFathomPublicBaseUrl()}/api/fathom/webhook?token=${token}`;

export const getFathomWebhookUrlPrefix = () =>
  `${getFathomPublicBaseUrl()}/api/fathom/webhook?token=`;

const getRecordingHashKey = () =>
  process.env.NEXTAUTH_SECRET || process.env.FATHOM_CLIENT_SECRET || "";

export const getFathomRecordingHashScope = ({
  userId,
  connectionId,
}: {
  userId: string;
  connectionId?: string | null;
}) => (connectionId ? `connection:${connectionId}` : `user:${userId}`);

export const hashFathomRecordingId = (scopeKey: string, recordingId: string) => {
  const key = getRecordingHashKey() || scopeKey;
  return crypto
    .createHmac("sha256", key)
    .update(`${scopeKey}:${recordingId}`)
    .digest("hex");
};

const normalizeStringCandidate = (value: unknown) => {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
};

export const extractFathomProviderSourceId = (payload: any): string | null => {
  const candidates = [
    payload?.provider_source_id,
    payload?.providerSourceId,
    payload?.source_id,
    payload?.sourceId,
    payload?.source?.id,
    payload?.source?.source_id,
    payload?.recording?.provider_source_id,
    payload?.recording?.providerSourceId,
    payload?.recording?.source_id,
    payload?.recording?.sourceId,
    payload?.recording?.source?.id,
    Array.isArray(payload?.source_ids) ? payload.source_ids[0] : null,
    Array.isArray(payload?.provider_source_ids) ? payload.provider_source_ids[0] : null,
    Array.isArray(payload?.recording?.source_ids) ? payload.recording.source_ids[0] : null,
    Array.isArray(payload?.recording?.provider_source_ids)
      ? payload.recording.provider_source_ids[0]
      : null,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeStringCandidate(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return null;
};

const formatTimestamp = (value: string | number | null | undefined) => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (!Number.isFinite(value)) return "";
  const totalSeconds = Math.max(0, Math.floor(value));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

export const formatFathomTranscript = (segments: any): string => {
  if (!segments) return "";
  if (typeof segments === "string") return segments;
  if (segments && typeof segments === "object" && !Array.isArray(segments)) {
    const nested =
      segments.transcript ||
      segments.transcript_segments ||
      segments.segments ||
      segments.items;
    if (Array.isArray(nested)) {
      return formatFathomTranscript(nested);
    }
  }
  if (!Array.isArray(segments)) return JSON.stringify(segments, null, 2);

  return segments
    .map((segment: any) => {
      const speakerValue = segment.speaker || segment.speaker_name || segment.name;
      const speaker =
        typeof speakerValue === "string"
          ? speakerValue
          : speakerValue?.display_name || speakerValue?.name;
      const text = segment.text || segment.content || "";
      const timestamp =
        segment.timestamp ??
        segment.start_time ??
        segment.startTime ??
        segment.time;
      const formattedTimestamp = formatTimestamp(timestamp);
      const prefixParts = [formattedTimestamp, speaker].filter(Boolean);
      const prefix = prefixParts.length ? `${prefixParts.join(" - ")}: ` : "";
      return `${prefix}${text}`.trim();
    })
    .filter(Boolean)
    .join("\n");
};
