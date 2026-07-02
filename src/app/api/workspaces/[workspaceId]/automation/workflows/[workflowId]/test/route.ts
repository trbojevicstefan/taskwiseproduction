import { createHash } from "crypto";
import { apiError, apiSuccess, mapApiError, parseJsonBody } from "@/lib/api-route";
import {
  findAutomationWorkflowById,
  serializeAutomationWorkflow,
} from "@/lib/automation-workflows";
import {
  appendWebhookDeliveryAttempt,
  createWebhookDelivery,
  serializeWebhookDelivery,
} from "@/lib/webhook-deliveries";
import { serializeError } from "@/lib/observability";
import { requireWorkspaceRouteAccess } from "@/lib/workspace-route-access";
import { z } from "zod";

const workflowTestSchema = z
  .object({
    payload: z.unknown().optional(),
    eventType: z.string().trim().min(1).max(120).optional(),
  })
  .optional()
  .default({});

const canManageWorkspaceWorkflows = (role: string | null | undefined) =>
  role === "owner" || role === "admin";

const canManageWorkflow = (
  workflow: { createdByUserId: string },
  userId: string,
  role: string | null | undefined
) =>
  workflow.createdByUserId === userId || canManageWorkspaceWorkflows(role);

const normalizeHeaders = (headers: Headers) => {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key] = value;
  });
  return result;
};

export async function POST(
  request: Request,
  {
    params,
  }: {
    params:
      | { workspaceId: string; workflowId: string }
      | Promise<{ workspaceId: string; workflowId: string }>;
  }
) {
  try {
    const { workspaceId: rawWorkspaceId, workflowId: rawWorkflowId } =
      await Promise.resolve(params);
    const workspaceId = rawWorkspaceId?.trim();
    const workflowId = rawWorkflowId?.trim();
    if (!workspaceId) {
      return apiError(400, "request_error", "Workspace ID is required.");
    }
    if (!workflowId) {
      return apiError(400, "request_error", "Workflow ID is required.");
    }

    const access = await requireWorkspaceRouteAccess(workspaceId, "member", {
      adminVisibilityKey: "integrations",
    });
    if (!access.ok) {
      return access.response;
    }

    const workflow = await findAutomationWorkflowById(access.db as any, workflowId);
    if (!workflow) {
      return apiError(404, "not_found", "Workflow not found.");
    }
    if (workflow.workspaceId !== workspaceId) {
      return apiError(403, "forbidden", "Workflow does not belong to this workspace.");
    }
    if (!canManageWorkflow(workflow, access.userId, access.membership?.role || null)) {
      return apiError(403, "forbidden", "You do not have access to test this workflow.");
    }

    const input = await parseJsonBody(
      request,
      workflowTestSchema,
      "Invalid workflow test payload."
    );
    const eventType = input.eventType || "workflow.test";
    const payload =
      input.payload !== undefined
        ? input.payload
        : {
            eventType,
            workspaceId,
            workflowId,
            workflowVersion: workflow.version,
            sentAt: new Date().toISOString(),
            workflow: serializeAutomationWorkflow(workflow),
          };
    const serializedBody = JSON.stringify(payload);
    const requestHeaders = {
      ...(workflow.destination.headers || {}),
      "content-type": "application/json",
      "x-taskwise-event": eventType,
      "x-taskwise-workflow-id": workflowId,
      "x-taskwise-workflow-version": String(workflow.version),
      "x-taskwise-test": "true",
    };

    const delivery = await createWebhookDelivery(access.db as any, {
      workspaceId,
      workflowId,
      workflowVersion: workflow.version,
      request: {
        url: workflow.destination.url,
        method: "POST",
        headers: requestHeaders,
        body: payload,
        bodySha256: createHash("sha256").update(serializedBody).digest("hex"),
      },
      eventType,
      deliveryKey: null,
      connectionId: null,
      sourceEventId: null,
      maxAttempts: 1,
    });

    const startedAt = new Date();
    try {
      const response = await fetch(workflow.destination.url, {
        method: "POST",
        headers: requestHeaders,
        body: serializedBody,
      });
      const finishedAt = new Date();
      const responseBody = await response.text().catch(() => null);
      const updated = await appendWebhookDeliveryAttempt(access.db as any, delivery._id, {
        status: response.ok ? "sent" : "failed",
        startedAt,
        finishedAt,
        request: delivery.request,
        response: {
          statusCode: response.status,
          headers: normalizeHeaders(response.headers),
          body: responseBody,
          durationMs: finishedAt.getTime() - startedAt.getTime(),
          receivedAt: finishedAt,
        },
        error: response.ok
          ? null
          : {
              message: `Webhook responded with status ${response.status}.`,
            },
      });

      return apiSuccess({
        workspaceId,
        workflowId,
        delivery: serializeWebhookDelivery(updated),
        responseOk: response.ok,
        responseStatusCode: response.status,
      });
    } catch (error) {
      const finishedAt = new Date();
      const updated = await appendWebhookDeliveryAttempt(access.db as any, delivery._id, {
        status: "failed",
        startedAt,
        finishedAt,
        request: delivery.request,
        error: serializeError(error),
      });

      return apiSuccess({
        workspaceId,
        workflowId,
        delivery: serializeWebhookDelivery(updated),
        responseOk: false,
        responseStatusCode: null,
      });
    }
  } catch (error) {
    return mapApiError(error, "Failed to send workflow test delivery.");
  }
}
