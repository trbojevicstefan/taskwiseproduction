import {
  mergeManagedWebhookEntries,
  toConnectionManagedWebhook,
} from "@/lib/fathom-webhook-helpers";
import { FATHOM_WEBHOOK_EVENT } from "@/lib/fathom-utils";

export const buildLegacyWebhookUpsert = (
  created: any,
  current: { webhooks?: any[] },
  fallbackUrl: string
) => {
  const webhookId = created.id || created.webhook_id || null;
  const createdUrl = created.url || created.webhook_url || fallbackUrl;
  const createdAt = created.created_at || created.createdAt || null;
  const nextEntry = {
    id: webhookId,
    url: createdUrl,
    createdAt,
    include_transcript: created.include_transcript ?? null,
    include_summary: created.include_summary ?? null,
    include_action_items: created.include_action_items ?? null,
    include_crm_matches: created.include_crm_matches ?? null,
    triggered_for: created.triggered_for ?? null,
  };
  const merged = mergeManagedWebhookEntries(nextEntry, current.webhooks || []);
  return { webhookId, createdUrl, createdAt, merged };
};

export const buildConnectionWebhookUpsert = (
  created: any,
  current: { webhooks?: any[]; webhook: { secret?: string | null; webhookEvent?: string | null } },
  fallbackUrl: string
) => {
  const nextEntry = toConnectionManagedWebhook(created, fallbackUrl);
  const merged = mergeManagedWebhookEntries(nextEntry, current.webhooks || []);
  return {
    webhookId: nextEntry.id || null,
    createdUrl: nextEntry.url || fallbackUrl,
    merged,
    secret: created?.secret || created?.webhook_secret || current.webhook.secret || null,
    event: current.webhook.webhookEvent || FATHOM_WEBHOOK_EVENT,
  };
};
