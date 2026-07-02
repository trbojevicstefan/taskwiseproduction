import { normalizeString, toArray, toIsoStringOrNull, toRecordArray } from "@/lib/meeting-workflow-automation-helpers";
import { extractStringValues, flattenTaskRecords } from "@/lib/meeting-workflow-automation-helpers";
import type { AutomationWorkflowDoc, AutomationWorkflowTrigger } from "@/lib/automation-workflows";

export type MeetingWorkflowAutomationPayload = {
  meetingId: string;
  workspaceId?: string | null;
  title?: string | null;
  transcript?: string | null;
  tags?: unknown[];
  attendees?: Array<Record<string, unknown>>;
  extractedTasks?: Array<Record<string, unknown>>;
};

export const buildCanonicalPayload = (
  eventType: AutomationWorkflowTrigger,
  workspaceId: string,
  payload: MeetingWorkflowAutomationPayload,
  meetingDoc: any,
  emittedAt: Date
) => {
  const attendees = toArray(payload.attendees).length
    ? toArray(payload.attendees)
    : toArray(meetingDoc?.attendees);
  const extractedTasks = toArray(payload.extractedTasks).length
    ? toArray(payload.extractedTasks)
    : toArray(meetingDoc?.extractedTasks);
  const tags = toArray(payload.tags).length ? toArray(payload.tags) : toArray(meetingDoc?.tags);
  const attendeeRecords = toRecordArray(attendees);
  const flattenedTaskRecords = flattenTaskRecords(toRecordArray(extractedTasks));
  const attendeeNames = extractStringValues(attendeeRecords, [
    "name",
    "displayName",
    "fullName",
    "label",
  ]);
  const attendeeEmails = extractStringValues(attendeeRecords, [
    "email",
    "mail",
    "primaryEmail",
    "address",
  ]);
  const taskTitles = extractStringValues(flattenedTaskRecords, ["title", "name"]);
  const taskStatuses = extractStringValues(flattenedTaskRecords, ["status", "state"]);
  const taskAssignees = extractStringValues(flattenedTaskRecords, [
    "assignee",
    "assigneeName",
    "assigneeEmail",
    "owner",
  ]);

  return {
    event: {
      type: eventType,
      emittedAt: emittedAt.toISOString(),
    },
    workspace: {
      id: workspaceId,
    },
    meeting: {
      id: normalizeString(meetingDoc?._id) || payload.meetingId,
      title: normalizeString(payload.title) || normalizeString(meetingDoc?.title),
      transcript:
        normalizeString(payload.transcript) || normalizeString(meetingDoc?.originalTranscript),
      summary: normalizeString(meetingDoc?.summary),
      attendees,
      attendeeCount: attendees.length,
      attendeeNames,
      attendeeEmails,
      extractedTasks,
      taskCount: extractedTasks.length,
      taskTitles,
      taskStatuses,
      taskAssignees,
      tags,
      metadata: meetingDoc?.meetingMetadata || null,
      recordingUrl: normalizeString(meetingDoc?.recordingUrl),
      shareUrl: normalizeString(meetingDoc?.shareUrl),
      startTime: toIsoStringOrNull(meetingDoc?.startTime),
      endTime: toIsoStringOrNull(meetingDoc?.endTime),
      duration:
        typeof meetingDoc?.duration === "number" && Number.isFinite(meetingDoc.duration)
          ? meetingDoc.duration
          : null,
      connectionId: normalizeString(meetingDoc?.connectionId),
      providerSourceId: normalizeString(meetingDoc?.providerSourceId),
      createdAt: toIsoStringOrNull(meetingDoc?.createdAt),
      lastActivityAt: toIsoStringOrNull(meetingDoc?.lastActivityAt),
    },
  };
};

export type CanonicalWorkflowPayload = ReturnType<typeof buildCanonicalPayload>;

export const buildWorkflowDeliveryBody = (
  canonicalPayload: CanonicalWorkflowPayload,
  workflow: AutomationWorkflowDoc,
  payload: unknown
) => ({
  event: canonicalPayload.event,
  workspace: canonicalPayload.workspace,
  workflow: {
    id: workflow._id,
    name: workflow.name,
    version: workflow.version,
    trigger: workflow.trigger,
  },
  payload,
});
