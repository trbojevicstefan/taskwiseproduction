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
};

export type SlackUsersSyncJobPayload = {
  selectedIds?: string[];
};

export type FathomWebhookIngestJobPayload = {
  recordingId: string;
  data?: Record<string, unknown>;
};

export type DomainEventDispatchJobPayload = {
  eventId: string;
};

export type JobPayloadByType = {
  "meeting-rescan": MeetingRescanJobPayload;
  "fathom-sync": FathomSyncJobPayload;
  "slack-users-sync": SlackUsersSyncJobPayload;
  "fathom-webhook-ingest": FathomWebhookIngestJobPayload;
  "domain-event-dispatch": DomainEventDispatchJobPayload;
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
