import type {
  DomainEventDispatchJobPayload,
  FathomWebhookIngestJobPayload,
  FathomSyncJobPayload,
  JobDocument,
  MeetingProviderSyncJobPayload,
  MeetingProviderWebhookIngestJobPayload,
  MeetingRescanJobPayload,
  MeetingSearchIndexJobPayload,
  SlackReminderSendJobPayload,
  SlackReminderSweepJobPayload,
  SlackUsersSyncJobPayload,
  WorkflowWebhookDeliverySendJobPayload,
} from "@/lib/jobs/types";
import { runDomainEventDispatchJob } from "@/lib/jobs/handlers/domain-event-dispatch-job";
import { runFathomWebhookIngestJob } from "@/lib/jobs/handlers/fathom-webhook-ingest-job";
import { runFathomSyncJob } from "@/lib/jobs/handlers/fathom-sync-job";
import { runMeetingProviderSyncJob } from "@/lib/jobs/handlers/meeting-provider-sync-job";
import { runMeetingProviderWebhookIngestJob } from "@/lib/jobs/handlers/meeting-provider-webhook-ingest-job";
import { runMeetingRescanJob } from "@/lib/jobs/handlers/meeting-rescan-job";
import { runMeetingSearchIndexJob } from "@/lib/jobs/handlers/meeting-search-index-job";
import { runSlackReminderSendJob } from "@/lib/jobs/handlers/slack-reminder-send-job";
import { runSlackReminderSweepJob } from "@/lib/jobs/handlers/slack-reminder-sweep-job";
import { runSlackUsersSyncJob } from "@/lib/jobs/handlers/slack-users-sync-job";
import { runWorkflowWebhookDeliverySendJob } from "@/lib/jobs/handlers/workflow-webhook-delivery-send-job";
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
        connectionId: payload.connectionId,
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
        connectionId: payload.connectionId,
        providerSourceId: payload.providerSourceId,
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
    case "workflow-webhook-delivery-send": {
      const payload = job.payload as WorkflowWebhookDeliverySendJobPayload;
      return runWorkflowWebhookDeliverySendJob({
        userId: job.userId,
        deliveryId: payload.deliveryId,
        correlationId: context?.correlationId,
        logger: context?.logger,
      });
    }
    case "slack-reminder-send": {
      const payload = job.payload as SlackReminderSendJobPayload;
      return runSlackReminderSendJob({
        userId: job.userId,
        reminderId: payload.reminderId,
        correlationId: context?.correlationId,
        logger: context?.logger,
      });
    }
    case "slack-reminder-sweep": {
      const payload = job.payload as SlackReminderSweepJobPayload;
      return runSlackReminderSweepJob({
        userId: job.userId,
        workspaceId: payload.workspaceId ?? null,
        correlationId: context?.correlationId,
        logger: context?.logger,
      });
    }
    case "meeting-provider-webhook-ingest": {
      const payload = job.payload as MeetingProviderWebhookIngestJobPayload;
      return runMeetingProviderWebhookIngestJob({
        userId: job.userId,
        provider: payload.provider,
        connectionId: payload.connectionId,
        payload: payload.payload,
        correlationId: context?.correlationId,
        logger: context?.logger,
      });
    }
    case "meeting-provider-sync": {
      const payload = job.payload as MeetingProviderSyncJobPayload;
      return runMeetingProviderSyncJob({
        userId: job.userId,
        provider: payload.provider,
        connectionId: payload.connectionId,
        since: payload.since ?? null,
        correlationId: context?.correlationId,
        logger: context?.logger,
      });
    }
    case "meeting-search-index": {
      const payload = job.payload as MeetingSearchIndexJobPayload;
      return runMeetingSearchIndexJob({
        userId: job.userId,
        meetingId: payload.meetingId,
        workspaceId: payload.workspaceId ?? null,
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
