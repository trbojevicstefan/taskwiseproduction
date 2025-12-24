import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { findUserById, updateUserById } from "@/lib/db/users";
import {
  consumeFathomOAuthState,
  getFathomRedirectUri,
  saveFathomInstallation,
} from "@/lib/fathom";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const baseUrl =
    process.env.NEXTAUTH_URL || `${url.protocol}//${url.host}`;
  const redirectToSettings = (params: Record<string, string>) => {
    const query = new URLSearchParams(params);
    return NextResponse.redirect(`${baseUrl}/settings?${query.toString()}`);
  };

  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const state = url.searchParams.get("state");

  if (error) {
    return redirectToSettings({
      error: "fathom_oauth_failed",
      message: error,
    });
  }

  if (!code || !state) {
    return redirectToSettings({
      error: "fathom_callback_failed",
      message: "Missing OAuth parameters.",
    });
  }

  const userId = await consumeFathomOAuthState(state);
  if (!userId) {
    return redirectToSettings({
      error: "fathom_callback_failed",
      message: "Invalid or expired OAuth state.",
    });
  }

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
    redirect_uri: getFathomRedirectUri(),
  });

  try {
    const response = await fetch(
      "https://fathom.video/external/v1/oauth2/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      }
    );

    const payload = (await response.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
      user_id?: string;
      error?: string;
    };

    if (!payload.access_token) {
      return redirectToSettings({
        error: "fathom_oauth_failed",
        message: payload.error || "Fathom OAuth exchange failed.",
      });
    }

    await saveFathomInstallation({
      _id: userId,
      userId,
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token || null,
      expiresAt: payload.expires_in
        ? Date.now() + payload.expires_in * 1000
        : null,
      scope: payload.scope || null,
      fathomUserId: payload.user_id || null,
      updatedAt: new Date(),
    });

    const user = await findUserById(userId);
    const existingToken = user?.fathomWebhookToken || null;
    const webhookToken =
      existingToken || randomBytes(24).toString("hex");

    await updateUserById(userId, {
      fathomWebhookToken: webhookToken,
      fathomConnected: true,
    });

    return redirectToSettings({ fathom_success: "true" });
  } catch (err) {
    console.error("Fathom OAuth callback error:", err);
    return redirectToSettings({
      error: "fathom_callback_failed",
      message: "Unexpected Fathom OAuth error.",
    });
  }
}
