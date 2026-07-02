import { createHash, createHmac, randomUUID } from "crypto";
import {
  listEnabledAutomationWorkflowsForTrigger,
  type AutomationWorkflowDoc,
  type AutomationWorkflowFieldSelection,
  type AutomationWorkflowFilter,
  type AutomationWorkflowTransform,
  type AutomationWorkflowTrigger,
} from "@/lib/automation-workflows";
import { enqueueJob } from "@/lib/jobs/store";
import { serializeError } from "@/lib/observability";
import {
  appendWebhookDeliveryAttempt,
  createWebhookDelivery,
} from "@/lib/webhook-deliveries";
import {
  maybeAutoDisableWorkflowForRepeatedFailures,
  WORKFLOW_GUARDRAIL_SYSTEM_USER_ID,
  getWorkflowGuardrailConfig,
} from "@/lib/workflow-guardrails";
import { runWorkflowTransform, WorkflowTransformError } from "@/lib/workflow-transform";
import {
  extractStringValues,
  flattenTaskRecords,
  normalizeString,
  toArray,
  toIsoStringOrNull,
  toRecordArray,
} from "@/lib/meeting-workflow-automation-helpers";
import {
  matchesFilter,
  selectWorkflowPayload,
  workflowMatchesPayload,
} from "@/lib/meeting-workflow-automation-matchers";

export type MeetingWorkflowAutomationPayload = {
  meetingId: string;
  workspaceId?: string | null;
  title?: string | null;
  transcript?: string | null;
  tags?: unknown[];
  attendees?: Array<Record<string, unknown>>;
  extractedTasks?: Array<Record<string, unknown>>;
};

type QueueMeetingWorkflowAutomationInput = {
  db: any;
  userId: string;
  eventType: AutomationWorkflowTrigger;
  payload: MeetingWorkflowAutomationPayload;
  correlationId?: string | null;
  kickWorker?: boolean;
};

type QueueMeetingWorkflowAutomationResult = {
  workspaceId: string | null;
  checkedWorkflows: number;
  matchedWorkflows: number;
  queuedDeliveries: number;
};

const toUtf8ByteLength = (value: string) => Buffer.byteLength(value, "utf8");

const toSerializableError = (error: unknown) => {
  const serialized = serializeError(error) as Record<string, unknown>;
  if (error instanceof WorkflowTransformError) {
    serialized.code = error.code;
    serialized.details = error.details || null;
  }
  return serialized;
};

const applyWorkflowTransform = async (
  payload: Record<string, unknown>,
  workflow: AutomationWorkflowDoc
) => {
  if (!workflow.transform?.script) {
    return payload;
  }

  const guardrails = getWorkflowGuardrailConfig();
  const transformed = await runWorkflowTransform({
    workflowId: workflow._id,
    script: workflow.transform.script,
    timeoutMs: workflow.transform.timeoutMs,
    payload,
    limits: {
      memoryLimitBytes: guardrails.transformMemoryLimitBytes,
      stackLimitBytes: guardrails.transformStackLimitBytes,
      inputLimitBytes: guardrails.transformInputLimitBytes,
      outputLimitBytes: guardrails.transformOutputLimitBytes,
    },
  });
  return transformed.payload;
};

const buildRetryHeaders = (
  workflow: AutomationWorkflowDoc,
  serializedBody: string,
  emittedAt: Date
) => {
  const headers: Record<string, string> = {
    ...(workflow.destination.headers || {}),
    "content-type": "application/json",
    "x-taskwise-event": workflow.trigger,
    "x-taskwise-workflow-id": workflow._id,
    "x-taskwise-workflow-version": String(workflow.version),
  };

  if (workflow.destination.signingSecret) {
    const timestamp = Math.floor(emittedAt.getTime() / 1000).toString();
    const signature = createHmac("sha256", workflow.destination.signingSecret)
      .update(`${timestamp}.${serializedBody}`)
      .digest("hex");
    headers["x-taskwise-signature-timestamp"] = timestamp;
    headers["x-taskwise-signature-v1"] = signature;
  }

  return headers;
};

const loadMeetingForWorkflow = async (db: any, userId: string, meetingId: string) =>
  db.collection("meetings").findOne(
    {
      userId,
      $or: [{ _id: meetingId }, { id: meetingId }],
    },
    {
      projection: {
        _id: 1,
        workspaceId: 1,
        connectionId: 1,
        providerSourceId: 1,
        title: 1,
        originalTranscript: 1,
        summary: 1,
        attendees: 1,
        extractedTasks: 1,
        tags: 1,
        meetingMetadata: 1,
        recordingUrl: 1,
        shareUrl: 1,
        startTime: 1,
        endTime: 1,
        duration: 1,
        createdAt: 1,
        lastActivityAt: 1,
      },
    }
  );

const buildCanonicalPayload = (
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

const buildWorkflowDeliveryBody = (
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

const recordWorkflowFailureDelivery = async (input: {
  db: any;
  workspaceId: string;
  meetingId: string;
  eventType: AutomationWorkflowTrigger;
  workflow: AutomationWorkflowDoc;
  canonicalPayload: CanonicalWorkflowPayload;
  error: unknown;
  reason: string;
}) => {
  const failedAt = new Date();
  const failureBody = buildWorkflowDeliveryBody(
    input.canonicalPayload,
    input.workflow,
    {
      skipped: true,
      reason: input.reason,
      error: {
        message:
          input.error instanceof Error
            ? input.error.message
            : "Workflow delivery was skipped due to a guardrail failure.",
      },
    }
  );
  const serializedFailureBody = JSON.stringify(failureBody);
  const deliveryId = randomUUID();
  const requestHeaders = {
    ...buildRetryHeaders(input.workflow, serializedFailureBody, failedAt),
    "x-taskwise-delivery-id": deliveryId,
    "x-taskwise-delivery-skipped": "true",
  };

  const failureDelivery = await createWebhookDelivery(input.db, {
    id: deliveryId,
    workspaceId: input.workspaceId,
    workflowId: input.workflow._id,
    workflowVersion: input.workflow.version,
    connectionId: input.canonicalPayload.meeting.connectionId || null,
    sourceEventId: `${input.eventType}:${input.meetingId}`,
    deliveryKey: null,
    eventType: input.eventType,
    maxAttempts: 1,
    request: {
      url: input.workflow.destination.url,
      method: "POST",
      headers: requestHeaders,
      body: failureBody,
      bodySha256: createHash("sha256").update(serializedFailureBody).digest("hex"),
    },
  });

  await appendWebhookDeliveryAttempt(input.db, deliveryId, {
    attemptNumber: 1,
    status: "failed",
    startedAt: failedAt,
    finishedAt: failedAt,
    request: failureDelivery.request,
    error: toSerializableError(input.error) as any,
    nextAttemptAt: null,
  });

  try {
    await maybeAutoDisableWorkflowForRepeatedFailures(input.db as any, {
      workflowId: input.workflow._id,
      workspaceId: input.workspaceId,
      reason: input.reason,
      updatedByUserId: WORKFLOW_GUARDRAIL_SYSTEM_USER_ID,
    });
  } catch {
    // Guardrail checks must not break meeting side-effects.
  }
};

export const queueMeetingWorkflowAutomation = async (
  input: QueueMeetingWorkflowAutomationInput
): Promise<QueueMeetingWorkflowAutomationResult> => {
  const meetingId = normalizeString(input.payload.meetingId);
  if (!meetingId) {
    return {
      workspaceId: null,
      checkedWorkflows: 0,
      matchedWorkflows: 0,
      queuedDeliveries: 0,
    };
  }

  const meetingDoc = await loadMeetingForWorkflow(input.db, input.userId, meetingId);
  const workspaceId =
    normalizeString(input.payload.workspaceId) || normalizeString(meetingDoc?.workspaceId);
  if (!workspaceId) {
    return {
      workspaceId: null,
      checkedWorkflows: 0,
      matchedWorkflows: 0,
      queuedDeliveries: 0,
    };
  }

  const workflows = await listEnabledAutomationWorkflowsForTrigger(
    input.db,
    workspaceId,
    input.eventType
  );
  if (!workflows.length) {
    return {
      workspaceId,
      checkedWorkflows: 0,
      matchedWorkflows: 0,
      queuedDeliveries: 0,
    };
  }

  const emittedAt = new Date();
  const canonicalPayload = buildCanonicalPayload(
    input.eventType,
    workspaceId,
    input.payload,
    meetingDoc,
    emittedAt
  );
  const guardrails = getWorkflowGuardrailConfig();

  let matchedWorkflows = 0;
  let queuedDeliveries = 0;

  for (const workflow of workflows) {
    if (!workflowMatchesPayload(canonicalPayload, workflow)) {
      continue;
    }
    matchedWorkflows += 1;

    const selectedPayload = selectWorkflowPayload(canonicalPayload, workflow.fieldSelection);
    let transformedPayload: unknown;
    try {
      transformedPayload = await applyWorkflowTransform(selectedPayload, workflow);
    } catch (error) {
      await recordWorkflowFailureDelivery({
        db: input.db,
        workspaceId,
        meetingId,
        eventType: input.eventType,
        workflow,
        canonicalPayload,
        error,
        reason:
          error instanceof WorkflowTransformError
            ? `workflow_transform_${error.code}`
            : "workflow_transform_runtime_error",
      });
      continue;
    }

    const deliveryBody = buildWorkflowDeliveryBody(
      canonicalPayload,
      workflow,
      transformedPayload
    );

    let serializedBody = "";
    try {
      const maybeSerializedBody = JSON.stringify(deliveryBody);
      if (typeof maybeSerializedBody !== "string") {
        throw new Error("Workflow delivery payload is not JSON-serializable.");
      }
      serializedBody = maybeSerializedBody;
    } catch (error) {
      await recordWorkflowFailureDelivery({
        db: input.db,
        workspaceId,
        meetingId,
        eventType: input.eventType,
        workflow,
        canonicalPayload,
        error,
        reason: "workflow_payload_serialization_error",
      });
      continue;
    }

    const deliveryBodyBytes = toUtf8ByteLength(serializedBody);
    if (deliveryBodyBytes > guardrails.deliveryBodyLimitBytes) {
      await recordWorkflowFailureDelivery({
        db: input.db,
        workspaceId,
        meetingId,
        eventType: input.eventType,
        workflow,
        canonicalPayload,
        error: new Error(
          `Workflow delivery payload exceeded ${guardrails.deliveryBodyLimitBytes} bytes.`
        ),
        reason: "workflow_payload_too_large",
      });
      continue;
    }

    const deliveryId = randomUUID();
    const requestHeaders = {
      ...buildRetryHeaders(workflow, serializedBody, emittedAt),
      "x-taskwise-delivery-id": deliveryId,
    };

    await createWebhookDelivery(input.db, {
      id: deliveryId,
      workspaceId,
      workflowId: workflow._id,
      workflowVersion: workflow.version,
      connectionId: canonicalPayload.meeting.connectionId || null,
      sourceEventId: `${input.eventType}:${meetingId}`,
      deliveryKey: null,
      eventType: input.eventType,
      maxAttempts: 5,
      request: {
        url: workflow.destination.url,
        method: "POST",
        headers: requestHeaders,
        body: deliveryBody,
        bodySha256: createHash("sha256").update(serializedBody).digest("hex"),
      },
    });

    await enqueueJob(input.db, {
      type: "workflow-webhook-delivery-send",
      userId: input.userId,
      correlationId:
        typeof input.correlationId === "string" && input.correlationId
          ? input.correlationId
          : undefined,
      payload: {
        deliveryId,
      },
      maxAttempts: 1,
    });

    queuedDeliveries += 1;
  }

  if (queuedDeliveries > 0 && input.kickWorker !== false) {
    void import("@/lib/jobs/worker")
      .then(({ kickJobWorker }) => kickJobWorker())
      .catch(() => undefined);
  }

  return {
    workspaceId,
    checkedWorkflows: workflows.length,
    matchedWorkflows,
    queuedDeliveries,
  };
};

export const buildCanonicalWorkflowPayloadForAutomation = (input: {
  eventType: AutomationWorkflowTrigger;
  workspaceId: string;
  payload: MeetingWorkflowAutomationPayload;
  meetingDoc: any;
  emittedAt?: Date;
}) =>
  buildCanonicalPayload(
    input.eventType,
    input.workspaceId,
    input.payload,
    input.meetingDoc,
    input.emittedAt || new Date()
  );

export const evaluateAutomationWorkflowFilters = (
  source: Record<string, unknown>,
  filters: AutomationWorkflowFilter[]
) => filters.every((filter) => matchesFilter(source, filter));

export const selectAutomationWorkflowPayload = (
  source: Record<string, unknown>,
  selection: AutomationWorkflowFieldSelection
) => selectWorkflowPayload(source, selection);

export const runAutomationWorkflowTransform = async (
  payload: Record<string, unknown>,
  input: {
    workflowId: string;
    transform: AutomationWorkflowTransform;
  }
) => {
  if (!input.transform?.script) {
    return payload;
  }

  const guardrails = getWorkflowGuardrailConfig();
  const transformed = await runWorkflowTransform({
    workflowId: input.workflowId,
    script: input.transform.script,
    timeoutMs: input.transform.timeoutMs,
    payload,
    limits: {
      memoryLimitBytes: guardrails.transformMemoryLimitBytes,
      stackLimitBytes: guardrails.transformStackLimitBytes,
      inputLimitBytes: guardrails.transformInputLimitBytes,
      outputLimitBytes: guardrails.transformOutputLimitBytes,
    },
  });

  return transformed.payload;
};
