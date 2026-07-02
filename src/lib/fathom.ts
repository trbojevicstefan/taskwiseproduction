import { randomBytes } from "crypto";
import { getDb } from "@/lib/db";
import {
  findFathomConnectionById,
  type FathomConnectionDoc,
  updateFathomConnectionById,
} from "@/lib/fathom-connections";
import type { FathomInstallationDoc } from "@/lib/fathom/types";
import { logFathomIntegration } from "@/lib/fathom-logs";
import { recordExternalApiFailure } from "@/lib/observability-metrics";
import {
  buildWebhookBody,
  getWebhookId,
  getWebhookUrl,
} from "@/lib/fathom-webhook-helpers";
import { buildLegacyFathomInstallation } from "@/lib/fathom-installation-helpers";
import {
  buildConnectionWebhookUpsert,
  buildLegacyWebhookUpsert,
} from "@/lib/fathom-webhook-sync-helpers";
import {
  applyFathomConnectionRefresh,
  applyFathomInstallationRefresh,
  buildFathomRefreshRequestParams,
} from "@/lib/fathom-oauth-helpers";
import {
  FATHOM_WEBHOOK_EVENT,
  FATHOM_WEBHOOK_TRIGGERED_FOR,
  getFathomWebhookUrl,
} from "@/lib/fathom-utils";
import {
  deleteFathomWebhook,
} from "@/lib/fathom-webhooks";
export { FATHOM_SCOPES } from "@/lib/fathom-utils";
export {
  FATHOM_WEBHOOK_EVENT,
  FATHOM_WEBHOOK_TRIGGERED_FOR,
  extractFathomProviderSourceId,
  formatFathomTranscript,
  getFathomPublicBaseUrl,
  getFathomRedirectUri,
  getFathomRecordingHashScope,
  getFathomWebhookUrl,
  getFathomWebhookUrlPrefix,
  hashFathomRecordingId,
} from "@/lib/fathom-utils";
export { deleteFathomWebhook, pruneFathomManagedWebhooks } from "@/lib/fathom-webhooks";
export type { FathomInstallationDoc } from "@/lib/fathom/types";

const INSTALLATIONS_COLLECTION = "fathomInstallations";
const OAUTH_STATE_COLLECTION = "fathomOauthStates";

const FATHOM_CLIENT_ID = process.env.FATHOM_CLIENT_ID;
const FATHOM_CLIENT_SECRET = process.env.FATHOM_CLIENT_SECRET;
const FATHOM_WEBHOOK_TRIGGERED_FOR_FALLBACK = [
  "my_recordings",
  "shared_external_recordings",
  "my_shared_with_team_recordings",
  "shared_team_recordings",
] as const;
const syncLegacyInstallationFromConnection = async (
  connection: FathomConnectionDoc,
  overrides: Partial<FathomInstallationDoc> = {}
) => {
  if (!connection.legacyUserId) return null;
  const userId = connection.legacyUserId;
  const existing = await getFathomInstallation(userId);

  const installation = buildLegacyFathomInstallation(connection, existing as any, overrides);
  if (!installation) {
    return existing;
  }

  await saveFathomInstallation(installation);
  return installation;
};

export const createFathomOAuthState = async (userId: string): Promise<string> => {
  const db = await getDb();
  const state = randomBytes(24).toString("hex");
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

  const params = buildFathomRefreshRequestParams(
    installation.refreshToken,
    FATHOM_CLIENT_ID,
    FATHOM_CLIENT_SECRET
  );

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

  const updated = applyFathomInstallationRefresh(installation, payload);

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

  const params = buildFathomRefreshRequestParams(
    connection.oauth.refreshToken,
    FATHOM_CLIENT_ID,
    FATHOM_CLIENT_SECRET
  );

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
    ...applyFathomConnectionRefresh(connection, payload),
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
      const { webhookId, createdUrl, merged } = buildLegacyWebhookUpsert(
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
    const { webhookId, createdUrl, merged } = buildLegacyWebhookUpsert(
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
        const { webhookId, createdUrl, merged } = buildLegacyWebhookUpsert(
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
          const { merged } = buildLegacyWebhookUpsert(
            {
              id: webhookId,
              url: webhookUrl,
              createdAt: installation.updatedAt || installation.createdAt || null,
            },
            installation,
            webhookUrl
          );
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
    const { merged } = buildLegacyWebhookUpsert(
      {
        id: webhookId,
        url: webhookUrl,
        createdAt: installation.updatedAt || installation.createdAt || null,
      },
      installation,
      webhookUrl
    );
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
      const { webhookId, createdUrl, merged, secret, event } = buildConnectionWebhookUpsert(
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
    const { webhookId, createdUrl, merged, secret, event } = buildConnectionWebhookUpsert(
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
        const { webhookId, createdUrl, merged, secret, event } = buildConnectionWebhookUpsert(
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
          const { merged } = buildConnectionWebhookUpsert(
            {
              id: webhookId,
              url: webhookUrl,
              secret: connection.webhook.secret || null,
            },
            connection as any,
            webhookUrl
          );
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
    const { merged } = buildConnectionWebhookUpsert(
      {
        id: webhookId,
        url: webhookUrl,
        secret: connection.webhook.secret || null,
      },
      connection as any,
      webhookUrl
    );
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

