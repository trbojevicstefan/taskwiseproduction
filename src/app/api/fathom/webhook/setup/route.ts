import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-route";
import { randomBytes } from "crypto";
import { getDb } from "@/lib/db";
import {
  findPreferredFathomConnectionForWorkspace,
  updateFathomConnectionById,
} from "@/lib/fathom-connections";
import {
  ensureFathomConnectionWebhook,
  FATHOM_WEBHOOK_EVENT,
  getFathomWebhookUrl,
} from "@/lib/fathom";
import { pruneFathomManagedWebhooks } from "@/lib/fathom-webhooks";
import { getValidFathomAccessTokenForConnection } from "@/lib/fathom-auth";
import { getSessionUserId } from "@/lib/server-auth";
import { logFathomIntegration } from "@/lib/fathom-logs";
import { resolveWorkspaceScopeForUser } from "@/lib/workspace-scope";

export async function POST() {
  const userId = await getSessionUserId();
  if (!userId) {
    return apiError(401, "request_error", "Unauthorized");
  }

  const db = await getDb();
  let workspaceScope;
  try {
    workspaceScope = await resolveWorkspaceScopeForUser(db, userId, {
      minimumRole: "member",
      adminVisibilityKey: "integrations",
    });
  } catch (error: any) {
    return apiError(error?.status || 403, "request_error", error?.message || "Forbidden");
  }

  const connection = await findPreferredFathomConnectionForWorkspace(
    db as any,
    workspaceScope.workspaceId,
    userId
  );
  if (!connection) {
    return apiError(400, "request_error", "Fathom integration not connected.");
  }

  const webhookToken = randomBytes(24).toString("hex");
  await updateFathomConnectionById(db as any, connection._id, {
    updatedByUserId: userId,
    webhook: {
      ...connection.webhook,
      token: webhookToken,
      status: "not_configured",
      lastError: null,
    },
  });

  try {
    const accessToken = await getValidFathomAccessTokenForConnection(connection._id);
    const result = await ensureFathomConnectionWebhook(
      connection._id,
      accessToken,
      webhookToken,
      { updatedByUserId: userId }
    );
    const webhookUrl = result.webhookUrl || getFathomWebhookUrl(webhookToken);
    const pruned = await pruneFathomManagedWebhooks(accessToken, {
      webhookId: result.webhookId || null,
      webhookUrl,
      managedWebhooks: result.managedWebhooks || [],
    });

    await updateFathomConnectionById(db as any, connection._id, {
      updatedByUserId: userId,
      webhook: {
        token: webhookToken,
        secret: result.webhookSecret || null,
        status: "active",
        webhookId: result.webhookId || null,
        webhookUrl: result.webhookUrl || webhookUrl,
        webhookEvent: FATHOM_WEBHOOK_EVENT,
        managedWebhooks: pruned.managedWebhooks,
        lastSyncedAt: new Date(),
        lastError: pruned.cleanupErrors.length
          ? {
              message: `Stale webhook cleanup had ${pruned.cleanupErrors.length} error(s).`,
            }
          : null,
      },
    });

    return NextResponse.json({
      status: result.status,
      connectionId: connection._id,
      webhookId: result.webhookId,
      webhookUrl,
      staleWebhooksDeleted: pruned.deletedCount,
      cleanupErrors: pruned.cleanupErrors,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Webhook setup failed.";
    await updateFathomConnectionById(db as any, connection._id, {
      updatedByUserId: userId,
      webhook: {
        ...connection.webhook,
        token: webhookToken,
        status: "error",
        lastSyncedAt: new Date(),
        lastError: { message },
      },
    });
    await logFathomIntegration(userId, "error", "webhook.create", "Webhook setup failed.", {
      workspaceId: workspaceScope.workspaceId,
      connectionId: connection._id,
      error: message,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
