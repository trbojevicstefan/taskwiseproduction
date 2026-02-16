import type {
  DomainEventDispatchJobPayload,
  FathomWebhookIngestJobPayload,
  FathomSyncJobPayload,
  JobDocument,
  MeetingRescanJobPayload,
  SlackUsersSyncJobPayload,
} from "@/lib/jobs/types";
import { runDomainEventDispatchJob } from "@/lib/jobs/handlers/domain-event-dispatch-job";
import { runFathomWebhookIngestJob } from "@/lib/jobs/handlers/fathom-webhook-ingest-job";
import { runFathomSyncJob } from "@/lib/jobs/handlers/fathom-sync-job";
import { runMeetingRescanJob } from "@/lib/jobs/handlers/meeting-rescan-job";
import { runSlackUsersSyncJob } from "@/lib/jobs/handlers/slack-users-sync-job";
import type { StructuredLogger } from "@/lib/observability";

type JobExecutionContext = {
  correlationId: string;
  logger: StructuredLogger;
};

export const processJob = async (
  job: JobDocument,
  context?: JobExecutionContext
) => {
  switch (job.type) {
    case "meeting-rescan": {
      const payload = job.payload as MeetingRescanJobPayload;
      return runMeetingRescanJob({
        userId: job.userId,
        meetingId: payload.meetingId,
        mode: payload.mode,
        correlationId: context?.correlationId,
        logger: context?.logger,
      });
    }
    case "fathom-sync": {
      const payload = job.payload as FathomSyncJobPayload;
      return runFathomSyncJob({
        userId: job.userId,
        range: payload.range,
        correlationId: context?.correlationId,
        logger: context?.logger,
      });
    }
    case "slack-users-sync": {
      const payload = job.payload as SlackUsersSyncJobPayload;
      return runSlackUsersSyncJob({
        userId: job.userId,
        selectedIds: payload.selectedIds,
        correlationId: context?.correlationId,
        logger: context?.logger,
      });
    }
    case "fathom-webhook-ingest": {
      const payload = job.payload as FathomWebhookIngestJobPayload;
      return runFathomWebhookIngestJob({
        userId: job.userId,
        recordingId: payload.recordingId,
        data: payload.data,
        correlationId: context?.correlationId,
        logger: context?.logger,
      });
    }
    case "domain-event-dispatch": {
      const payload = job.payload as DomainEventDispatchJobPayload;
      return runDomainEventDispatchJob({
        userId: job.userId,
        eventId: payload.eventId,
        correlationId: context?.correlationId,
        logger: context?.logger,
      });
    }
    default: {
      const neverJobType: never = job.type;
      throw new Error(`Unsupported job type: ${neverJobType}`);
    }
  }
};
