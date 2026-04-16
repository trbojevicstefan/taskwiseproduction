import {
  apiError,
  apiSuccess,
  mapApiError,
} from "@/lib/api-route";
import {
  findAutomationWorkflowById,
  serializeAutomationWorkflow,
  type AutomationWorkflowDoc,
} from "@/lib/automation-workflows";
import { enqueueJob } from "@/lib/jobs/store";
import {
  createWebhookDeliveryReplay,
  findWebhookDeliveryById,
  serializeWebhookDelivery,
} from "@/lib/webhook-deliveries";
import { requireWorkspaceRouteAccess } from "@/lib/workspace-route-access";

const canManageWorkspaceWorkflows = (role: string | null | undefined) =>
  role === "owner" || role === "admin";

const canManageWorkflow = (
  workflow: AutomationWorkflowDoc,
  userId: string,
  role: string | null | undefined
) =>
  workflow.createdByUserId === userId || canManageWorkspaceWorkflows(role);

export async function POST(
  _request: Request,
  {
    params,
  }: {
    params:
      | { workspaceId: string; workflowId: string; deliveryId: string }
      | Promise<{ workspaceId: string; workflowId: string; deliveryId: string }>;
  }
) {
  try {
    const {
      workspaceId: rawWorkspaceId,
      workflowId: rawWorkflowId,
      deliveryId: rawDeliveryId,
    } = await Promise.resolve(params);
    const workspaceId = rawWorkspaceId?.trim();
    const workflowId = rawWorkflowId?.trim();
    const deliveryId = rawDeliveryId?.trim();
    if (!workspaceId) {
      return apiError(400, "request_error", "Workspace ID is required.");
    }
    if (!workflowId) {
      return apiError(400, "request_error", "Workflow ID is required.");
    }
    if (!deliveryId) {
      return apiError(400, "request_error", "Delivery ID is required.");
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
      return apiError(403, "forbidden", "You do not have access to replay this delivery.");
    }

    const sourceDelivery = await findWebhookDeliveryById(access.db as any, deliveryId);
    if (!sourceDelivery) {
      return apiError(404, "not_found", "Workflow delivery not found.");
    }
    if (sourceDelivery.workspaceId !== workspaceId || sourceDelivery.workflowId !== workflowId) {
      return apiError(403, "forbidden", "Workflow delivery does not belong to this workflow.");
    }
    if (sourceDelivery.status !== "failed" && sourceDelivery.status !== "disabled") {
      return apiError(
        409,
        "invalid_state",
        "Only failed or disabled deliveries can be replayed."
      );
    }

    const replayDelivery = await createWebhookDeliveryReplay(access.db as any, deliveryId);
    if (!replayDelivery) {
      return apiError(404, "not_found", "Workflow delivery not found.");
    }

    await enqueueJob(access.db as any, {
      type: "workflow-webhook-delivery-send",
      userId: access.userId,
      payload: {
        deliveryId: replayDelivery._id,
      },
      maxAttempts: 1,
    });

    return apiSuccess(
      {
        workspaceId,
        workflow: serializeAutomationWorkflow(workflow),
        sourceDelivery: serializeWebhookDelivery(sourceDelivery),
        replayDelivery: serializeWebhookDelivery(replayDelivery),
        queued: true,
      },
      { status: 201 }
    );
  } catch (error) {
    return mapApiError(error, "Failed to replay workflow delivery.");
  }
}
