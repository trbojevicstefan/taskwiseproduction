import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-route";
import { getDb } from "@/lib/db";
import {
  deleteFathomWebhook,
  getValidFathomAccessTokenForConnection,
} from "@/lib/fathom";
import {
  findPreferredFathomConnectionForWorkspace,
  updateFathomConnectionById,
} from "@/lib/fathom-connections";
import { getSessionUserId } from "@/lib/server-auth";
import { resolveWorkspaceScopeForUser } from "@/lib/workspace-scope";

const serializeManagedWebhook = (entry: any) => ({
  id: entry?.id || null,
  url: entry?.url || null,
  created_at: entry?.createdAt || null,
  include_transcript: entry?.includeTranscript ?? null,
  include_summary: entry?.includeSummary ?? null,
  include_action_items: entry?.includeActionItems ?? null,
  include_crm_matches: entry?.includeCrmMatches ?? null,
  triggered_for: entry?.triggeredFor ?? null,
});

export async function GET() {
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
      return apiError(400, "request_error", "Fathom integration not connected.");
    }

    const fallback = connection.webhook.managedWebhooks?.length
      ? connection.webhook.managedWebhooks
      : connection.webhook.webhookId || connection.webhook.webhookUrl
        ? [
            {
              id: connection.webhook.webhookId || null,
              url: connection.webhook.webhookUrl || null,
              createdAt: connection.updatedAt,
            },
          ]
        : [];

    return NextResponse.json(fallback.map(serializeManagedWebhook));
  } catch (error: any) {
    return apiError(error?.status || 403, "request_error", error?.message || "Forbidden");
  }
}

export async function DELETE(request: Request) {
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
      return apiError(400, "request_error", "Fathom integration not connected.");
    }

    const body = await request.json().catch(() => ({}));
    const { ids, deleteAll } = body || {};
    const configuredWebhooks =
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
    const targets = Array.isArray(ids) ? ids : [];
    const webhookIds: any[] = deleteAll ? configuredWebhooks : targets;

    if (!webhookIds.length) {
      return apiError(400, "request_error", "No webhook IDs provided.");
    }

    const accessToken = await getValidFathomAccessTokenForConnection(connection._id);
    for (const webhook of webhookIds) {
      await deleteFathomWebhook(accessToken, webhook);
    }

    const deletedIds = webhookIds
      .map((item: any) => (typeof item === "string" ? item : item?.id))
      .filter(Boolean);
    const remainingWebhooks =
      connection.webhook.managedWebhooks?.filter(
        (entry: any) => !deletedIds.includes(entry.id || "")
      ) || [];
    const removedPrimary = connection.webhook.webhookId
      ? deletedIds.includes(connection.webhook.webhookId)
      : false;

    await updateFathomConnectionById(db as any, connection._id, {
      updatedByUserId: userId,
      webhook: {
        ...connection.webhook,
        status: remainingWebhooks.length || !removedPrimary ? connection.webhook.status : "not_configured",
        webhookId: removedPrimary ? null : connection.webhook.webhookId || null,
        webhookUrl: removedPrimary ? null : connection.webhook.webhookUrl || null,
        managedWebhooks: remainingWebhooks,
        lastSyncedAt: new Date(),
        lastError: null,
      },
    });

    return NextResponse.json({ ok: true, deleted: webhookIds.length });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete webhook(s)." },
      { status: 500 }
    );
  }
}
