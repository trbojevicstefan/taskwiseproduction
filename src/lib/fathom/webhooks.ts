import { getDb } from "@/lib/db";
import {
  findFathomConnectionById,
  type FathomConnectionDoc,
  updateFathomConnectionById,
} from "@/lib/fathom-connections";
import { logFathomIntegration } from "@/lib/fathom-logs";
import { buildLegacyFathomInstallation } from "@/lib/fathom-installation-helpers";
import { recordExternalApiFailure } from "@/lib/observability-metrics";
import {
  buildWebhookBody,
  getWebhookId,
  getWebhookUrl,
} from "@/lib/fathom-webhook-helpers";
import {
  buildConnectionWebhookUpsert,
  buildLegacyWebhookUpsert,
} from "@/lib/fathom-webhook-sync-helpers";
import {
  FATHOM_WEBHOOK_EVENT,
  FATHOM_WEBHOOK_TRIGGERED_FOR,
  getFathomWebhookUrl,
} from "@/lib/fathom-utils";
import { deleteFathomWebhook as deleteManagedFathomWebhook } from "@/lib/fathom-webhooks";
import { listFathomWebhooks } from "@/lib/fathom/api-client";
import {
  getFathomInstallation,
  saveFathomInstallation,
} from "@/lib/fathom/oauth";

const FATHOM_WEBHOOK_TRIGGERED_FOR_FALLBACK = [
  "my_recordings",
  "shared_external_recordings",
  "my_shared_with_team_recordings",
  "shared_team_recordings",
] as const;

const syncLegacyInstallationFromConnection = async (
  connection: FathomConnectionDoc,
  overrides: Partial<import("@/lib/fathom/types").FathomInstallationDoc> = {}
) => {
  if (!connection.legacyUserId) return null;
  const userId = connection.legacyUserId;
  const existing = await getFathomInstallation(userId);

  const installation = buildLegacyFathomInstallation(connection, existing as any, overrides);
  if (!installation) {
    return existing;
  }

  await saveFathomInstallation(installation);
  return installation;
};

const createFathomWebhook = async (
  accessToken: string,
  url: string,
  triggeredFor: readonly string[]
) => {
  const body = buildWebhookBody(url, triggeredFor);

  const response = await fetch("https://api.fathom.ai/external/v1/webhooks", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    void recordExternalApiFailure({
      provider: "fathom",
      operation: "webhooks.create",
      statusCode: response.status,
      error: errorText || response.statusText,
      metadata: {
        destinationUrl: url,
      },
    });
    throw new Error(
      `Fathom webhook create failed (${response.status}): ${errorText || response.statusText}`
    );
  }

  return (await response.json()) as any;
};

export const ensureFathomWebhook = async (
  userId: string,
  accessToken: string,
  token: string
) => {
  const webhookUrl = getFathomWebhookUrl(token);

  const installation = await getFathomInstallation(userId);
  if (!installation) {
    throw new Error("Fathom installation missing while creating webhook.");
  }

  try {
    const existingWebhooks = await listFathomWebhooks(accessToken);
    const matches = existingWebhooks.filter(
      (webhook: any) => getWebhookUrl(webhook) === webhookUrl
    );
    if (matches.length > 0) {
      const sorted = [...matches].sort((a: any, b: any) => {
        const aCreated = new Date(a.created_at || a.createdAt || 0).getTime();
        const bCreated = new Date(b.created_at || b.createdAt || 0).getTime();
        return bCreated - aCreated;
      });
      const primary = sorted[0];
      const primaryId = getWebhookId(primary);
      const { webhookId, createdUrl, merged } = buildLegacyWebhookUpsert(
        primary,
        installation,
        webhookUrl
      );

      await saveFathomInstallation({
        ...installation,
        webhookId: webhookId || primaryId,
        webhookUrl: createdUrl,
        webhookEvent: FATHOM_WEBHOOK_EVENT,
        webhookSecret: installation.webhookSecret || null,
        webhooks: merged,
        updatedAt: new Date(),
      });

      if (sorted.length > 1) {
        await Promise.allSettled(
          sorted.slice(1).map((webhook: any) =>
            deleteManagedFathomWebhook(accessToken, webhook)
          )
        );
      }

      await logFathomIntegration(userId, "info", "webhook.create", "Webhook already exists.", {
        status: "existing",
        webhookId: webhookId || primaryId,
        destinationUrl: createdUrl,
      });

      return { status: "existing", webhookId: webhookId || primaryId, webhookUrl: createdUrl };
    }
  } catch (error) {
    console.warn("Failed to list existing Fathom webhooks:", error);
  }

  try {
    const created = await createFathomWebhook(
      accessToken,
      webhookUrl,
      FATHOM_WEBHOOK_TRIGGERED_FOR
    );
    const { webhookId, createdUrl, merged } = buildLegacyWebhookUpsert(
      created,
      installation,
      webhookUrl
    );
    await saveFathomInstallation({
      ...installation,
      webhookId,
      webhookUrl: createdUrl,
      webhookEvent: FATHOM_WEBHOOK_EVENT,
      webhookSecret: created.secret || created.webhook_secret || null,
      webhooks: merged,
      updatedAt: new Date(),
    });
    await logFathomIntegration(userId, "info", "webhook.create", "Webhook created.", {
      status: "created",
      webhookId,
      destinationUrl: createdUrl,
      include_action_items: created.include_action_items ?? null,
      include_summary: created.include_summary ?? null,
      include_transcript: created.include_transcript ?? null,
      include_crm_matches: created.include_crm_matches ?? null,
      triggered_for: created.triggered_for ?? null,
    });
    try {
      const existingWebhooks = await listFathomWebhooks(accessToken);
      const matches = existingWebhooks.filter(
        (webhook: any) => getWebhookUrl(webhook) === createdUrl
      );
      if (matches.length > 1) {
        const duplicates = matches.filter(
          (webhook: any) => getWebhookId(webhook) !== webhookId
        );
        if (duplicates.length) {
          await Promise.allSettled(
            duplicates.map((webhook: any) =>
              deleteManagedFathomWebhook(accessToken, webhook)
            )
          );
        }
      }
    } catch (error) {
      console.warn("Failed to cleanup duplicate Fathom webhooks:", error);
    }
    return { status: "created", webhookId, webhookUrl: createdUrl };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const triggerFallback =
      message.includes("triggered_for") ||
      message.includes("shared_with_me_external_recordings") ||
      message.includes("shared_external_recordings");
    const isDuplicate =
      message.includes("already") ||
      message.includes("duplicate") ||
      message.includes("exists") ||
      message.includes("taken") ||
      message.includes("409");

    if (triggerFallback) {
      try {
        const created = await createFathomWebhook(
          accessToken,
          webhookUrl,
          FATHOM_WEBHOOK_TRIGGERED_FOR_FALLBACK
        );
        const { webhookId, createdUrl, merged } = buildLegacyWebhookUpsert(
          created,
          installation,
          webhookUrl
        );
        await saveFathomInstallation({
          ...installation,
          webhookId,
          webhookUrl: createdUrl,
          webhookEvent: FATHOM_WEBHOOK_EVENT,
          webhookSecret: created.secret || created.webhook_secret || null,
          webhooks: merged,
          updatedAt: new Date(),
        });
        await logFathomIntegration(
          userId,
          "info",
          "webhook.create",
          "Webhook created with fallback trigger.",
          {
            status: "created",
            webhookId,
            destinationUrl: createdUrl,
            include_action_items: created.include_action_items ?? null,
            include_summary: created.include_summary ?? null,
            include_transcript: created.include_transcript ?? null,
            include_crm_matches: created.include_crm_matches ?? null,
            triggered_for: created.triggered_for ?? null,
          }
        );
        try {
          const existingWebhooks = await listFathomWebhooks(accessToken);
          const matches = existingWebhooks.filter(
            (webhook: any) => getWebhookUrl(webhook) === createdUrl
          );
          if (matches.length > 1) {
            const duplicates = matches.filter(
              (webhook: any) => getWebhookId(webhook) !== webhookId
            );
            if (duplicates.length) {
              await Promise.allSettled(
                duplicates.map((webhook: any) =>
                  deleteManagedFathomWebhook(accessToken, webhook)
                )
              );
            }
          }
        } catch (cleanupError) {
          console.warn(
            "Failed to cleanup duplicate Fathom webhooks after fallback:",
            cleanupError
          );
        }
        return { status: "created", webhookId, webhookUrl: createdUrl };
      } catch (fallbackError) {
        const fallbackMessage =
          fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        if (
          fallbackMessage.includes("already") ||
          fallbackMessage.includes("duplicate") ||
          fallbackMessage.includes("exists") ||
          fallbackMessage.includes("taken") ||
          fallbackMessage.includes("409")
        ) {
          const webhookId = installation.webhookId || null;
          const { merged } = buildLegacyWebhookUpsert(
            {
              id: webhookId,
              url: webhookUrl,
              createdAt: installation.updatedAt || installation.createdAt || null,
            },
            installation,
            webhookUrl
          );
          await saveFathomInstallation({
            ...installation,
            webhookUrl,
            webhookEvent: FATHOM_WEBHOOK_EVENT,
            webhookSecret: installation.webhookSecret || null,
            webhooks: merged,
            updatedAt: new Date(),
          });
          await logFathomIntegration(userId, "info", "webhook.create", "Webhook already exists.", {
            status: "existing",
            webhookId,
            destinationUrl: webhookUrl,
          });
          return { status: "existing", webhookId, webhookUrl };
        }
        await logFathomIntegration(
          userId,
          "error",
          "webhook.create",
          "Webhook fallback creation failed.",
          {
            error: fallbackMessage,
          }
        );
        throw fallbackError;
      }
    }

    if (!isDuplicate) {
      await logFathomIntegration(userId, "error", "webhook.create", "Webhook creation failed.", {
        error: message,
      });
      throw error;
    }

    const webhookId = installation.webhookId || null;
    const { merged } = buildLegacyWebhookUpsert(
      {
        id: webhookId,
        url: webhookUrl,
        createdAt: installation.updatedAt || installation.createdAt || null,
      },
      installation,
      webhookUrl
    );
    await saveFathomInstallation({
      ...installation,
      webhookUrl,
      webhookEvent: FATHOM_WEBHOOK_EVENT,
      webhookSecret: installation.webhookSecret || null,
      webhooks: merged,
      updatedAt: new Date(),
    });
    await logFathomIntegration(userId, "info", "webhook.create", "Webhook already exists.", {
      status: "existing",
      webhookId,
      destinationUrl: webhookUrl,
    });
    return { status: "existing", webhookId, webhookUrl };
  }
};

export const ensureFathomConnectionWebhook = async (
  connectionId: string,
  accessToken: string,
  token: string,
  options: { updatedByUserId?: string | null } = {}
) => {
  const db = await getDb();
  const connection = await findFathomConnectionById(db as any, connectionId);
  if (!connection) {
    throw new Error("Fathom connection missing while creating webhook.");
  }

  const webhookUrl = getFathomWebhookUrl(token);
  const updatedByUserId =
    options.updatedByUserId || connection.updatedByUserId || connection.createdByUserId;

  try {
    const existingWebhooks = await listFathomWebhooks(accessToken);
    const matches = existingWebhooks.filter(
      (webhook: any) => getWebhookUrl(webhook) === webhookUrl
    );
    if (matches.length > 0) {
      const sorted = [...matches].sort((a: any, b: any) => {
        const aCreated = new Date(a.created_at || a.createdAt || 0).getTime();
        const bCreated = new Date(b.created_at || b.createdAt || 0).getTime();
        return bCreated - aCreated;
      });
      const primary = sorted[0];
      const { webhookId, createdUrl, merged, secret, event } = buildConnectionWebhookUpsert(
        primary,
        connection,
        webhookUrl
      );

      const updatedConnection = await updateFathomConnectionById(db as any, connection._id, {
        updatedByUserId,
        webhook: {
          ...connection.webhook,
          token,
          secret,
          status: "active",
          webhookId,
          webhookUrl: createdUrl,
          webhookEvent: event,
          managedWebhooks: merged,
          lastSyncedAt: new Date(),
          lastError: null,
        },
      });

      if (updatedConnection) {
        await syncLegacyInstallationFromConnection(updatedConnection);
      }

      if (sorted.length > 1) {
        await Promise.allSettled(
          sorted.slice(1).map((webhook: any) =>
            deleteManagedFathomWebhook(accessToken, webhook)
          )
        );
      }

      if (connection.legacyUserId) {
        await logFathomIntegration(
          connection.legacyUserId,
          "info",
          "webhook.create",
          "Webhook already exists.",
          {
            status: "existing",
            connectionId: connection._id,
            webhookId,
            destinationUrl: createdUrl,
          }
        );
      }

      return {
        status: "existing" as const,
        webhookId,
        webhookUrl: createdUrl,
        webhookSecret: secret,
        managedWebhooks: merged,
      };
    }
  } catch (error) {
    console.warn("Failed to list existing Fathom webhooks:", error);
  }

  try {
    const created = await createFathomWebhook(
      accessToken,
      webhookUrl,
      FATHOM_WEBHOOK_TRIGGERED_FOR
    );
    const { webhookId, createdUrl, merged, secret, event } = buildConnectionWebhookUpsert(
      created,
      connection,
      webhookUrl
    );

    const updatedConnection = await updateFathomConnectionById(db as any, connection._id, {
      updatedByUserId,
      webhook: {
        ...connection.webhook,
        token,
        secret,
        status: "active",
        webhookId,
        webhookUrl: createdUrl,
        webhookEvent: event,
        managedWebhooks: merged,
        lastSyncedAt: new Date(),
        lastError: null,
      },
    });

    if (updatedConnection) {
      await syncLegacyInstallationFromConnection(updatedConnection);
    }

    if (connection.legacyUserId) {
      await logFathomIntegration(
        connection.legacyUserId,
        "info",
        "webhook.create",
        "Webhook created.",
        {
          status: "created",
          connectionId: connection._id,
          webhookId,
          destinationUrl: createdUrl,
          include_action_items: created.include_action_items ?? null,
          include_summary: created.include_summary ?? null,
          include_transcript: created.include_transcript ?? null,
          include_crm_matches: created.include_crm_matches ?? null,
          triggered_for: created.triggered_for ?? null,
        }
      );
    }

    try {
      const existingWebhooks = await listFathomWebhooks(accessToken);
      const matches = existingWebhooks.filter(
        (webhook: any) => getWebhookUrl(webhook) === createdUrl
      );
      if (matches.length > 1) {
        const duplicates = matches.filter(
          (webhook: any) => getWebhookId(webhook) !== webhookId
        );
        if (duplicates.length) {
          await Promise.allSettled(
            duplicates.map((webhook: any) =>
              deleteManagedFathomWebhook(accessToken, webhook)
            )
          );
        }
      }
    } catch (error) {
      console.warn("Failed to cleanup duplicate Fathom webhooks:", error);
    }

    return {
      status: "created" as const,
      webhookId,
      webhookUrl: createdUrl,
      webhookSecret: secret,
      managedWebhooks: merged,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const triggerFallback =
      message.includes("triggered_for") ||
      message.includes("shared_with_me_external_recordings") ||
      message.includes("shared_external_recordings");
    const isDuplicate =
      message.includes("already") ||
      message.includes("duplicate") ||
      message.includes("exists") ||
      message.includes("taken") ||
      message.includes("409");

    if (triggerFallback) {
      try {
        const created = await createFathomWebhook(
          accessToken,
          webhookUrl,
          FATHOM_WEBHOOK_TRIGGERED_FOR_FALLBACK
        );
        const { webhookId, createdUrl, merged, secret, event } = buildConnectionWebhookUpsert(
          created,
          connection,
          webhookUrl
        );

        const updatedConnection = await updateFathomConnectionById(
          db as any,
          connection._id,
          {
            updatedByUserId,
            webhook: {
              ...connection.webhook,
              token,
              secret,
              status: "active",
              webhookId,
              webhookUrl: createdUrl,
              webhookEvent: event,
              managedWebhooks: merged,
              lastSyncedAt: new Date(),
              lastError: null,
            },
          }
        );

        if (updatedConnection) {
          await syncLegacyInstallationFromConnection(updatedConnection);
        }

        if (connection.legacyUserId) {
          await logFathomIntegration(
            connection.legacyUserId,
            "info",
            "webhook.create",
            "Webhook created with fallback trigger.",
            {
              status: "created",
              connectionId: connection._id,
              webhookId,
              destinationUrl: createdUrl,
              include_action_items: created.include_action_items ?? null,
              include_summary: created.include_summary ?? null,
              include_transcript: created.include_transcript ?? null,
              include_crm_matches: created.include_crm_matches ?? null,
              triggered_for: created.triggered_for ?? null,
            }
          );
        }

        try {
          const existingWebhooks = await listFathomWebhooks(accessToken);
          const matches = existingWebhooks.filter(
            (webhook: any) => getWebhookUrl(webhook) === createdUrl
          );
          if (matches.length > 1) {
            const duplicates = matches.filter(
              (webhook: any) => getWebhookId(webhook) !== webhookId
            );
            if (duplicates.length) {
              await Promise.allSettled(
                duplicates.map((webhook: any) =>
                  deleteManagedFathomWebhook(accessToken, webhook)
                )
              );
            }
          }
        } catch (cleanupError) {
          console.warn(
            "Failed to cleanup duplicate Fathom webhooks after fallback:",
            cleanupError
          );
        }

        return {
          status: "created" as const,
          webhookId,
          webhookUrl: createdUrl,
          webhookSecret: secret,
          managedWebhooks: merged,
        };
      } catch (fallbackError) {
        const fallbackMessage =
          fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        if (
          fallbackMessage.includes("already") ||
          fallbackMessage.includes("duplicate") ||
          fallbackMessage.includes("exists") ||
          fallbackMessage.includes("taken") ||
          fallbackMessage.includes("409")
        ) {
          const webhookId = connection.webhook.webhookId || null;
          const { merged } = buildConnectionWebhookUpsert(
            {
              id: webhookId,
              url: webhookUrl,
              secret: connection.webhook.secret || null,
            },
            connection as any,
            webhookUrl
          );
          const updatedConnection = await updateFathomConnectionById(db as any, connection._id, {
            updatedByUserId,
            webhook: {
              ...connection.webhook,
              token,
              status: "active",
              webhookUrl,
              webhookEvent: connection.webhook.webhookEvent || FATHOM_WEBHOOK_EVENT,
              managedWebhooks: merged,
              lastSyncedAt: new Date(),
              lastError: null,
            },
          });

          if (updatedConnection) {
            await syncLegacyInstallationFromConnection(updatedConnection);
          }

          if (connection.legacyUserId) {
            await logFathomIntegration(
              connection.legacyUserId,
              "info",
              "webhook.create",
              "Webhook already exists.",
              {
                status: "existing",
                connectionId: connection._id,
                webhookId,
                destinationUrl: webhookUrl,
              }
            );
          }

          return {
            status: "existing" as const,
            webhookId,
            webhookUrl,
            webhookSecret: connection.webhook.secret || null,
            managedWebhooks: merged,
          };
        }

        if (connection.legacyUserId) {
          await logFathomIntegration(
            connection.legacyUserId,
            "error",
            "webhook.create",
            "Webhook fallback creation failed.",
            {
              connectionId: connection._id,
              error: fallbackMessage,
            }
          );
        }
        throw fallbackError;
      }
    }

    if (!isDuplicate) {
      if (connection.legacyUserId) {
        await logFathomIntegration(
          connection.legacyUserId,
          "error",
          "webhook.create",
          "Webhook creation failed.",
          {
            connectionId: connection._id,
            error: message,
          }
        );
      }
      throw error;
    }

    const webhookId = connection.webhook.webhookId || null;
    const { merged } = buildConnectionWebhookUpsert(
      {
        id: webhookId,
        url: webhookUrl,
        secret: connection.webhook.secret || null,
      },
      connection as any,
      webhookUrl
    );
    const updatedConnection = await updateFathomConnectionById(db as any, connection._id, {
      updatedByUserId,
      webhook: {
        ...connection.webhook,
        token,
        status: "active",
        webhookUrl,
        webhookEvent: connection.webhook.webhookEvent || FATHOM_WEBHOOK_EVENT,
        managedWebhooks: merged,
        lastSyncedAt: new Date(),
        lastError: null,
      },
    });

    if (updatedConnection) {
      await syncLegacyInstallationFromConnection(updatedConnection);
    }

    if (connection.legacyUserId) {
      await logFathomIntegration(
        connection.legacyUserId,
        "info",
        "webhook.create",
        "Webhook already exists.",
        {
          status: "existing",
          connectionId: connection._id,
          webhookId,
          destinationUrl: webhookUrl,
        }
      );
    }

    return {
      status: "existing" as const,
      webhookId,
      webhookUrl,
      webhookSecret: connection.webhook.secret || null,
      managedWebhooks: merged,
    };
  }
};
