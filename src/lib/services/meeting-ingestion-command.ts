import { isUnifiedMeetingIngestionCommandEnabled } from "@/lib/core-first-flags";
import {
  publishDomainEvent,
  type DomainEventResultByType,
} from "@/lib/domain-events";
import {
  applyMeetingIngestionSideEffects,
  type MeetingIngestionPayload,
} from "@/lib/services/meeting-ingestion-side-effects";

export type MeetingIngestionCommandMode = "always-event" | "flagged-event";

const emptyResult = (): DomainEventResultByType["meeting.ingested"] => ({
  people: { created: 0, updated: 0 },
  tasks: { upserted: 0, deleted: 0 },
  boardItemsCreated: 0,
});

const normalizePayload = (payload: MeetingIngestionPayload): MeetingIngestionPayload => ({
  meetingId: String(payload.meetingId || "").trim(),
  workspaceId:
    typeof payload.workspaceId === "string" && payload.workspaceId.trim()
      ? payload.workspaceId.trim()
      : payload.workspaceId ?? null,
  title: payload.title || null,
  attendees: Array.isArray(payload.attendees) ? payload.attendees : [],
  extractedTasks: Array.isArray(payload.extractedTasks) ? payload.extractedTasks : [],
});

export const runMeetingIngestionCommand = async (
  db: any,
  input: {
    userId: string;
    payload: MeetingIngestionPayload;
    correlationId?: string | null;
    mode?: MeetingIngestionCommandMode;
  }
): Promise<DomainEventResultByType["meeting.ingested"]> => {
  const mode = input.mode || "always-event";
  const payload = normalizePayload(input.payload);
  if (!payload.meetingId) {
    return emptyResult();
  }

  const shouldPublishEvent =
    mode === "always-event" || isUnifiedMeetingIngestionCommandEnabled();
  if (shouldPublishEvent) {
    return publishDomainEvent(db, {
      type: "meeting.ingested",
      userId: input.userId,
      correlationId: input.correlationId ?? null,
      payload: {
        meetingId: payload.meetingId,
        workspaceId:
          typeof payload.workspaceId === "string" ? payload.workspaceId : null,
        title: payload.title || null,
        attendees: payload.attendees || [],
        extractedTasks: payload.extractedTasks || [],
      },
    });
  }

  return applyMeetingIngestionSideEffects(db, input.userId, payload);
};
