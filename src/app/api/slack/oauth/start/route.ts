import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/server-auth";
import { createSlackOAuthState, getSlackRedirectUri, SLACK_SCOPES } from "@/lib/slack";

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.SLACK_CLIENT_ID) {
    return NextResponse.json(
      { error: "Slack client ID is not configured." },
      { status: 500 }
    );
  }

  const state = await createSlackOAuthState(userId);
  const redirectUri = getSlackRedirectUri();
  const params = new URLSearchParams({
    client_id: process.env.SLACK_CLIENT_ID,
    scope: SLACK_SCOPES,
    redirect_uri: redirectUri,
    state,
  });

  const authUrl = `https://slack.com/oauth/v2/authorize?${params.toString()}`;
  return NextResponse.redirect(authUrl);
}
