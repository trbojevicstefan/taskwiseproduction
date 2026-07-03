import type { FathomConnectionDoc } from "@/lib/fathom-connections";
import { toLegacyWebhookEntry } from "@/lib/fathom-webhook-helpers";

export type FathomInstallationLike = {
  _id: string;
  userId: string;
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: number | null;
  scope?: string | null;
  fathomUserId?: string | null;
  webhookId?: string | null;
  webhookUrl?: string | null;
  webhookEvent?: string | null;
  webhookSecret?: string | null;
  webhooks?: Array<Record<string, any>>;
  createdAt?: Date;
  updatedAt?: Date;
};

export const buildLegacyFathomInstallation = (
  connection: FathomConnectionDoc,
  existing: FathomInstallationLike | null,
  overrides: Partial<FathomInstallationLike> = {}
): FathomInstallationLike | null => {
  if (!connection.legacyUserId) return null;

  const userId = connection.legacyUserId;
  const managedWebhooks = Array.isArray(connection.webhook.managedWebhooks)
    ? connection.webhook.managedWebhooks.map(toLegacyWebhookEntry)
    : [];
  const accessToken =
    overrides.accessToken ?? connection.oauth.accessToken ?? existing?.accessToken ?? null;

  if (!accessToken) {
    return existing;
  }

  return {
    _id: userId,
    userId,
    accessToken,
    refreshToken:
      overrides.refreshToken ?? connection.oauth.refreshToken ?? existing?.refreshToken ?? null,
    expiresAt:
      overrides.expiresAt ?? connection.oauth.expiresAt ?? existing?.expiresAt ?? null,
    scope: overrides.scope ?? connection.oauth.scope ?? existing?.scope ?? null,
    fathomUserId:
      overrides.fathomUserId ?? connection.source.providerUserId ?? existing?.fathomUserId ?? null,
    webhookId: overrides.webhookId ?? connection.webhook.webhookId ?? existing?.webhookId ?? null,
    webhookUrl:
      overrides.webhookUrl ?? connection.webhook.webhookUrl ?? existing?.webhookUrl ?? null,
    webhookEvent:
      overrides.webhookEvent ?? connection.webhook.webhookEvent ?? existing?.webhookEvent ?? null,
    webhookSecret:
      overrides.webhookSecret ?? connection.webhook.secret ?? existing?.webhookSecret ?? null,
    webhooks:
      overrides.webhooks ?? (managedWebhooks.length ? managedWebhooks : existing?.webhooks || []),
    createdAt: existing?.createdAt,
    updatedAt: new Date(),
  };
};
