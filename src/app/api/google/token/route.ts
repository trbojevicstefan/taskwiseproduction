import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { getGoogleAccessTokenForUser } from "@/lib/google-auth";
import { resolveWorkspaceScopeForUser } from "@/lib/workspace-scope";

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const db = await getDb();
    await resolveWorkspaceScopeForUser(db, userId, {
      minimumRole: "member",
      adminVisibilityKey: "integrations",
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Forbidden" },
      { status: error?.status || 403 }
    );
  }

  try {
    const accessToken = await getGoogleAccessTokenForUser(userId);
    if (!accessToken) {
      return NextResponse.json({ error: "Google not connected." }, { status: 404 });
    }
    return NextResponse.json({ accessToken });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to refresh Google token." },
      { status: 500 }
    );
  }
}
