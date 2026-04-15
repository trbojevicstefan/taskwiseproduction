import { apiError, apiSuccess, mapApiError } from "@/lib/api-route";
import { findAutomationWorkflowById, serializeAutomationWorkflow } from "@/lib/automation-workflows";
import {
  listWebhookDeliveriesForWorkspace,
  serializeWebhookDelivery,
} from "@/lib/webhook-deliveries";
import { requireWorkspaceRouteAccess } from "@/lib/workspace-route-access";

export async function GET(
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

    const url = new URL(request.url);
    const status = url.searchParams.get("status")?.trim() || undefined;
    const limit = Number.parseInt(url.searchParams.get("limit") || "20", 10);
    const deliveries = await listWebhookDeliveriesForWorkspace(access.db as any, workspaceId, {
      workflowId,
      status: status as any,
      limit: Number.isFinite(limit) ? limit : 20,
    });

    return apiSuccess({
      workspaceId,
      workflow: serializeAutomationWorkflow(workflow),
      deliveries: deliveries.map((delivery) => serializeWebhookDelivery(delivery)),
      totalCount: deliveries.length,
    });
  } catch (error) {
    return mapApiError(error, "Failed to load workflow deliveries.");
  }
}
