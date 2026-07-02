import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-route";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { revokeGoogleTokensForUser } from "@/lib/google-auth";
import { resolveWorkspaceScopeForUser } from "@/lib/workspace-scope";

export async function POST() {
  const userId = await getSessionUserId();
  if (!userId) {
    return apiError(401, "request_error", "Unauthorized");
  }
  let resolvedWorkspaceId: string | null = null;
  try {
    const db = await getDb();
    const scope = await resolveWorkspaceScopeForUser(db, userId, {
      minimumRole: "member",
      adminVisibilityKey: "integrations",
    });
    resolvedWorkspaceId = scope.workspaceId;
  } catch (error: any) {
    return apiError(error?.status || 403, "request_error", error?.message || "Forbidden");
  }

  try {
    const result = await revokeGoogleTokensForUser(userId, {
      workspaceId: resolvedWorkspaceId,
      actorUserId: userId,
    });
    return NextResponse.json({
      ok: true,
      revokedUserId: result.revokedUserId,
      remotelyRevoked: result.remotelyRevoked,
      ...(result.warning ? { warning: result.warning } : {}),
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to revoke Google token." },
      { status: 500 }
    );
  }
}


