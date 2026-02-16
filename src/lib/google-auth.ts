import { findUserById, updateUserById } from "@/lib/db/users";
import { recordExternalApiFailure } from "@/lib/observability-metrics";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const TOKEN_SKEW_MS = 60_000;

type GoogleTokenResponse = {
  access_token: string;
  expires_in: number;
  scope?: string;
  token_type?: string;
};

const getEnv = (key: string) => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing ${key} environment variable.`);
  }
  return value;
};

export const getGoogleAccessTokenForUser = async (
  userId: string,
  context?: { correlationId?: string | null }
): Promise<string | null> => {
  const user = await findUserById(userId);
  if (!user || !user.googleConnected) {
    return null;
  }

  const now = Date.now();
  if (user.googleAccessToken && user.googleTokenExpiry) {
    if (now < user.googleTokenExpiry - TOKEN_SKEW_MS) {
      return user.googleAccessToken;
    }
  }

  if (!user.googleRefreshToken) {
    return user.googleAccessToken || null;
  }

  const clientId = getEnv("GOOGLE_INTEGRATION_CLIENT_ID");
  const clientSecret = getEnv("GOOGLE_INTEGRATION_CLIENT_SECRET");

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: user.googleRefreshToken,
    grant_type: "refresh_token",
  });

  const refreshStartedAtMs = Date.now();
  let response: Response;
  try {
    response = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
  } catch (error) {
    void recordExternalApiFailure({
      provider: "google",
      operation: "oauth.token.refresh",
      userId,
      correlationId: context?.correlationId,
      durationMs: Date.now() - refreshStartedAtMs,
      error,
    });
    throw error;
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    void recordExternalApiFailure({
      provider: "google",
      operation: "oauth.token.refresh",
      userId,
      correlationId: context?.correlationId,
      durationMs: Date.now() - refreshStartedAtMs,
      statusCode: response.status,
      error: payload?.error || "Failed to refresh Google access token.",
      metadata: payload,
    });
    throw new Error(payload.error || "Failed to refresh Google access token.");
  }

  const data = (await response.json()) as GoogleTokenResponse;
  const expiry = Date.now() + data.expires_in * 1000;

  await updateUserById(userId, {
    googleAccessToken: data.access_token,
    googleTokenExpiry: expiry,
    ...(data.scope ? { googleScopes: data.scope } : {}),
    googleConnected: true,
  });

  return data.access_token;
};

export const revokeGoogleTokensForUser = async (
  userId: string,
  context?: { correlationId?: string | null }
) => {
  const user = await findUserById(userId);
  if (!user) return;

  const tokenToRevoke = user.googleRefreshToken || user.googleAccessToken;
  if (tokenToRevoke) {
    const revokeStartedAtMs = Date.now();
    let response: Response;
    try {
      response = await fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: tokenToRevoke }).toString(),
      });
    } catch (error) {
      void recordExternalApiFailure({
        provider: "google",
        operation: "oauth.token.revoke",
        userId,
        correlationId: context?.correlationId,
        durationMs: Date.now() - revokeStartedAtMs,
        error,
      });
      throw error;
    }

    if (!response.ok) {
      const payload = await response.text().catch(() => "");
      void recordExternalApiFailure({
        provider: "google",
        operation: "oauth.token.revoke",
        userId,
        correlationId: context?.correlationId,
        durationMs: Date.now() - revokeStartedAtMs,
        statusCode: response.status,
        error: payload || response.statusText,
      });
      throw new Error(payload || "Failed to revoke Google token.");
    }
  }

  await updateUserById(userId, {
    googleAccessToken: null,
    googleRefreshToken: null,
    googleTokenExpiry: null,
    googleScopes: null,
    googleConnected: false,
  });
};
