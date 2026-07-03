export const mergeManagedWebhookEntries = (
  nextEntry: Record<string, any>,
  existingEntries: any[]
) => [
  nextEntry,
  ...existingEntries.filter((entry: any) => {
    if (!entry) return false;
    if (nextEntry.id && entry.id === nextEntry.id) return false;
    if (!nextEntry.id && nextEntry.url && entry.url === nextEntry.url) return false;
    return true;
  }),
];

export const toLegacyWebhookEntry = (entry: any) => ({
  id: entry?.id || null,
  url: entry?.url || null,
  createdAt: entry?.createdAt || null,
  include_transcript: entry?.includeTranscript ?? null,
  include_summary: entry?.includeSummary ?? null,
  include_action_items: entry?.includeActionItems ?? null,
  include_crm_matches: entry?.includeCrmMatches ?? null,
  triggered_for: entry?.triggeredFor ?? null,
});

export const toConnectionManagedWebhook = (entry: any, fallbackUrl: string) => ({
  id: entry?.id || entry?.webhook_id || null,
  url:
    entry?.url ||
    entry?.webhook_url ||
    entry?.destination_url ||
    entry?.destinationUrl ||
    fallbackUrl,
  createdAt: entry?.created_at || entry?.createdAt || null,
  includeTranscript: entry?.include_transcript ?? null,
  includeSummary: entry?.include_summary ?? null,
  includeActionItems: entry?.include_action_items ?? null,
  includeCrmMatches: entry?.include_crm_matches ?? null,
  triggeredFor: entry?.triggered_for ?? null,
});

export const buildWebhookBody = (url: string, triggeredFor: readonly string[]) => ({
  destination_url: url,
  include_transcript: true,
  include_summary: true,
  include_action_items: true,
  include_crm_matches: false,
  triggered_for: [...triggeredFor],
});

export const getWebhookUrl = (webhook: any) =>
  webhook?.destination_url ||
  webhook?.destinationUrl ||
  webhook?.url ||
  webhook?.webhook_url ||
  webhook?.webhookUrl ||
  null;

export const getWebhookId = (webhook: any) => webhook?.id || webhook?.webhook_id || null;
