import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/server-auth";
import { deleteFathomInstallation } from "@/lib/fathom";
import { updateUserById } from "@/lib/db/users";

export async function POST() {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await deleteFathomInstallation(userId);
  await updateUserById(userId, {
    fathomConnected: false,
    fathomWebhookToken: null,
  });

  return NextResponse.json({ success: true });
}
