import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-route";
import { getSessionUserId } from "@/lib/server-auth";
import { revokeGoogleTokensForUser } from "@/lib/google-auth";

export async function POST() {
  const userId = await getSessionUserId();
  if (!userId) {
    return apiError(401, "request_error", "Unauthorized");
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


