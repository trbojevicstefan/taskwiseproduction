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
  try {
    const db = await getDb();
    await resolveWorkspaceScopeForUser(db, userId, {
      minimumRole: "member",
      adminVisibilityKey: "integrations",
    });
  } catch (error: any) {
    return apiError(error?.status || 403, "request_error", error?.message || "Forbidden");
  }

  try {
    await revokeGoogleTokensForUser(userId);
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to revoke Google token." },
      { status: 500 }
    );
  }
}


