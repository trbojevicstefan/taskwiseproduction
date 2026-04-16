import crypto from "crypto";
import { getDb } from "@/lib/db";
import {
  findFathomConnectionById,
  type FathomConnectionDoc,
  updateFathomConnectionById,
} from "@/lib/fathom-connections";
import { logFathomIntegration } from "@/lib/fathom-logs";
import { recordExternalApiFailure } from "@/lib/observability-metrics";

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
  webhooks?: Array<{
    id?: string | null;
    url?: string | null;
    createdAt?: string | Date | null;
    include_transcript?: boolean | null;
    include_summary?: boolean | null;
    include_action_items?: boolean | null;
    include_crm_matches?: boolean | null;
    triggered_for?: string[] | null;
  }>;
  createdAt?: Date;
  updatedAt?: Date;
}

const INSTALLATIONS_COLLECTION = "fathomInstallations";
const OAUTH_STATE_COLLECTION = "fathomOauthStates";

const FATHOM_CLIENT_ID = process.env.FATHOM_CLIENT_ID;
const FATHOM_CLIENT_SECRET = process.env.FATHOM_CLIENT_SECRET;
export const FATHOM_SCOPES = "public_api";
export const FATHOM_WEBHOOK_EVENT = "new-meeting-content-ready";
export const FATHOM_WEBHOOK_TRIGGERED_FOR = [
  "my_recordings",
  "shared_with_me_external_recordings",
  "my_shared_with_team_recordings",
  "shared_team_recordings",
] as const;

const FATHOM_WEBHOOK_TRIGGERED_FOR_FALLBACK = [
  "my_recordings",
  "shared_external_recordings",
  "my_shared_with_team_recordings",
  "shared_team_recordings",
] as const;

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

const mergeManagedWebhookEntries = (
  nextEntry: Record<string, any>,
  existingEntries: any[]
) => [
  nextEntry,
  ...existingEntries.filter((entry: any) => {
    if (!entry) return false;
    if (nextEntry.id && entry.id === nextEntry.id) return false;
    if (!nextEntry.id && nextEntry.url && entry.url === nextEntry.url) return false;
    return true;
  }),
];

const toLegacyWebhookEntry = (entry: any) => ({
  id: entry?.id || null,
  url: entry?.url || null,
  createdAt: entry?.createdAt || null,
  include_transcript: entry?.includeTranscript ?? null,
  include_summary: entry?.includeSummary ?? null,
  include_action_items: entry?.includeActionItems ?? null,
  include_crm_matches: entry?.includeCrmMatches ?? null,
  triggered_for: entry?.triggeredFor ?? null,
});

const toConnectionManagedWebhook = (entry: any, fallbackUrl: string) => ({
  id: entry?.id || entry?.webhook_id || null,
  url:
    entry?.url ||
    entry?.webhook_url ||
    entry?.destination_url ||
    entry?.destinationUrl ||
    fallbackUrl,
  createdAt: entry?.created_at || entry?.createdAt || null,
  includeTranscript: entry?.include_transcript ?? null,
  includeSummary: entry?.include_summary ?? null,
  includeActionItems: entry?.include_action_items ?? null,
  includeCrmMatches: entry?.include_crm_matches ?? null,
  triggeredFor: entry?.triggered_for ?? null,
});

const syncLegacyInstallationFromConnection = async (
  connection: FathomConnectionDoc,
  overrides: Partial<FathomInstallationDoc> = {}
) => {
  if (!connection.legacyUserId) return null;

  const userId = connection.legacyUserId;
  const existing = await getFathomInstallation(userId);
  const managedWebhooks = Array.isArray(connection.webhook.managedWebhooks)
    ? connection.webhook.managedWebhooks.map(toLegacyWebhookEntry)
    : [];
  const accessToken =
    overrides.accessToken ?? connection.oauth.accessToken ?? existing?.accessToken ?? null;

  if (!accessToken) {
    return existing;
  }

  const installation: FathomInstallationDoc = {
    _id: userId,
    userId,
    accessToken,
    refreshToken:
      overrides.refreshToken ?? connection.oauth.refreshToken ?? existing?.refreshToken ?? null,
    expiresAt:
      overrides.expiresAt ?? connection.oauth.expiresAt ?? existing?.expiresAt ?? null,
    scope: overrides.scope ?? connection.oauth.scope ?? existing?.scope ?? null,
    fathomUserId:
      overrides.fathomUserId ??
      connection.source.providerUserId ??
      existing?.fathomUserId ??
      null,
    webhookId:
      overrides.webhookId ?? connection.webhook.webhookId ?? existing?.webhookId ?? null,
    webhookUrl:
      overrides.webhookUrl ?? connection.webhook.webhookUrl ?? existing?.webhookUrl ?? null,
    webhookEvent:
      overrides.webhookEvent ??
      connection.webhook.webhookEvent ??
      existing?.webhookEvent ??
      null,
    webhookSecret:
      overrides.webhookSecret ??
      connection.webhook.secret ??
      existing?.webhookSecret ??
      null,
    webhooks:
      overrides.webhooks ??
      (managedWebhooks.length ? managedWebhooks : existing?.webhooks || []),
    createdAt: existing?.createdAt,
    updatedAt: new Date(),
  };

  await saveFathomInstallation(installation);
  return installation;
};

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
    .collection(
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
    .collection(INSTALLATIONS_COLLECTION)
    .findOne({ _id: userId });
};

export const saveFathomInstallation = async (
  installation: FathomInstallationDoc
) => {
  const db = await getDb();
  const { createdAt, ...rest } = installation;
  await db
    .collection(INSTALLATIONS_COLLECTION)
    .updateOne(
      { _id: installation.userId },
      { $set: rest, $setOnInsert: { createdAt: createdAt || new Date() } },
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

  let response: Response;
  try {
    response = await fetch(
      "https://fathom.video/external/v1/oauth2/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params,
      }
    );
  } catch (error) {
    void recordExternalApiFailure({
      provider: "fathom",
      operation: "oauth.token.refresh",
      userId: installation.userId,
      error,
    });
    throw error;
  }

  const payload = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    error?: string;
  };

  if (!payload.access_token) {
    void recordExternalApiFailure({
      provider: "fathom",
      operation: "oauth.token.refresh",
      userId: installation.userId,
      statusCode: response.status,
      error: payload.error || "Failed to refresh Fathom token.",
    });
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

const refreshFathomConnectionToken = async (connection: FathomConnectionDoc) => {
  if (!FATHOM_CLIENT_ID || !FATHOM_CLIENT_SECRET) {
    throw new Error("Fathom client credentials are not configured.");
  }
  if (!connection.oauth.refreshToken) {
    throw new Error("Missing Fathom refresh token.");
  }

  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: connection.oauth.refreshToken,
    client_id: FATHOM_CLIENT_ID,
    client_secret: FATHOM_CLIENT_SECRET,
  });

  let response: Response;
  try {
    response = await fetch(
      "https://fathom.video/external/v1/oauth2/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params,
      }
    );
  } catch (error) {
    void recordExternalApiFailure({
      provider: "fathom",
      operation: "oauth.token.refresh",
      userId: connection.legacyUserId || connection.createdByUserId,
      error,
      metadata: {
        connectionId: connection._id,
      },
    });
    throw error;
  }

  const payload = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    error?: string;
  };

  if (!payload.access_token) {
    void recordExternalApiFailure({
      provider: "fathom",
      operation: "oauth.token.refresh",
      userId: connection.legacyUserId || connection.createdByUserId,
      statusCode: response.status,
      error: payload.error || "Failed to refresh Fathom token.",
      metadata: {
        connectionId: connection._id,
      },
    });
    throw new Error(payload.error || "Failed to refresh Fathom token.");
  }

  const db = await getDb();
  const refreshed = await updateFathomConnectionById(db as any, connection._id, {
    oauth: {
      ...connection.oauth,
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token || connection.oauth.refreshToken || null,
      expiresAt: payload.expires_in
        ? Date.now() + payload.expires_in * 1000
        : connection.oauth.expiresAt || null,
      scope: payload.scope || connection.oauth.scope || null,
      lastRefreshedAt: new Date(),
      lastError: null,
    },
    updatedByUserId: connection.updatedByUserId || connection.createdByUserId,
  });

  if (!refreshed) {
    throw new Error("Fathom connection not found after refresh.");
  }

  await syncLegacyInstallationFromConnection(refreshed, {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token || connection.oauth.refreshToken || null,
    expiresAt: payload.expires_in
      ? Date.now() + payload.expires_in * 1000
      : connection.oauth.expiresAt || null,
    scope: payload.scope || connection.oauth.scope || null,
  });

  return payload.access_token;
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

export const getValidFathomAccessTokenForConnection = async (
  connectionId: string
): Promise<string> => {
  const db = await getDb();
  const connection = await findFathomConnectionById(db as any, connectionId);
  if (!connection || !connection.oauth.accessToken) {
    throw new Error("Fathom connection not found.");
  }

  const now = Date.now();
  if (
    connection.oauth.expiresAt &&
    now >= connection.oauth.expiresAt - 60_000 &&
    connection.oauth.refreshToken
  ) {
    return refreshFathomConnectionToken(connection);
  }

  return connection.oauth.accessToken;
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

const fathomApiFetch = async <T>(
  path: string,
  accessToken: string
): Promise<T> => {
  const response = await fetch(`https://api.fathom.ai${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    void recordExternalApiFailure({
      provider: "fathom",
      operation: "api.fetch",
      statusCode: response.status,
      error: errorText || response.statusText,
      metadata: {
        path,
      },
    });
    throw new Error(
      `Fathom API error (${response.status}): ${errorText || response.statusText}`
    );
  }
  return (await response.json()) as T;
};

export const fetchFathomMeetings = async (accessToken: string) => {
  const payload = await fathomApiFetch<any>(
    "/external/v1/meetings",
    accessToken
  );
  if (Array.isArray(payload)) return payload;
  return payload?.meetings || payload?.data || payload?.items || [];
};

const buildWebhookBody = (url: string, triggeredFor: readonly string[]) => ({
    destination_url: url,
    include_transcript: true,
    include_summary: true,
    include_action_items: true,
    include_crm_matches: false,
    triggered_for: [...triggeredFor],
  });

const createFathomWebhook = async (
  accessToken: string,
  url: string,
  triggeredFor: readonly string[]
) => {
  const body = buildWebhookBody(url, triggeredFor);

  const response = await fetch("https://api.fathom.ai/external/v1/webhooks", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    void recordExternalApiFailure({
      provider: "fathom",
      operation: "webhooks.create",
      statusCode: response.status,
      error: errorText || response.statusText,
      metadata: {
        destinationUrl: url,
      },
    });
    throw new Error(
      `Fathom webhook create failed (${response.status}): ${errorText || response.statusText}`
    );
  }

  return (await response.json()) as any;
};

export const listFathomWebhooks = async (accessToken: string) => {
  const payload = await fathomApiFetch<any>("/external/v1/webhooks", accessToken);
  if (Array.isArray(payload)) return payload;
  return payload?.webhooks || payload?.data || payload?.items || [];
};

const getWebhookUrl = (webhook: any) =>
  webhook?.destination_url ||
  webhook?.destinationUrl ||
  webhook?.url ||
  webhook?.webhook_url ||
  webhook?.webhookUrl ||
  null;

const getWebhookId = (webhook: any) =>
  webhook?.id || webhook?.webhook_id || null;

export const deleteManagedFathomWebhooks = async (accessToken: string) => {
  const webhooks = await listFathomWebhooks(accessToken);
  const prefix = getFathomWebhookUrlPrefix();
  const pathMarker = "/api/fathom/webhook?token=";
  const managed = webhooks.filter((webhook: any) => {
    const url = getWebhookUrl(webhook);
    return (
      typeof url === "string" &&
      (url.startsWith(prefix) || url.includes(pathMarker))
    );
  });
  if (!managed.length) return 0;
  await Promise.allSettled(
    managed.map((webhook: any) => deleteFathomWebhook(accessToken, webhook))
  );
  return managed.length;
};

const resolveWebhookDeleteUrl = (webhook: any) => {
  const candidate =
    webhook?.actions?.deleteUrl ||
    webhook?.actions?.delete_url ||
    webhook?.deleteUrl ||
    webhook?.delete_url ||
    webhook?.delete_path ||
    webhook?.deletePath ||
    null;

  if (!candidate) return null;
  if (candidate.startsWith("http")) return candidate;
  return `https://api.fathom.ai${candidate}`;
};

export const deleteFathomWebhook = async (
  accessToken: string,
  webhook: { id?: string; actions?: { deleteUrl?: string; delete_url?: string } } | string
) => {
  const webhookId = typeof webhook === "string" ? webhook : webhook?.id;
  const deleteUrl =
    typeof webhook === "string" ? null : resolveWebhookDeleteUrl(webhook);

  const url = deleteUrl || `https://api.fathom.ai/external/v1/webhooks/${webhookId}`;

  if (!webhookId && !deleteUrl) {
    throw new Error("Missing webhook identifier for deletion.");
  }

  const response = await fetch(url, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    void recordExternalApiFailure({
      provider: "fathom",
      operation: "webhooks.delete",
      statusCode: response.status,
      error: errorText || response.statusText,
      metadata: {
        webhookId: webhookId || null,
      },
    });
    throw new Error(
      `Fathom webhook delete failed (${response.status}): ${errorText || response.statusText}`
    );
  }
};

export const pruneFathomManagedWebhooks = async (
  accessToken: string,
  input: {
    webhookId?: string | null;
    webhookUrl?: string | null;
    managedWebhooks?: any[] | null;
  }
) => {
  const managedWebhooks = Array.isArray(input.managedWebhooks)
    ? input.managedWebhooks
    : [];
  if (!managedWebhooks.length) {
    return {
      managedWebhooks: [] as any[],
      deletedCount: 0,
      cleanupErrors: [] as string[],
    };
  }

  const primaryId = input.webhookId || null;
  const primaryUrl = input.webhookUrl || null;

  const keepIndices = new Set<number>();
  managedWebhooks.forEach((entry: any, index: number) => {
    const entryId = entry?.id || null;
    const entryUrl = entry?.url || null;
    if (primaryId && entryId === primaryId) {
      keepIndices.add(index);
      return;
    }
    if (!primaryId && primaryUrl && entryUrl === primaryUrl) {
      keepIndices.add(index);
    }
  });

  // If primary details are missing or not present in the list, keep the first entry.
  if (keepIndices.size === 0) {
    keepIndices.add(0);
  }

  const staleTargets = managedWebhooks
    .map((entry: any, index: number) => ({ entry, index }))
    .filter(({ entry, index }) => !keepIndices.has(index) && (entry?.id || entry?.url));

  const results = await Promise.allSettled(
    staleTargets.map(({ entry }) => deleteFathomWebhook(accessToken, entry as any))
  );

  const failedStaleIndices = new Set<number>();
  const cleanupErrors: string[] = [];
  results.forEach((result, idx) => {
    if (result.status === "rejected") {
      const staleEntryIndex = staleTargets[idx]?.index;
      if (typeof staleEntryIndex === "number") {
        failedStaleIndices.add(staleEntryIndex);
      }
      cleanupErrors.push(
        result.reason instanceof Error ? result.reason.message : String(result.reason)
      );
    }
  });

  const nextManagedWebhooks = managedWebhooks.filter(
    (_entry: any, index: number) =>
      keepIndices.has(index) || failedStaleIndices.has(index)
  );

  return {
    managedWebhooks: nextManagedWebhooks,
    deletedCount: staleTargets.length - failedStaleIndices.size,
    cleanupErrors,
  };
};

export const ensureFathomWebhook = async (
  userId: string,
  accessToken: string,
  token: string
) => {
  const webhookUrl = getFathomWebhookUrl(token);

  const installation = await getFathomInstallation(userId);
  if (!installation) {
    throw new Error("Fathom installation missing while creating webhook.");
  }

  const upsertWebhook = (
    created: any,
    current: FathomInstallationDoc,
    fallbackUrl: string
  ) => {
    const webhookId = created.id || created.webhook_id || null;
    const createdUrl = created.url || created.webhook_url || fallbackUrl;
    const createdAt = created.created_at || created.createdAt || null;
    const nextEntry = {
      id: webhookId,
      url: createdUrl,
      createdAt,
      include_transcript: created.include_transcript ?? null,
      include_summary: created.include_summary ?? null,
      include_action_items: created.include_action_items ?? null,
      include_crm_matches: created.include_crm_matches ?? null,
      triggered_for: created.triggered_for ?? null,
    };
    const existing = current.webhooks || [];
    const merged = [
      nextEntry,
      ...existing.filter((entry: any) => {
        if (!entry) return false;
        if (webhookId && entry.id === webhookId) return false;
        if (!webhookId && entry.url && entry.url === createdUrl) return false;
        return true;
      }),
    ];
    return { webhookId, createdUrl, createdAt, merged };
  };

  const mergeFallbackWebhook = (
    current: FathomInstallationDoc,
    webhookId: string | null,
    webhookUrl: string
  ) => {
    const entry = webhookId || webhookUrl
      ? [
          {
            id: webhookId,
            url: webhookUrl,
            createdAt: current.updatedAt || current.createdAt || null,
          },
        ]
      : [];
    const existing = current.webhooks || [];
    const merged = [
      ...entry,
      ...existing.filter((item: any) => {
        if (!item) return false;
        if (webhookId && item.id === webhookId) return false;
        if (!webhookId && item.url && item.url === webhookUrl) return false;
        return true;
      }),
    ];
    return merged;
  };

  try {
    const existingWebhooks = await listFathomWebhooks(accessToken);
    const matches = existingWebhooks.filter(
      (webhook: any) => getWebhookUrl(webhook) === webhookUrl
    );
    if (matches.length > 0) {
      const sorted = [...matches].sort((a: any, b: any) => {
        const aCreated = new Date(a.created_at || a.createdAt || 0).getTime();
        const bCreated = new Date(b.created_at || b.createdAt || 0).getTime();
        return bCreated - aCreated;
      });
      const primary = sorted[0];
      const primaryId = getWebhookId(primary);
      const { webhookId, createdUrl, merged } = upsertWebhook(
        primary,
        installation,
        webhookUrl
      );

      await saveFathomInstallation({
        ...installation,
        webhookId: webhookId || primaryId,
        webhookUrl: createdUrl,
        webhookEvent: FATHOM_WEBHOOK_EVENT,
        webhookSecret: installation.webhookSecret || null,
        webhooks: merged,
        updatedAt: new Date(),
      });

      if (sorted.length > 1) {
        await Promise.allSettled(
          sorted.slice(1).map((webhook: any) =>
            deleteFathomWebhook(accessToken, webhook)
          )
        );
      }

      await logFathomIntegration(
        userId,
        "info",
        "webhook.create",
        "Webhook already exists.",
        {
          status: "existing",
          webhookId: webhookId || primaryId,
          destinationUrl: createdUrl,
        }
      );

      return { status: "existing", webhookId: webhookId || primaryId, webhookUrl: createdUrl };
    }
  } catch (error) {
    console.warn("Failed to list existing Fathom webhooks:", error);
  }

  try {
    const created = await createFathomWebhook(
      accessToken,
      webhookUrl,
      FATHOM_WEBHOOK_TRIGGERED_FOR
    );
    const { webhookId, createdUrl, merged } = upsertWebhook(
      created,
      installation,
      webhookUrl
    );
    await saveFathomInstallation({
      ...installation,
      webhookId,
      webhookUrl: createdUrl,
      webhookEvent: FATHOM_WEBHOOK_EVENT,
      webhookSecret: created.secret || created.webhook_secret || null,
      webhooks: merged,
      updatedAt: new Date(),
    });
    await logFathomIntegration(
      userId,
      "info",
      "webhook.create",
      "Webhook created.",
      {
        status: "created",
        webhookId,
        destinationUrl: createdUrl,
        include_action_items: created.include_action_items ?? null,
        include_summary: created.include_summary ?? null,
        include_transcript: created.include_transcript ?? null,
        include_crm_matches: created.include_crm_matches ?? null,
        triggered_for: created.triggered_for ?? null,
      }
    );
    try {
      const existingWebhooks = await listFathomWebhooks(accessToken);
      const matches = existingWebhooks.filter(
        (webhook: any) => getWebhookUrl(webhook) === createdUrl
      );
      if (matches.length > 1) {
        const duplicates = matches.filter(
          (webhook: any) => getWebhookId(webhook) !== webhookId
        );
        if (duplicates.length) {
          await Promise.allSettled(
            duplicates.map((webhook: any) =>
              deleteFathomWebhook(accessToken, webhook)
            )
          );
        }
      }
    } catch (error) {
      console.warn("Failed to cleanup duplicate Fathom webhooks:", error);
    }
    return { status: "created", webhookId, webhookUrl: createdUrl };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const triggerFallback =
      message.includes("triggered_for") ||
      message.includes("shared_with_me_external_recordings") ||
      message.includes("shared_external_recordings");
    const isDuplicate =
      message.includes("already") ||
      message.includes("duplicate") ||
      message.includes("exists") ||
      message.includes("taken") ||
      message.includes("409");

    if (triggerFallback) {
      try {
        const created = await createFathomWebhook(
          accessToken,
          webhookUrl,
          FATHOM_WEBHOOK_TRIGGERED_FOR_FALLBACK
        );
        const { webhookId, createdUrl, merged } = upsertWebhook(
          created,
          installation,
          webhookUrl
        );
        await saveFathomInstallation({
          ...installation,
          webhookId,
          webhookUrl: createdUrl,
          webhookEvent: FATHOM_WEBHOOK_EVENT,
          webhookSecret: created.secret || created.webhook_secret || null,
          webhooks: merged,
          updatedAt: new Date(),
        });
        await logFathomIntegration(
          userId,
          "info",
          "webhook.create",
          "Webhook created with fallback trigger.",
          {
            status: "created",
            webhookId,
            destinationUrl: createdUrl,
            include_action_items: created.include_action_items ?? null,
            include_summary: created.include_summary ?? null,
            include_transcript: created.include_transcript ?? null,
            include_crm_matches: created.include_crm_matches ?? null,
            triggered_for: created.triggered_for ?? null,
          }
        );
        try {
          const existingWebhooks = await listFathomWebhooks(accessToken);
          const matches = existingWebhooks.filter(
            (webhook: any) => getWebhookUrl(webhook) === createdUrl
          );
          if (matches.length > 1) {
            const duplicates = matches.filter(
              (webhook: any) => getWebhookId(webhook) !== webhookId
            );
            if (duplicates.length) {
              await Promise.allSettled(
                duplicates.map((webhook: any) =>
                  deleteFathomWebhook(accessToken, webhook)
                )
              );
            }
          }
        } catch (cleanupError) {
          console.warn(
            "Failed to cleanup duplicate Fathom webhooks after fallback:",
            cleanupError
          );
        }
        return { status: "created", webhookId, webhookUrl: createdUrl };
      } catch (fallbackError) {
        const fallbackMessage =
          fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        if (
          fallbackMessage.includes("already") ||
          fallbackMessage.includes("duplicate") ||
          fallbackMessage.includes("exists") ||
          fallbackMessage.includes("taken") ||
          fallbackMessage.includes("409")
        ) {
          const webhookId = installation.webhookId || null;
          const merged = mergeFallbackWebhook(installation, webhookId, webhookUrl);
          await saveFathomInstallation({
            ...installation,
            webhookUrl,
            webhookEvent: FATHOM_WEBHOOK_EVENT,
            webhookSecret: installation.webhookSecret || null,
            webhooks: merged,
            updatedAt: new Date(),
          });
          await logFathomIntegration(
            userId,
            "info",
            "webhook.create",
            "Webhook already exists.",
            {
              status: "existing",
              webhookId,
              destinationUrl: webhookUrl,
            }
          );
          return { status: "existing", webhookId, webhookUrl };
        }
        await logFathomIntegration(userId, "error", "webhook.create", "Webhook fallback creation failed.", {
          error: fallbackMessage,
        });
        throw fallbackError;
      }
    }

    if (!isDuplicate) {
      await logFathomIntegration(userId, "error", "webhook.create", "Webhook creation failed.", {
        error: message,
      });
      throw error;
    }

    const webhookId = installation.webhookId || null;
    const merged = mergeFallbackWebhook(installation, webhookId, webhookUrl);
    await saveFathomInstallation({
      ...installation,
      webhookUrl,
      webhookEvent: FATHOM_WEBHOOK_EVENT,
      webhookSecret: installation.webhookSecret || null,
      webhooks: merged,
      updatedAt: new Date(),
    });
    await logFathomIntegration(
      userId,
      "info",
      "webhook.create",
      "Webhook already exists.",
      {
        status: "existing",
        webhookId,
        destinationUrl: webhookUrl,
      }
    );
    return { status: "existing", webhookId, webhookUrl };
  }
};

export const ensureFathomConnectionWebhook = async (
  connectionId: string,
  accessToken: string,
  token: string,
  options: { updatedByUserId?: string | null } = {}
) => {
  const db = await getDb();
  const connection = await findFathomConnectionById(db as any, connectionId);
  if (!connection) {
    throw new Error("Fathom connection missing while creating webhook.");
  }

  const webhookUrl = getFathomWebhookUrl(token);
  const updatedByUserId =
    options.updatedByUserId || connection.updatedByUserId || connection.createdByUserId;

  const upsertWebhook = (
    created: any,
    current: FathomConnectionDoc,
    fallbackUrl: string
  ) => {
    const nextEntry = toConnectionManagedWebhook(created, fallbackUrl);
    const merged = mergeManagedWebhookEntries(
      nextEntry,
      current.webhook.managedWebhooks || []
    );
    return {
      webhookId: nextEntry.id || null,
      createdUrl: nextEntry.url || fallbackUrl,
      merged,
      secret: created?.secret || created?.webhook_secret || current.webhook.secret || null,
      event: current.webhook.webhookEvent || FATHOM_WEBHOOK_EVENT,
    };
  };

  const mergeFallbackWebhook = (
    current: FathomConnectionDoc,
    webhookId: string | null,
    currentWebhookUrl: string
  ) =>
    mergeManagedWebhookEntries(
      {
        id: webhookId,
        url: currentWebhookUrl,
        createdAt: current.updatedAt || current.createdAt || null,
        includeTranscript: null,
        includeSummary: null,
        includeActionItems: null,
        includeCrmMatches: null,
        triggeredFor: null,
      },
      current.webhook.managedWebhooks || []
    );

  try {
    const existingWebhooks = await listFathomWebhooks(accessToken);
    const matches = existingWebhooks.filter(
      (webhook: any) => getWebhookUrl(webhook) === webhookUrl
    );
    if (matches.length > 0) {
      const sorted = [...matches].sort((a: any, b: any) => {
        const aCreated = new Date(a.created_at || a.createdAt || 0).getTime();
        const bCreated = new Date(b.created_at || b.createdAt || 0).getTime();
        return bCreated - aCreated;
      });
      const primary = sorted[0];
      const { webhookId, createdUrl, merged, secret, event } = upsertWebhook(
        primary,
        connection,
        webhookUrl
      );

      const updatedConnection = await updateFathomConnectionById(db as any, connection._id, {
        updatedByUserId,
        webhook: {
          ...connection.webhook,
          token,
          secret,
          status: "active",
          webhookId,
          webhookUrl: createdUrl,
          webhookEvent: event,
          managedWebhooks: merged,
          lastSyncedAt: new Date(),
          lastError: null,
        },
      });

      if (updatedConnection) {
        await syncLegacyInstallationFromConnection(updatedConnection);
      }

      if (sorted.length > 1) {
        await Promise.allSettled(
          sorted.slice(1).map((webhook: any) =>
            deleteFathomWebhook(accessToken, webhook)
          )
        );
      }

      if (connection.legacyUserId) {
        await logFathomIntegration(
          connection.legacyUserId,
          "info",
          "webhook.create",
          "Webhook already exists.",
          {
            status: "existing",
            connectionId: connection._id,
            webhookId,
            destinationUrl: createdUrl,
          }
        );
      }

      return {
        status: "existing" as const,
        webhookId,
        webhookUrl: createdUrl,
        webhookSecret: secret,
        managedWebhooks: merged,
      };
    }
  } catch (error) {
    console.warn("Failed to list existing Fathom webhooks:", error);
  }

  try {
    const created = await createFathomWebhook(
      accessToken,
      webhookUrl,
      FATHOM_WEBHOOK_TRIGGERED_FOR
    );
    const { webhookId, createdUrl, merged, secret, event } = upsertWebhook(
      created,
      connection,
      webhookUrl
    );

    const updatedConnection = await updateFathomConnectionById(db as any, connection._id, {
      updatedByUserId,
      webhook: {
        ...connection.webhook,
        token,
        secret,
        status: "active",
        webhookId,
        webhookUrl: createdUrl,
        webhookEvent: event,
        managedWebhooks: merged,
        lastSyncedAt: new Date(),
        lastError: null,
      },
    });

    if (updatedConnection) {
      await syncLegacyInstallationFromConnection(updatedConnection);
    }

    if (connection.legacyUserId) {
      await logFathomIntegration(
        connection.legacyUserId,
        "info",
        "webhook.create",
        "Webhook created.",
        {
          status: "created",
          connectionId: connection._id,
          webhookId,
          destinationUrl: createdUrl,
          include_action_items: created.include_action_items ?? null,
          include_summary: created.include_summary ?? null,
          include_transcript: created.include_transcript ?? null,
          include_crm_matches: created.include_crm_matches ?? null,
          triggered_for: created.triggered_for ?? null,
        }
      );
    }

    try {
      const existingWebhooks = await listFathomWebhooks(accessToken);
      const matches = existingWebhooks.filter(
        (webhook: any) => getWebhookUrl(webhook) === createdUrl
      );
      if (matches.length > 1) {
        const duplicates = matches.filter(
          (webhook: any) => getWebhookId(webhook) !== webhookId
        );
        if (duplicates.length) {
          await Promise.allSettled(
            duplicates.map((webhook: any) =>
              deleteFathomWebhook(accessToken, webhook)
            )
          );
        }
      }
    } catch (error) {
      console.warn("Failed to cleanup duplicate Fathom webhooks:", error);
    }

    return {
      status: "created" as const,
      webhookId,
      webhookUrl: createdUrl,
      webhookSecret: secret,
      managedWebhooks: merged,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const triggerFallback =
      message.includes("triggered_for") ||
      message.includes("shared_with_me_external_recordings") ||
      message.includes("shared_external_recordings");
    const isDuplicate =
      message.includes("already") ||
      message.includes("duplicate") ||
      message.includes("exists") ||
      message.includes("taken") ||
      message.includes("409");

    if (triggerFallback) {
      try {
        const created = await createFathomWebhook(
          accessToken,
          webhookUrl,
          FATHOM_WEBHOOK_TRIGGERED_FOR_FALLBACK
        );
        const { webhookId, createdUrl, merged, secret, event } = upsertWebhook(
          created,
          connection,
          webhookUrl
        );

        const updatedConnection = await updateFathomConnectionById(
          db as any,
          connection._id,
          {
            updatedByUserId,
            webhook: {
              ...connection.webhook,
              token,
              secret,
              status: "active",
              webhookId,
              webhookUrl: createdUrl,
              webhookEvent: event,
              managedWebhooks: merged,
              lastSyncedAt: new Date(),
              lastError: null,
            },
          }
        );

        if (updatedConnection) {
          await syncLegacyInstallationFromConnection(updatedConnection);
        }

        if (connection.legacyUserId) {
          await logFathomIntegration(
            connection.legacyUserId,
            "info",
            "webhook.create",
            "Webhook created with fallback trigger.",
            {
              status: "created",
              connectionId: connection._id,
              webhookId,
              destinationUrl: createdUrl,
              include_action_items: created.include_action_items ?? null,
              include_summary: created.include_summary ?? null,
              include_transcript: created.include_transcript ?? null,
              include_crm_matches: created.include_crm_matches ?? null,
              triggered_for: created.triggered_for ?? null,
            }
          );
        }

        try {
          const existingWebhooks = await listFathomWebhooks(accessToken);
          const matches = existingWebhooks.filter(
            (webhook: any) => getWebhookUrl(webhook) === createdUrl
          );
          if (matches.length > 1) {
            const duplicates = matches.filter(
              (webhook: any) => getWebhookId(webhook) !== webhookId
            );
            if (duplicates.length) {
              await Promise.allSettled(
                duplicates.map((webhook: any) =>
                  deleteFathomWebhook(accessToken, webhook)
                )
              );
            }
          }
        } catch (cleanupError) {
          console.warn(
            "Failed to cleanup duplicate Fathom webhooks after fallback:",
            cleanupError
          );
        }

        return {
          status: "created" as const,
          webhookId,
          webhookUrl: createdUrl,
          webhookSecret: secret,
          managedWebhooks: merged,
        };
      } catch (fallbackError) {
        const fallbackMessage =
          fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        if (
          fallbackMessage.includes("already") ||
          fallbackMessage.includes("duplicate") ||
          fallbackMessage.includes("exists") ||
          fallbackMessage.includes("taken") ||
          fallbackMessage.includes("409")
        ) {
          const webhookId = connection.webhook.webhookId || null;
          const merged = mergeFallbackWebhook(connection, webhookId, webhookUrl);
          const updatedConnection = await updateFathomConnectionById(db as any, connection._id, {
            updatedByUserId,
            webhook: {
              ...connection.webhook,
              token,
              status: "active",
              webhookUrl,
              webhookEvent: connection.webhook.webhookEvent || FATHOM_WEBHOOK_EVENT,
              managedWebhooks: merged,
              lastSyncedAt: new Date(),
              lastError: null,
            },
          });

          if (updatedConnection) {
            await syncLegacyInstallationFromConnection(updatedConnection);
          }

          if (connection.legacyUserId) {
            await logFathomIntegration(
              connection.legacyUserId,
              "info",
              "webhook.create",
              "Webhook already exists.",
              {
                status: "existing",
                connectionId: connection._id,
                webhookId,
                destinationUrl: webhookUrl,
              }
            );
          }

          return {
            status: "existing" as const,
            webhookId,
            webhookUrl,
            webhookSecret: connection.webhook.secret || null,
            managedWebhooks: merged,
          };
        }

        if (connection.legacyUserId) {
          await logFathomIntegration(
            connection.legacyUserId,
            "error",
            "webhook.create",
            "Webhook fallback creation failed.",
            {
              connectionId: connection._id,
              error: fallbackMessage,
            }
          );
        }
        throw fallbackError;
      }
    }

    if (!isDuplicate) {
      if (connection.legacyUserId) {
        await logFathomIntegration(
          connection.legacyUserId,
          "error",
          "webhook.create",
          "Webhook creation failed.",
          {
            connectionId: connection._id,
            error: message,
          }
        );
      }
      throw error;
    }

    const webhookId = connection.webhook.webhookId || null;
    const merged = mergeFallbackWebhook(connection, webhookId, webhookUrl);
    const updatedConnection = await updateFathomConnectionById(db as any, connection._id, {
      updatedByUserId,
      webhook: {
        ...connection.webhook,
        token,
        status: "active",
        webhookUrl,
        webhookEvent: connection.webhook.webhookEvent || FATHOM_WEBHOOK_EVENT,
        managedWebhooks: merged,
        lastSyncedAt: new Date(),
        lastError: null,
      },
    });

    if (updatedConnection) {
      await syncLegacyInstallationFromConnection(updatedConnection);
    }

    if (connection.legacyUserId) {
      await logFathomIntegration(
        connection.legacyUserId,
        "info",
        "webhook.create",
        "Webhook already exists.",
        {
          status: "existing",
          connectionId: connection._id,
          webhookId,
          destinationUrl: webhookUrl,
        }
      );
    }

    return {
      status: "existing" as const,
      webhookId,
      webhookUrl,
      webhookSecret: connection.webhook.secret || null,
      managedWebhooks: merged,
    };
  }
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



