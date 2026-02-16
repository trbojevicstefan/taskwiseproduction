const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

const isEnabled = (value: string | undefined, defaultValue = false) => {
  if (typeof value !== "string") {
    return defaultValue;
  }
  return TRUE_VALUES.has(value.trim().toLowerCase());
};

export const isQueueFirstWebhookIngestionEnabled = () =>
  isEnabled(process.env.CORE_FIRST_QUEUE_FIRST_WEBHOOK_INGESTION, false);

export const isUnifiedMeetingIngestionCommandEnabled = () =>
  isEnabled(process.env.CORE_FIRST_UNIFIED_MEETING_INGESTION_COMMAND, false);

export const isAsyncDomainEventProcessingEnabled = () =>
  isEnabled(process.env.CORE_FIRST_ASYNC_DOMAIN_EVENT_PROCESSING, false);

export const getCoreFirstFlagSnapshot = () => ({
  queueFirstWebhookIngestion: isQueueFirstWebhookIngestionEnabled(),
  unifiedMeetingIngestionCommand: isUnifiedMeetingIngestionCommandEnabled(),
  asyncDomainEventProcessing: isAsyncDomainEventProcessingEnabled(),
});
