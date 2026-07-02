import { createHash, createHmac, randomUUID } from "crypto";
import { serializeError } from "@/lib/observability";
import {
  appendWebhookDeliveryAttempt,
  createWebhookDelivery,
} from "@/lib/webhook-deliveries";
import {
  maybeAutoDisableWorkflowForRepeatedFailures,
  WORKFLOW_GUARDRAIL_SYSTEM_USER_ID,
} from "@/lib/workflow-guardrails";
import { WorkflowTransformError } from "@/lib/workflow-transform";
import {
  buildWorkflowDeliveryBody,
  type CanonicalWorkflowPayload,
} from "@/lib/meeting-workflow-automation-payload";
import type { AutomationWorkflowDoc, AutomationWorkflowTrigger } from "@/lib/automation-workflows";

export const toSerializableError = (error: unknown) => {
  const serialized = serializeError(error) as Record<string, unknown>;
  if (error instanceof WorkflowTransformError) {
    serialized.code = error.code;
    serialized.details = error.details || null;
  }
  return serialized;
};

export const buildRetryHeaders = (
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

export const recordWorkflowFailureDelivery = async (input: {
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
