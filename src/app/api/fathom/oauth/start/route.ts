import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  createFathomConnectionOAuthState,
  findFathomConnectionById,
} from "@/lib/fathom-connections";
import { getSessionUserId } from "@/lib/server-auth";
import {
  FATHOM_SCOPES,
  getFathomRedirectUri,
} from "@/lib/fathom-utils";
import { resolveWorkspaceScopeForUser } from "@/lib/workspace-scope";

export async function GET(request: Request) {
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

  const requestUrl = new URL(request.url);
  const db = await getDb();
  const workspaceScope = await resolveWorkspaceScopeForUser(db, userId, {
    minimumRole: "member",
    adminVisibilityKey: "integrations",
    requestedWorkspaceId: requestUrl.searchParams.get("workspaceId"),
  });
  const requestedConnectionId = requestUrl.searchParams.get("connectionId");
  const requestedLabel = requestUrl.searchParams.get("label");
  const existingConnection = requestedConnectionId
    ? await findFathomConnectionById(db as any, requestedConnectionId)
    : null;
  if (
    existingConnection &&
    existingConnection.workspaceId !== workspaceScope.workspaceId
  ) {
    return NextResponse.json(
      { error: "Fathom connection does not belong to the active workspace." },
      { status: 403 }
    );
  }
  const state = await createFathomConnectionOAuthState(db as any, {
    workspaceId: workspaceScope.workspaceId,
    userId,
    connectionId:
      existingConnection && existingConnection.workspaceId === workspaceScope.workspaceId
        ? existingConnection._id
        : null,
    label: requestedLabel,
  });
  const redirectUri = getFathomRedirectUri();

  const params = new URLSearchParams({
    client_id: process.env.FATHOM_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: FATHOM_SCOPES,
    response_type: "code",
    state: state._id,
  });

  const authUrl = `https://fathom.video/external/v1/oauth2/authorize?${params.toString()}`;
  return NextResponse.redirect(authUrl);
}
