import { NextResponse } from "next/server";
import { updateUserById } from "@/lib/db/users";
import {
  consumeSlackOAuthState,
  getSlackRedirectUri,
  saveSlackInstallation,
} from "@/lib/slack";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const baseUrl =
    process.env.NEXTAUTH_URL || `${url.protocol}//${url.host}`;
  const redirectToSettings = (params: Record<string, string>) => {
    const query = new URLSearchParams(params);
    return NextResponse.redirect(
      `${baseUrl}/settings?${query.toString()}`
    );
  };
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const state = url.searchParams.get("state");

  if (error) {
    return redirectToSettings({
      error: "slack_oauth_failed",
      message: error,
    });
  }

  if (!code || !state) {
    return redirectToSettings({
      error: "slack_callback_failed",
      message: "Missing OAuth parameters.",
    });
  }

  const userId = await consumeSlackOAuthState(state);
  if (!userId) {
    return redirectToSettings({
      error: "slack_callback_failed",
      message: "Invalid or expired OAuth state.",
    });
  }

  if (!process.env.SLACK_CLIENT_ID || !process.env.SLACK_CLIENT_SECRET) {
    return redirectToSettings({
      error: "slack_callback_failed",
      message: "Slack client credentials are not configured.",
    });
  }

  const body = new URLSearchParams({
    client_id: process.env.SLACK_CLIENT_ID,
    client_secret: process.env.SLACK_CLIENT_SECRET,
    code,
    redirect_uri: getSlackRedirectUri(),
  });

  try {
    const response = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const payload = (await response.json()) as {
      ok: boolean;
      error?: string;
      team?: { id?: string; name?: string };
      bot_user_id?: string;
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
    };

    if (!payload.ok || !payload.team?.id || !payload.access_token) {
      return redirectToSettings({
        error: "slack_oauth_failed",
        message: payload.error || "Slack OAuth exchange failed.",
      });
    }

    const teamId = payload.team.id;
    const installation = {
      _id: teamId,
      teamId,
      teamName: payload.team?.name || null,
      botUserId: payload.bot_user_id || null,
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token || null,
      expiresAt: payload.expires_in
        ? Date.now() + payload.expires_in * 1000
        : null,
      scope: payload.scope || null,
      installedByUserId: userId,
      installedAt: new Date(),
    };

    await saveSlackInstallation(installation);
    await updateUserById(userId, { slackTeamId: teamId });

    return redirectToSettings({ slack_success: "true" });
  } catch (err) {
    console.error("Slack OAuth callback error:", err);
    return redirectToSettings({
      error: "slack_callback_failed",
      message: "Unexpected Slack OAuth error.",
    });
  }
}
