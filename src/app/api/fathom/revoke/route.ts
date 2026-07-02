import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-route";
import { getDb } from "@/lib/db";
import {
  deleteFathomWebhook,
} from "@/lib/fathom";
import { getValidFathomAccessTokenForConnection } from "@/lib/fathom-auth";
import {
  findPreferredFathomConnectionForWorkspace,
  updateFathomConnectionById,
} from "@/lib/fathom-connections";
import { getSessionUserId } from "@/lib/server-auth";
import { resolveWorkspaceScopeForUser } from "@/lib/workspace-scope";

export async function POST() {
  const userId = await getSessionUserId();
  if (!userId) {
    return apiError(401, "request_error", "Unauthorized");
  }

  const db = await getDb();

  try {
    const workspaceScope = await resolveWorkspaceScopeForUser(db, userId, {
      minimumRole: "member",
      adminVisibilityKey: "integrations",
    });
    const connection = await findPreferredFathomConnectionForWorkspace(
      db as any,
      workspaceScope.workspaceId,
      userId
    );
    if (!connection) {
      return NextResponse.json({ success: true, disconnectedUserId: userId });
    }

    const accessToken = await getValidFathomAccessTokenForConnection(connection._id);
    const webhooksToDelete =
      connection.webhook.managedWebhooks?.length
        ? connection.webhook.managedWebhooks
        : connection.webhook.webhookId || connection.webhook.webhookUrl
          ? [
              {
                id: connection.webhook.webhookId || null,
                url: connection.webhook.webhookUrl || null,
              },
            ]
          : [];

    for (const webhook of webhooksToDelete) {
      await deleteFathomWebhook(accessToken, webhook as any);
    }

    await updateFathomConnectionById(db as any, connection._id, {
      status: "revoked",
      updatedByUserId: userId,
      revokedAt: new Date(),
      webhook: {
        ...connection.webhook,
        status: "revoked",
        webhookId: null,
        webhookUrl: null,
        managedWebhooks: [],
        lastSyncedAt: new Date(),
        lastError: null,
      },
    });

    return NextResponse.json({
      success: true,
      disconnectedUserId: connection.legacyUserId || connection.createdByUserId,
      connectionId: connection._id,
    });
  } catch (error: any) {
    return apiError(error?.status || 403, "request_error", error?.message || "Forbidden");
  }
}
