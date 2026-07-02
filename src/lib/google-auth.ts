import { findUserById, updateUserById } from "@/lib/db/users";
import { logGoogleIntegration } from "@/lib/google-logs";
import { recordExternalApiFailure } from "@/lib/observability-metrics";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const TOKEN_SKEW_MS = 60_000;

type GoogleTokenResponse = {
  access_token: string;
  expires_in: number;
  scope?: string;
  token_type?: string;
};

export type GoogleRevokeResult = {
  revokedUserId: string;
  remotelyRevoked: boolean;
  warning?: string;
};

const resolveWorkspaceIdFromUser = (user: {
  activeWorkspaceId?: string | null;
  workspace?: { id?: string | null };
}) => {
  const activeWorkspaceId = user.activeWorkspaceId?.trim();
  if (activeWorkspaceId) {
    return activeWorkspaceId;
  }
  const legacyWorkspaceId = user.workspace?.id?.trim();
  return legacyWorkspaceId || null;
};

const isAlreadyRevokedError = (value: unknown) =>
  typeof value === "string" && value.toLowerCase().includes("invalid_token");

const getEnv = (key: string) => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing ${key} environment variable.`);
  }
  return value;
};

export const getGoogleAccessTokenForUser = async (
  userId: string,
  context?: { correlationId?: string | null; workspaceId?: string | null; actorUserId?: string | null }
): Promise<string | null> => {
  const user = await findUserById(userId);
  if (!user || !user.googleConnected) {
    return null;
  }
  const workspaceId = context?.workspaceId || resolveWorkspaceIdFromUser(user);

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
    await logGoogleIntegration({
      workspaceId,
      userId,
      actorUserId: context?.actorUserId || userId,
      level: "error",
      event: "oauth.token.refresh.failed",
      message: "Google token refresh failed due to a network/runtime error.",
      metadata: {
        error: error instanceof Error ? error.message : String(error),
      },
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
    await logGoogleIntegration({
      workspaceId,
      userId,
      actorUserId: context?.actorUserId || userId,
      level: "error",
      event: "oauth.token.refresh.failed",
      message: payload?.error || "Google token refresh failed.",
      metadata: {
        statusCode: response.status,
        response: payload,
      },
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
  context?: { correlationId?: string | null; workspaceId?: string | null; actorUserId?: string | null }
): Promise<GoogleRevokeResult> => {
  const user = await findUserById(userId);
  if (!user) {
    return {
      revokedUserId: userId,
      remotelyRevoked: false,
      warning: "User not found.",
    };
  }

  const workspaceId = context?.workspaceId || resolveWorkspaceIdFromUser(user);
  const actorUserId = context?.actorUserId || userId;

  const tokenToRevoke = user.googleRefreshToken || user.googleAccessToken;
  let remotelyRevoked = false;
  let warning: string | undefined;

  await logGoogleIntegration({
    workspaceId,
    userId,
    actorUserId,
    level: "info",
    event: "oauth.token.revoke.attempt",
    message: "Attempting to revoke Google integration credentials.",
    metadata: {
      hasRemoteToken: Boolean(tokenToRevoke),
    },
  });

  if (tokenToRevoke) {
    const revokeStartedAtMs = Date.now();
    let response: Response | null = null;
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
      warning = error instanceof Error ? error.message : "Remote revoke request failed.";
      await logGoogleIntegration({
        workspaceId,
        userId,
        actorUserId,
        level: "warn",
        event: "oauth.token.revoke.warning",
        message: "Google remote revoke failed. Local credentials will still be cleared.",
        metadata: {
          error: warning,
        },
      });
    }

    if (response && !response.ok) {
      const payload = await response.text().catch(() => "");
      if (isAlreadyRevokedError(payload)) {
        remotelyRevoked = true;
      } else {
        void recordExternalApiFailure({
          provider: "google",
          operation: "oauth.token.revoke",
          userId,
          correlationId: context?.correlationId,
          durationMs: Date.now() - revokeStartedAtMs,
          statusCode: response.status,
          error: payload || response.statusText,
        });
        warning = payload || response.statusText || "Failed to revoke Google token remotely.";
      }
    } else if (response?.ok) {
      remotelyRevoked = true;
    }
  }

  await updateUserById(userId, {
    googleAccessToken: null,
    googleRefreshToken: null,
    googleTokenExpiry: null,
    googleScopes: null,
    googleConnected: false,
  });

  await logGoogleIntegration({
    workspaceId,
    userId,
    actorUserId,
    level: warning ? "warn" : "info",
    event: warning ? "oauth.token.revoke.completed_with_warning" : "oauth.token.revoke.completed",
    message: warning
      ? "Google credentials were cleared locally, but remote revoke returned a warning."
      : "Google credentials were revoked successfully.",
    metadata: {
      remotelyRevoked,
      hasRemoteToken: Boolean(tokenToRevoke),
      warning: warning || null,
    },
  });

  return {
    revokedUserId: userId,
    remotelyRevoked,
    ...(warning ? { warning } : {}),
  };
};
