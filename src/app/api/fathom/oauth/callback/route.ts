import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { getDb } from "@/lib/db";
import {
  consumeFathomConnectionOAuthState,
  createFathomConnection,
  findFathomConnectionById,
  listFathomConnectionsForWorkspace,
  updateFathomConnectionById,
} from "@/lib/fathom-connections";
import {
  ensureFathomConnectionWebhook,
  getFathomRedirectUri,
} from "@/lib/fathom";
import { logFathomIntegration } from "@/lib/fathom-logs";

const buildConnectionLabel = async (
  db: Awaited<ReturnType<typeof getDb>>,
  workspaceId: string,
  requestedLabel?: string | null,
  existingConnectionId?: string | null
) => {
  const baseLabel = requestedLabel?.trim() || "Fathom";
  const connections = await listFathomConnectionsForWorkspace(db as any, workspaceId);
  const takenLabels = new Set(
    connections
      .filter((connection) => connection._id !== existingConnectionId)
      .map((connection) => connection.label)
  );

  if (!takenLabels.has(baseLabel)) {
    return baseLabel;
  }

  let suffix = 2;
  while (takenLabels.has(`${baseLabel} ${suffix}`)) {
    suffix += 1;
  }
  return `${baseLabel} ${suffix}`;
};

const upsertWorkspaceFathomConnection = async (
  db: Awaited<ReturnType<typeof getDb>>,
  input: {
    workspaceId: string;
    userId: string;
    connectionId?: string | null;
    requestedLabel?: string | null;
    accessToken: string;
    refreshToken?: string | null;
    expiresAt?: number | null;
    scope?: string | null;
    providerUserId?: string | null;
    webhookToken: string;
  }
) => {
  const existingConnection = input.connectionId
    ? await findFathomConnectionById(db as any, input.connectionId)
    : null;
  const allConnections = existingConnection
    ? []
    : await listFathomConnectionsForWorkspace(db as any, input.workspaceId);
  const matchedConnection =
    existingConnection ||
    allConnections.find(
      (connection) =>
        connection.status !== "revoked" &&
        connection.source.providerUserId &&
        connection.source.providerUserId === input.providerUserId
    ) ||
    allConnections.find(
      (connection) =>
        connection.status !== "revoked" &&
        connection.createdByUserId === input.userId &&
        !connection.source.providerUserId
    ) ||
    null;

  const label = await buildConnectionLabel(
    db,
    input.workspaceId,
    matchedConnection?.label || input.requestedLabel,
    matchedConnection?._id || null
  );

  if (matchedConnection) {
    return updateFathomConnectionById(db as any, matchedConnection._id, {
      label,
      status: "active",
      updatedByUserId: input.userId,
      legacyUserId: input.userId,
      oauth: {
        accessToken: input.accessToken,
        refreshToken: input.refreshToken || null,
        expiresAt: input.expiresAt || null,
        scope: input.scope || null,
        stateId: null,
        connectedAt: new Date(),
        lastRefreshedAt: null,
        lastError: null,
      },
      webhook: {
        token: input.webhookToken,
        secret: matchedConnection.webhook.secret || null,
        status: "not_configured",
        webhookId: matchedConnection.webhook.webhookId || null,
        webhookUrl: matchedConnection.webhook.webhookUrl || null,
        webhookEvent: matchedConnection.webhook.webhookEvent || null,
        managedWebhooks: matchedConnection.webhook.managedWebhooks || [],
        lastSyncedAt: null,
        lastError: null,
      },
      source: {
        providerUserId: input.providerUserId || null,
        providerAccountId: matchedConnection.source.providerAccountId || null,
        providerSourceIds: matchedConnection.source.providerSourceIds || [],
      },
      sync: {
        lastAttemptedAt: null,
        lastSucceededAt: matchedConnection.sync.lastSucceededAt || null,
        lastError: null,
      },
      revokedAt: null,
    });
  }

  return createFathomConnection(db as any, {
    workspaceId: input.workspaceId,
    label,
    createdByUserId: input.userId,
    updatedByUserId: input.userId,
    status: "active",
    legacyUserId: input.userId,
    oauth: {
      accessToken: input.accessToken,
      refreshToken: input.refreshToken || null,
      expiresAt: input.expiresAt || null,
      scope: input.scope || null,
      stateId: null,
      connectedAt: new Date(),
      lastRefreshedAt: null,
      lastError: null,
    },
    webhook: {
      token: input.webhookToken,
      secret: null,
      status: "not_configured",
      webhookId: null,
      webhookUrl: null,
      webhookEvent: null,
      managedWebhooks: [],
      lastSyncedAt: null,
      lastError: null,
    },
    source: {
      providerUserId: input.providerUserId || null,
      providerAccountId: null,
      providerSourceIds: [],
    },
    sync: {
      lastAttemptedAt: null,
      lastSucceededAt: null,
      lastError: null,
    },
  });
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const baseUrl = process.env.NEXTAUTH_URL || `${url.protocol}//${url.host}`;
  const redirectToSettings = (params: Record<string, string>) => {
    const query = new URLSearchParams(params);
    return NextResponse.redirect(`${baseUrl}/settings?${query.toString()}`);
  };

  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const errorDescription = url.searchParams.get("error_description");
  const state = url.searchParams.get("state");
  const redirectUri = getFathomRedirectUri();

  const db = await getDb();

  if (error) {
    if (state) {
      const stateDoc = await consumeFathomConnectionOAuthState(db as any, state);
      if (stateDoc?.userId) {
        await logFathomIntegration(
          stateDoc.userId,
          "error",
          "oauth.callback",
          "Fathom OAuth error from provider.",
          { error, errorDescription, workspaceId: stateDoc.workspaceId }
        );
      }
    }
    return redirectToSettings({
      error: "fathom_oauth_failed",
      message: errorDescription || error || "OAuth provider returned an error.",
    });
  }

  if (!code || !state) {
    return redirectToSettings({
      error: "fathom_callback_failed",
      message: "Missing OAuth parameters.",
    });
  }

  const stateDoc = await consumeFathomConnectionOAuthState(db as any, state);
  if (!stateDoc) {
    return redirectToSettings({
      error: "fathom_callback_failed",
      message: "Invalid or expired OAuth state.",
    });
  }

  const userId = stateDoc.userId;
  if (!process.env.FATHOM_CLIENT_ID || !process.env.FATHOM_CLIENT_SECRET) {
    return redirectToSettings({
      error: "fathom_callback_failed",
      message: "Fathom client credentials are not configured.",
    });
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: process.env.FATHOM_CLIENT_ID,
    client_secret: process.env.FATHOM_CLIENT_SECRET,
    redirect_uri: redirectUri,
  });

  try {
    const response = await fetch("https://fathom.video/external/v1/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    const payload = (await response.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
      user_id?: string;
      error?: string;
      error_description?: string;
    };

    if (!payload.access_token) {
      return redirectToSettings({
        error: "fathom_oauth_failed",
        message:
          payload.error_description || payload.error || "Fathom OAuth exchange failed.",
      });
    }

    const webhookToken = randomBytes(24).toString("hex");
    const connection = await upsertWorkspaceFathomConnection(db, {
      workspaceId: stateDoc.workspaceId,
      userId,
      connectionId: stateDoc.connectionId || null,
      requestedLabel: stateDoc.label || null,
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token || null,
      expiresAt: payload.expires_in ? Date.now() + payload.expires_in * 1000 : null,
      scope: payload.scope || null,
      providerUserId: payload.user_id || null,
      webhookToken,
    });
    if (!connection) {
      throw new Error("Failed to persist Fathom connection.");
    }

    let webhookStatus = "unknown";
    let webhookErrorMessage: string | null = null;
    try {
      const result = await ensureFathomConnectionWebhook(
        connection._id,
        payload.access_token,
        webhookToken,
        { updatedByUserId: userId }
      );
      webhookStatus = result.status;
      await updateFathomConnectionById(db as any, connection?._id || stateDoc.connectionId || "", {
        status: "active",
        updatedByUserId: userId,
        webhook: {
          token: webhookToken,
          secret: result.webhookSecret || null,
          status: "active",
          webhookId: result.webhookId || null,
          webhookUrl: result.webhookUrl || null,
          webhookEvent: "new-meeting-content-ready",
          managedWebhooks: result.managedWebhooks || [],
          lastSyncedAt: new Date(),
          lastError: null,
        },
      });
    } catch (webhookError) {
      const message =
        webhookError instanceof Error ? webhookError.message : String(webhookError);
      webhookStatus = "failed";
      webhookErrorMessage = message;
      await updateFathomConnectionById(db as any, connection?._id || stateDoc.connectionId || "", {
        updatedByUserId: userId,
        webhook: {
          token: webhookToken,
          secret: connection?.webhook.secret || null,
          status: "error",
          webhookId: connection?.webhook.webhookId || null,
          webhookUrl: connection?.webhook.webhookUrl || null,
          webhookEvent: connection?.webhook.webhookEvent || null,
          managedWebhooks: connection?.webhook.managedWebhooks || [],
          lastSyncedAt: new Date(),
          lastError: { message },
        },
      });
      console.error("Fathom webhook setup failed:", webhookError);
    }

    await logFathomIntegration(
      userId,
      "info",
      "oauth.callback",
      "Fathom OAuth completed.",
      {
        workspaceId: stateDoc.workspaceId,
        connectionId: connection?._id || null,
        webhookStatus,
      }
    );

    return redirectToSettings({
      fathom_success: "true",
      fathom_webhook: webhookStatus,
      ...(webhookErrorMessage ? { fathom_webhook_error: webhookErrorMessage } : {}),
    });
  } catch (err) {
    console.error("Fathom OAuth callback error:", err);
    await logFathomIntegration(
      userId,
      "error",
      "oauth.callback",
      "Fathom OAuth callback failed.",
      { error: err instanceof Error ? err.message : String(err), workspaceId: stateDoc.workspaceId }
    );
    return redirectToSettings({
      error: "fathom_callback_failed",
      message: "Unexpected Fathom OAuth error.",
    });
  }
}
