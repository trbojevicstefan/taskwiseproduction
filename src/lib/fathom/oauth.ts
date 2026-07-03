import { randomBytes } from "crypto";
import { getDb } from "@/lib/db";
import {
  findFathomConnectionById,
  type FathomConnectionDoc,
  updateFathomConnectionById,
} from "@/lib/fathom-connections";
import { buildLegacyFathomInstallation } from "@/lib/fathom-installation-helpers";
import { recordExternalApiFailure } from "@/lib/observability-metrics";
import type { FathomInstallationDoc } from "@/lib/fathom/types";

const INSTALLATIONS_COLLECTION = "fathomInstallations";
const OAUTH_STATE_COLLECTION = "fathomOauthStates";

const getFathomClientCredentials = () => ({
  clientId: process.env.FATHOM_CLIENT_ID || null,
  clientSecret: process.env.FATHOM_CLIENT_SECRET || null,
});

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

export const consumeFathomOAuthState = async (state: string): Promise<string | null> => {
  const db = await getDb();
  const record = await db.collection(OAUTH_STATE_COLLECTION).findOne({ _id: state });
  if (!record) return null;
  await db.collection(OAUTH_STATE_COLLECTION).deleteOne({ _id: state });
  return record.userId;
};

export const getFathomInstallation = async (
  userId: string
): Promise<FathomInstallationDoc | null> => {
  const db = await getDb();
  return db.collection(INSTALLATIONS_COLLECTION).findOne({ _id: userId });
};

export const saveFathomInstallation = async (installation: FathomInstallationDoc) => {
  const db = await getDb();
  const { createdAt, ...rest } = installation;
  await db.collection(INSTALLATIONS_COLLECTION).updateOne(
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
  const { clientId, clientSecret } = getFathomClientCredentials();
  if (!clientId || !clientSecret) {
    throw new Error("Fathom client credentials are not configured.");
  }
  if (!installation.refreshToken) {
    throw new Error("Missing Fathom refresh token.");
  }

  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: installation.refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });

  let response: Response;
  try {
    response = await fetch("https://fathom.video/external/v1/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    });
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
    expiresAt: payload.expires_in ? Date.now() + payload.expires_in * 1000 : installation.expiresAt || null,
    scope: payload.scope || installation.scope || null,
    updatedAt: new Date(),
  };

  await saveFathomInstallation(updated);
  return updated.accessToken;
};

const refreshFathomConnectionToken = async (connection: FathomConnectionDoc) => {
  const { clientId, clientSecret } = getFathomClientCredentials();
  if (!clientId || !clientSecret) {
    throw new Error("Fathom client credentials are not configured.");
  }
  if (!connection.oauth.refreshToken) {
    throw new Error("Missing Fathom refresh token.");
  }

  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: connection.oauth.refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });

  let response: Response;
  try {
    response = await fetch("https://fathom.video/external/v1/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    });
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
      expiresAt: payload.expires_in ? Date.now() + payload.expires_in * 1000 : connection.oauth.expiresAt || null,
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
    expiresAt: payload.expires_in ? Date.now() + payload.expires_in * 1000 : connection.oauth.expiresAt || null,
    scope: payload.scope || connection.oauth.scope || null,
  });

  return payload.access_token;
};

export const getValidFathomAccessToken = async (userId: string): Promise<string> => {
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
