import { createHash, createHmac, randomUUID } from "crypto";
import {
  listEnabledAutomationWorkflowsForTrigger,
  type AutomationWorkflowDoc,
  type AutomationWorkflowFieldSelection,
  type AutomationWorkflowFilter,
  type AutomationWorkflowTrigger,
} from "@/lib/automation-workflows";
import { enqueueJob } from "@/lib/jobs/store";
import { createWebhookDelivery } from "@/lib/webhook-deliveries";

type MeetingWorkflowAutomationPayload = {
  meetingId: string;
  workspaceId?: string | null;
  title?: string | null;
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

const normalizeString = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const toIsoStringOrNull = (value: unknown) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value as any);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const toArray = <T = unknown>(value: unknown): T[] =>
  Array.isArray(value) ? (value as T[]) : [];

const toComparableString = (value: unknown, caseSensitive = false) => {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return caseSensitive ? normalized : normalized.toLowerCase();
};

const deepEquals = (left: unknown, right: unknown) => {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return left === right;
  }
};

const resolvePathValue = (source: any, path: string) => {
  const segments = path
    .split(".")
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (!segments.length) return undefined;

  let current: any = source;
  for (const segment of segments) {
    if (Array.isArray(current)) {
      const index = Number.parseInt(segment, 10);
      if (Number.isFinite(index)) {
        current = current[index];
      } else {
        current = current
          .map((candidate) =>
            candidate && typeof candidate === "object"
              ? (candidate as Record<string, unknown>)[segment]
              : undefined
          )
          .filter((candidate) => candidate !== undefined);
      }
    } else if (current && typeof current === "object") {
      current = (current as Record<string, unknown>)[segment];
    } else {
      return undefined;
    }
  }
  return current;
};

const assignPathValue = (target: Record<string, unknown>, path: string, value: unknown) => {
  const segments = path
    .split(".")
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (!segments.length) return;

  let cursor: Record<string, unknown> = target;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const isLast = index === segments.length - 1;
    if (isLast) {
      cursor[segment] = value;
      return;
    }
    const existing = cursor[segment];
    if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
      cursor[segment] = {};
    }
    cursor = cursor[segment] as Record<string, unknown>;
  }
};

const matchesEquals = (
  actual: unknown,
  expected: unknown,
  caseSensitive = false
): boolean => {
  if (Array.isArray(actual)) {
    return actual.some((candidate) => matchesEquals(candidate, expected, caseSensitive));
  }

  const comparableLeft = toComparableString(actual, caseSensitive);
  const comparableRight = toComparableString(expected, caseSensitive);
  if (comparableLeft !== null && comparableRight !== null) {
    return comparableLeft === comparableRight;
  }
  return deepEquals(actual, expected);
};

const matchesContains = (
  actual: unknown,
  expected: unknown,
  caseSensitive = false
): boolean => {
  if (Array.isArray(actual)) {
    return actual.some((candidate) => matchesContains(candidate, expected, caseSensitive));
  }

  const comparableRight = toComparableString(expected, caseSensitive);
  if (typeof actual === "string" && comparableRight !== null) {
    const comparableLeft = toComparableString(actual, caseSensitive);
    return comparableLeft !== null && comparableLeft.includes(comparableRight);
  }

  if (typeof actual === "number" || typeof actual === "boolean") {
    return matchesEquals(actual, expected, caseSensitive);
  }

  return false;
};

const matchesIn = (actual: unknown, expected: unknown, caseSensitive = false): boolean => {
  const expectedValues = toArray(expected);
  if (!expectedValues.length) return false;

  if (Array.isArray(actual)) {
    return actual.some((candidate) => matchesIn(candidate, expectedValues, caseSensitive));
  }

  return expectedValues.some((candidate) => matchesEquals(actual, candidate, caseSensitive));
};

const matchesFilter = (source: Record<string, unknown>, filter: AutomationWorkflowFilter) => {
  const actualValue = resolvePathValue(source, filter.field);
  const caseSensitive = Boolean(filter.caseSensitive);

  switch (filter.operator) {
    case "exists":
      return actualValue !== undefined && actualValue !== null;
    case "not_exists":
      return actualValue === undefined || actualValue === null;
    case "equals":
      return matchesEquals(actualValue, filter.value, caseSensitive);
    case "not_equals":
      return !matchesEquals(actualValue, filter.value, caseSensitive);
    case "contains":
      return matchesContains(actualValue, filter.value, caseSensitive);
    case "not_contains":
      return !matchesContains(actualValue, filter.value, caseSensitive);
    case "in":
      return matchesIn(actualValue, filter.value, caseSensitive);
    case "not_in":
      return !matchesIn(actualValue, filter.value, caseSensitive);
    default:
      return false;
  }
};

const workflowMatchesPayload = (
  source: Record<string, unknown>,
  workflow: AutomationWorkflowDoc
) => workflow.filters.every((filter) => matchesFilter(source, filter));

const selectWorkflowPayload = (
  source: Record<string, unknown>,
  selection: AutomationWorkflowFieldSelection
) => {
  if (selection.mode === "all") {
    return source;
  }

  const projected: Record<string, unknown> = {};
  selection.fields.forEach((fieldPath) => {
    const value = resolvePathValue(source, fieldPath);
    if (value !== undefined) {
      assignPathValue(projected, fieldPath, value);
    }
  });
  return projected;
};

const applyWorkflowTransform = (
  payload: Record<string, unknown>,
  workflow: AutomationWorkflowDoc
) => {
  // Transform runtime execution is implemented in a later step.
  if (!workflow.transform?.script) {
    return payload;
  }
  return payload;
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
        summary: 1,
        attendees: 1,
        extractedTasks: 1,
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
      summary: normalizeString(meetingDoc?.summary),
      attendees,
      attendeeCount: attendees.length,
      extractedTasks,
      taskCount: extractedTasks.length,
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

  let matchedWorkflows = 0;
  let queuedDeliveries = 0;

  for (const workflow of workflows) {
    if (!workflowMatchesPayload(canonicalPayload, workflow)) {
      continue;
    }
    matchedWorkflows += 1;

    const selectedPayload = selectWorkflowPayload(canonicalPayload, workflow.fieldSelection);
    const transformedPayload = applyWorkflowTransform(selectedPayload, workflow);
    const deliveryBody = {
      event: canonicalPayload.event,
      workspace: canonicalPayload.workspace,
      workflow: {
        id: workflow._id,
        name: workflow.name,
        version: workflow.version,
        trigger: workflow.trigger,
      },
      payload: transformedPayload,
    };
    const serializedBody = JSON.stringify(deliveryBody);
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

