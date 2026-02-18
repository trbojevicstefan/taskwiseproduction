import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-route";
import { randomBytes } from "crypto";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import {
  deleteManagedFathomWebhooks,
  ensureFathomWebhook,
  getFathomInstallation,
  getFathomWebhookUrl,
  getValidFathomAccessToken,
} from "@/lib/fathom";
import { findUserById, updateUserById } from "@/lib/db/users";
import { logFathomIntegration } from "@/lib/fathom-logs";
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

  console.log("Fathom webhook setup requested", { userId });

  const installation = await getFathomInstallation(userId);
  if (!installation) {
    return apiError(400, "request_error", "Fathom integration not connected.");
  }

  const user = await findUserById(userId);
  if (!user) {
    return apiError(404, "request_error", "User not found.");
  }

  const webhookToken = randomBytes(24).toString("hex");
  await updateUserById(userId, { fathomWebhookToken: webhookToken });

  try {
    const accessToken = await getValidFathomAccessToken(userId);
    try {
      await deleteManagedFathomWebhooks(accessToken);
    } catch (error) {
      await logFathomIntegration(
        userId,
        "warn",
        "webhook.cleanup",
        "Failed to delete existing Fathom webhooks before setup.",
        { error: error instanceof Error ? error.message : String(error) }
      );
    }
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


