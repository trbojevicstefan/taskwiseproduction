export const JOB_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

export const JOB_TYPES = [
  "meeting-rescan",
  "fathom-sync",
  "slack-users-sync",
  "fathom-webhook-ingest",
  "domain-event-dispatch",
  "workflow-webhook-delivery-send",
  "slack-reminder-send",
  "slack-reminder-sweep",
  "meeting-provider-webhook-ingest",
  "meeting-provider-sync",
  "meeting-search-index",
] as const;

export type JobType = (typeof JOB_TYPES)[number];

export type MeetingRescanMode = "completed" | "new" | "both";
export type FathomSyncRange = "today" | "this_week" | "last_week" | "this_month" | "all";

export type MeetingRescanJobPayload = {
  meetingId: string;
  mode: MeetingRescanMode;
};

export type FathomSyncJobPayload = {
  range: FathomSyncRange;
  connectionId?: string | null;
};

export type SlackUsersSyncJobPayload = {
  selectedIds?: string[];
};

export type FathomWebhookIngestJobPayload = {
  recordingId: string;
  connectionId?: string | null;
  providerSourceId?: string | null;
  data?: Record<string, unknown>;
};

export type DomainEventDispatchJobPayload = {
  eventId: string;
};

export type WorkflowWebhookDeliverySendJobPayload = {
  deliveryId: string;
};

export type SlackReminderSendJobPayload = {
  reminderId: string;
};

export type SlackReminderSweepJobPayload = {
  workspaceId: string | null;
};

export type MeetingProviderWebhookIngestJobPayload = {
  provider: string;
  connectionId: string;
  /** Raw JSON webhook payload; re-parsed by the adapter inside the handler. */
  payload: Record<string, unknown>;
};

export type MeetingProviderSyncJobPayload = {
  provider: string;
  connectionId: string;
  /** ISO timestamp lower bound for listMeetings; null/absent = provider default. */
  since?: string | null;
};

export type MeetingSearchIndexJobPayload = {
  meetingId: string;
  workspaceId?: string | null;
};

export type JobPayloadByType = {
  "meeting-rescan": MeetingRescanJobPayload;
  "fathom-sync": FathomSyncJobPayload;
  "slack-users-sync": SlackUsersSyncJobPayload;
  "fathom-webhook-ingest": FathomWebhookIngestJobPayload;
  "domain-event-dispatch": DomainEventDispatchJobPayload;
  "workflow-webhook-delivery-send": WorkflowWebhookDeliverySendJobPayload;
  "slack-reminder-send": SlackReminderSendJobPayload;
  "slack-reminder-sweep": SlackReminderSweepJobPayload;
  "meeting-provider-webhook-ingest": MeetingProviderWebhookIngestJobPayload;
  "meeting-provider-sync": MeetingProviderSyncJobPayload;
  "meeting-search-index": MeetingSearchIndexJobPayload;
};

export type JobResult = Record<string, unknown> | null;

export type JobDocument<TType extends JobType = JobType> = {
  _id: string;
  type: TType;
  userId: string;
  correlationId?: string;
  payload: JobPayloadByType[TType];
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  runAt: Date;
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date;
  finishedAt?: Date;
  result?: JobResult;
  error?: {
    message: string;
    stack?: string;
  };
};
