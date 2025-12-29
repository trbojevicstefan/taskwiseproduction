import { findUserById, updateUserById } from "@/lib/db/users";

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
  userId: string
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

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
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

export const revokeGoogleTokensForUser = async (userId: string) => {
  const user = await findUserById(userId);
  if (!user) return;

  const tokenToRevoke = user.googleRefreshToken || user.googleAccessToken;
  if (tokenToRevoke) {
    await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: tokenToRevoke }).toString(),
    });
  }

  await updateUserById(userId, {
    googleAccessToken: null,
    googleRefreshToken: null,
    googleTokenExpiry: null,
    googleScopes: null,
    googleConnected: false,
  });
};
