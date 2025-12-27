import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/server-auth";
import { revokeGoogleTokensForUser } from "@/lib/google-auth";

export async function POST() {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
