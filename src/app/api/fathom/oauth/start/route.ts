import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/server-auth";
import {
  createFathomOAuthState,
  getFathomRedirectUri,
  FATHOM_SCOPES,
} from "@/lib/fathom";

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.FATHOM_CLIENT_ID) {
    return NextResponse.json(
      { error: "Fathom client ID is not configured." },
      { status: 500 }
    );
  }

  const state = await createFathomOAuthState(userId);
  const redirectUri = getFathomRedirectUri();

  const params = new URLSearchParams({
    client_id: process.env.FATHOM_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: FATHOM_SCOPES,
    response_type: "code",
    state,
  });

  const authUrl = `https://fathom.video/external/v1/oauth2/authorize?${params.toString()}`;
  return NextResponse.redirect(authUrl);
}
