import type { FathomConnectionDoc } from "@/lib/fathom-connections";

export type FathomInstallationRefreshSource = {
  _id?: string;
  userId: string;
  accessToken?: string;
  refreshToken?: string | null;
  expiresAt?: number | null;
  scope?: string | null;
  updatedAt?: Date;
};

export type FathomRefreshPayload = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
};

export const buildFathomRefreshRequestParams = (
  refreshToken: string,
  clientId: string,
  clientSecret: string
) =>
  new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });

export const applyFathomInstallationRefresh = (
  installation: FathomInstallationRefreshSource,
  payload: FathomRefreshPayload
) => ({
  ...installation,
  _id: installation._id || installation.userId,
  accessToken: payload.access_token || installation.accessToken || "",
  refreshToken: payload.refresh_token || installation.refreshToken || null,
  expiresAt: payload.expires_in
    ? Date.now() + payload.expires_in * 1000
    : installation.expiresAt || null,
  scope: payload.scope || installation.scope || null,
  updatedAt: new Date(),
});

export const applyFathomConnectionRefresh = (
  connection: FathomConnectionDoc,
  payload: FathomRefreshPayload
) => ({
  oauth: {
    ...connection.oauth,
    accessToken: payload.access_token || connection.oauth.accessToken || "",
    refreshToken: payload.refresh_token || connection.oauth.refreshToken || null,
    expiresAt: payload.expires_in
      ? Date.now() + payload.expires_in * 1000
      : connection.oauth.expiresAt || null,
    scope: payload.scope || connection.oauth.scope || null,
    lastRefreshedAt: new Date(),
    lastError: null,
  },
});
