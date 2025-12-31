import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/server-auth";
import {
  deleteFathomInstallation,
  deleteManagedFathomWebhooks,
  getFathomInstallation,
  getValidFathomAccessToken,
} from "@/lib/fathom";
import { updateUserById } from "@/lib/db/users";

export async function POST() {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const installation = await getFathomInstallation(userId);
  if (installation) {
    try {
      const accessToken = await getValidFathomAccessToken(userId);
      await deleteManagedFathomWebhooks(accessToken);
    } catch (error) {
      console.warn("Failed to delete Fathom webhooks on disconnect:", error);
    }
  }

  await deleteFathomInstallation(userId);
  await updateUserById(userId, {
    fathomConnected: false,
    fathomWebhookToken: null,
  });

  return NextResponse.json({ success: true });
}
