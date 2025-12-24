import crypto from "crypto";
import { getDb } from "@/lib/db";

export interface FathomInstallationDoc {
  _id: string;
  userId: string;
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: number | null;
  scope?: string | null;
  fathomUserId?: string | null;
  webhookId?: string | null;
  webhookUrl?: string | null;
  webhookEvent?: string | null;
  webhookSecret?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

const INSTALLATIONS_COLLECTION = "fathomInstallations";
const OAUTH_STATE_COLLECTION = "fathomOauthStates";

const FATHOM_CLIENT_ID = process.env.FATHOM_CLIENT_ID;
const FATHOM_CLIENT_SECRET = process.env.FATHOM_CLIENT_SECRET;
const FATHOM_WEBHOOK_SECRET = process.env.FATHOM_WEBHOOK_SECRET || null;

export const FATHOM_SCOPES = "public_api";
export const FATHOM_WEBHOOK_EVENT = "new-meeting-content-ready";

const getBaseUrl = () => {
  const raw =
    process.env.NEXTAUTH_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
  if (!raw) {
    throw new Error("Missing base URL for Fathom OAuth redirect.");
  }
  return raw.replace(/\/$/, "");
};

export const getFathomRedirectUri = () =>
  `${getBaseUrl()}/api/fathom/oauth/callback`;

export const getFathomWebhookUrl = (token: string) =>
  `${getBaseUrl()}/api/fathom/webhook?token=${token}`;

export const createFathomOAuthState = async (userId: string): Promise<string> => {
  const db = await getDb();
  const state = crypto.randomBytes(24).toString("hex");
  await db.collection(OAUTH_STATE_COLLECTION).insertOne({
    _id: state,
    userId,
    createdAt: new Date(),
  });
  return state;
};

export const consumeFathomOAuthState = async (
  state: string
): Promise<string | null> => {
  const db = await getDb();
  const record = await db
    .collection<{ _id: string; userId: string; createdAt: Date }>(
      OAUTH_STATE_COLLECTION
    )
    .findOne({ _id: state });
  if (!record) return null;
  await db.collection(OAUTH_STATE_COLLECTION).deleteOne({ _id: state });
  return record.userId;
};

export const getFathomInstallation = async (
  userId: string
): Promise<FathomInstallationDoc | null> => {
  const db = await getDb();
  return db
    .collection<FathomInstallationDoc>(INSTALLATIONS_COLLECTION)
    .findOne({ _id: userId });
};

export const saveFathomInstallation = async (
  installation: FathomInstallationDoc
) => {
  const db = await getDb();
  await db
    .collection<FathomInstallationDoc>(INSTALLATIONS_COLLECTION)
    .updateOne(
      { _id: installation.userId },
      { $set: installation, $setOnInsert: { createdAt: new Date() } },
      { upsert: true }
    );
};

export const deleteFathomInstallation = async (userId: string) => {
  const db = await getDb();
  await db.collection(INSTALLATIONS_COLLECTION).deleteOne({ _id: userId });
};

const refreshFathomToken = async (installation: FathomInstallationDoc) => {
  if (!FATHOM_CLIENT_ID || !FATHOM_CLIENT_SECRET) {
    throw new Error("Fathom client credentials are not configured.");
  }
  if (!installation.refreshToken) {
    throw new Error("Missing Fathom refresh token.");
  }

  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: installation.refreshToken,
    client_id: FATHOM_CLIENT_ID,
    client_secret: FATHOM_CLIENT_SECRET,
  });

  const response = await fetch(
    "https://fathom.video/external/v1/oauth2/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    }
  );

  const payload = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    error?: string;
  };

  if (!payload.access_token) {
    throw new Error(payload.error || "Failed to refresh Fathom token.");
  }

  const updated: FathomInstallationDoc = {
    ...installation,
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token || installation.refreshToken,
    expiresAt: payload.expires_in
      ? Date.now() + payload.expires_in * 1000
      : installation.expiresAt || null,
    scope: payload.scope || installation.scope || null,
    updatedAt: new Date(),
  };

  await saveFathomInstallation(updated);
  return updated.accessToken;
};

export const getValidFathomAccessToken = async (
  userId: string
): Promise<string> => {
  const installation = await getFathomInstallation(userId);
  if (!installation) {
    throw new Error("Fathom installation not found for this user.");
  }

  const now = Date.now();
  if (
    installation.expiresAt &&
    now >= installation.expiresAt - 60_000 &&
    installation.refreshToken
  ) {
    return refreshFathomToken(installation);
  }

  return installation.accessToken;
};

const fathomApiFetch = async <T>(
  path: string,
  accessToken: string
): Promise<T> => {
  const response = await fetch(`https://api.fathom.ai${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(
      `Fathom API error (${response.status}): ${errorText || response.statusText}`
    );
  }
  return (await response.json()) as T;
};

const listFathomWebhooks = async (accessToken: string) => {
  const payload = await fathomApiFetch<any>(
    "/external/v1/webhooks",
    accessToken
  );
  if (Array.isArray(payload)) return payload;
  return payload?.webhooks || payload?.data || [];
};

const createFathomWebhook = async (
  accessToken: string,
  url: string,
  event: string
) => {
  const payloads = [
    { url, events: [event], secret: FATHOM_WEBHOOK_SECRET },
    { url, event, secret: FATHOM_WEBHOOK_SECRET },
    { url, event_type: event, secret: FATHOM_WEBHOOK_SECRET },
    { url, events: [event] },
    { url, event },
  ];

  let lastError: Error | null = null;
  for (const body of payloads) {
    try {
      const response = await fetch(
        "https://api.fathom.ai/external/v1/webhooks",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify(body),
        }
      );
      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        lastError = new Error(
          `Fathom webhook create failed (${response.status}): ${errorText || response.statusText}`
        );
        continue;
      }
      return (await response.json()) as any;
    } catch (error) {
      lastError = error as Error;
    }
  }

  if (lastError) {
    throw lastError;
  }
  throw new Error("Fathom webhook create failed.");
};

const normalizeWebhookEvent = (webhook: any) =>
  webhook?.event ||
  webhook?.event_type ||
  (Array.isArray(webhook?.events) ? webhook?.events[0] : null);

const normalizeWebhookUrl = (webhook: any) =>
  webhook?.url || webhook?.endpoint || webhook?.webhook_url || null;

export const ensureFathomWebhook = async (
  userId: string,
  accessToken: string,
  token: string
) => {
  const webhookUrl = getFathomWebhookUrl(token);
  const webhooks = await listFathomWebhooks(accessToken);

  const existing = webhooks.find((webhook: any) => {
    const url = normalizeWebhookUrl(webhook);
    const event = normalizeWebhookEvent(webhook);
    return url === webhookUrl && event === FATHOM_WEBHOOK_EVENT;
  });

  const installation = await getFathomInstallation(userId);
  if (!installation) {
    throw new Error("Fathom installation missing while creating webhook.");
  }

  if (existing) {
    await saveFathomInstallation({
      ...installation,
      webhookId: existing.id || existing.webhook_id || installation.webhookId || null,
      webhookUrl,
      webhookEvent: FATHOM_WEBHOOK_EVENT,
      webhookSecret: FATHOM_WEBHOOK_SECRET,
      updatedAt: new Date(),
    });
    return { status: "existing", webhookId: existing.id || existing.webhook_id || null };
  }

  const created = await createFathomWebhook(
    accessToken,
    webhookUrl,
    FATHOM_WEBHOOK_EVENT
  );
  await saveFathomInstallation({
    ...installation,
    webhookId: created.id || created.webhook_id || null,
    webhookUrl,
    webhookEvent: FATHOM_WEBHOOK_EVENT,
    webhookSecret: FATHOM_WEBHOOK_SECRET,
    updatedAt: new Date(),
  });
  return { status: "created", webhookId: created.id || created.webhook_id || null };
};

export const fetchFathomTranscript = async (
  recordingId: string,
  accessToken: string
) => {
  const payload = await fathomApiFetch<any>(
    `/external/v1/recordings/${recordingId}/transcript`,
    accessToken
  );
  return payload?.transcript ?? payload;
};

export const fetchFathomSummary = async (
  recordingId: string,
  accessToken: string
) => {
  const payload = await fathomApiFetch<any>(
    `/external/v1/recordings/${recordingId}/summary`,
    accessToken
  );
  return payload?.summary ?? payload;
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
    .map((segment) => {
      const speaker = segment.speaker || segment.speaker_name || segment.name;
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
