import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { getSessionUserId } from "@/lib/server-auth";
import {
  ensureFathomWebhook,
  getFathomInstallation,
  getFathomWebhookUrl,
  getValidFathomAccessToken,
} from "@/lib/fathom";
import { findUserById, updateUserById } from "@/lib/db/users";

export async function POST() {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  console.log("Fathom webhook setup requested", { userId });

  const installation = await getFathomInstallation(userId);
  if (!installation) {
    return NextResponse.json(
      { error: "Fathom integration not connected." },
      { status: 400 }
    );
  }

  const user = await findUserById(userId);
  if (!user) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  let webhookToken = user.fathomWebhookToken || null;
  if (!webhookToken) {
    webhookToken = randomBytes(24).toString("hex");
    await updateUserById(userId, { fathomWebhookToken: webhookToken });
  }

  try {
    const accessToken = await getValidFathomAccessToken(userId);
    const result = await ensureFathomWebhook(userId, accessToken, webhookToken);
    console.log("Fathom webhook setup result", {
      userId,
      status: result.status,
      webhookId: result.webhookId,
      webhookUrl: result.webhookUrl,
    });

    return NextResponse.json({
      status: result.status,
      webhookId: result.webhookId,
      webhookUrl: result.webhookUrl || getFathomWebhookUrl(webhookToken),
    });
  } catch (error) {
    console.error("Fathom webhook setup failed", {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Webhook setup failed." },
      { status: 500 }
    );
  }
}
