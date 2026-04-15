import { z } from "zod";
import { apiError, apiSuccess, mapApiError, parseJsonBody } from "@/lib/api-route";
import {
  deleteAutomationWorkflowById,
  findAutomationWorkflowById,
  listAutomationWorkflowsForWorkspace,
  serializeAutomationWorkflow,
  updateAutomationWorkflowById,
  type AutomationWorkflowDoc,
} from "@/lib/automation-workflows";
import { requireWorkspaceRouteAccess } from "@/lib/workspace-route-access";

const workflowFilterSchema = z.object({
  field: z.string().trim().min(1).max(120),
  operator: z.enum([
    "equals",
    "not_equals",
    "contains",
    "not_contains",
    "in",
    "not_in",
    "exists",
    "not_exists",
  ]),
  value: z
    .union([
      z.string(),
      z.number(),
      z.boolean(),
      z.null(),
      z.array(z.union([z.string(), z.number(), z.boolean()])),
    ])
    .optional(),
  caseSensitive: z.boolean().optional(),
});

const workflowFieldSelectionSchema = z.object({
  mode: z.enum(["all", "subset"]),
  fields: z.array(z.string().trim().min(1).max(120)).default([]),
});

const workflowTransformSchema = z.object({
  runtime: z.literal("quickjs").default("quickjs"),
  script: z.string().max(20_000).nullable().optional(),
  timeoutMs: z.number().int().min(100).max(10_000).default(1_000),
});

const workflowDestinationSchema = z.object({
  type: z.literal("webhook").default("webhook"),
  url: z.string().trim().url().max(2_000),
  signingSecret: z.string().max(512).nullable().optional(),
  headers: z.record(z.string().max(512)).nullable().optional(),
});

const updateWorkflowSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    enabled: z.boolean().optional(),
    trigger: z.enum(["meeting.ingested", "meeting.updated"]).optional(),
    filters: z.array(workflowFilterSchema).optional(),
    fieldSelection: workflowFieldSelectionSchema.optional(),
    transform: workflowTransformSchema.optional(),
    destination: workflowDestinationSchema.optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.description !== undefined ||
      value.enabled !== undefined ||
      value.trigger !== undefined ||
      value.filters !== undefined ||
      value.fieldSelection !== undefined ||
      value.transform !== undefined ||
      value.destination !== undefined,
    {
      message: "Provide at least one workflow field to update.",
    }
  );

const canManageWorkspaceWorkflows = (role: string | null | undefined) =>
  role === "owner" || role === "admin";

const canManageWorkflow = (
  workflow: AutomationWorkflowDoc,
  userId: string,
  role: string | null | undefined
) =>
  workflow.createdByUserId === userId || canManageWorkspaceWorkflows(role);

const toWorkflowResponse = (
  workflow: AutomationWorkflowDoc,
  input: {
    currentUserId: string;
    currentUserRole: string | null | undefined;
    includeSecrets?: boolean;
  }
) => ({
  ...serializeAutomationWorkflow(workflow, {
    includeSecrets: input.includeSecrets,
  }),
  connectedByCurrentUser: workflow.createdByUserId === input.currentUserId,
  canManage: canManageWorkflow(workflow, input.currentUserId, input.currentUserRole),
});

const loadWorkflowForWorkspace = async (
  db: any,
  workspaceId: string,
  workflowId: string
) => {
  const workflow = await findAutomationWorkflowById(db, workflowId);
  if (!workflow) {
    return null;
  }
  if (workflow.workspaceId !== workspaceId) {
    throw new Error("workspace_mismatch");
  }
  return workflow;
};

export async function GET(
  _request: Request,
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

    const workflow = await loadWorkflowForWorkspace(access.db as any, workspaceId, workflowId);
    if (!workflow) {
      return apiError(404, "not_found", "Workflow not found.");
    }

    return apiSuccess({
      workspaceId,
      workflow: toWorkflowResponse(workflow, {
        currentUserId: access.userId,
        currentUserRole: access.membership?.role || null,
        includeSecrets: true,
      }),
    });
  } catch (error) {
    if (error instanceof Error && error.message === "workspace_mismatch") {
      return apiError(403, "forbidden", "Workflow does not belong to this workspace.");
    }
    return mapApiError(error, "Failed to load automation workflow.");
  }
}

export async function PATCH(
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

    const workflow = await loadWorkflowForWorkspace(access.db as any, workspaceId, workflowId);
    if (!workflow) {
      return apiError(404, "not_found", "Workflow not found.");
    }
    if (!canManageWorkflow(workflow, access.userId, access.membership?.role || null)) {
      return apiError(403, "forbidden", "You do not have access to update this workflow.");
    }

    const input = await parseJsonBody(
      request,
      updateWorkflowSchema,
      "Invalid workflow update payload."
    );

    if (input.name && input.name !== workflow.name) {
      const existing = await listAutomationWorkflowsForWorkspace(access.db as any, workspaceId);
      if (
        existing.some(
          (candidate) => candidate._id !== workflowId && candidate.name === input.name?.trim()
        )
      ) {
        return apiError(
          409,
          "conflict",
          "A workflow with this name already exists in the workspace."
        );
      }
    }

    const updated = await updateAutomationWorkflowById(access.db as any, workflowId, {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.description !== undefined
        ? { description: input.description?.trim() || null }
        : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.trigger !== undefined ? { trigger: input.trigger } : {}),
      ...(input.filters !== undefined ? { filters: input.filters } : {}),
      ...(input.fieldSelection !== undefined ? { fieldSelection: input.fieldSelection } : {}),
      ...(input.transform !== undefined
        ? {
            transform: {
              runtime: input.transform.runtime || "quickjs",
              script: input.transform.script || null,
              timeoutMs: input.transform.timeoutMs,
            },
          }
        : {}),
      ...(input.destination !== undefined
        ? {
            destination: {
              type: "webhook",
              url: input.destination.url,
              signingSecret: input.destination.signingSecret || null,
              headers: input.destination.headers || {},
            },
          }
        : {}),
      updatedByUserId: access.userId,
    });
    if (!updated) {
      return apiError(404, "not_found", "Workflow not found.");
    }

    return apiSuccess({
      workspaceId,
      workflow: toWorkflowResponse(updated, {
        currentUserId: access.userId,
        currentUserRole: access.membership?.role || null,
        includeSecrets: true,
      }),
    });
  } catch (error) {
    if (error instanceof Error && error.message === "workspace_mismatch") {
      return apiError(403, "forbidden", "Workflow does not belong to this workspace.");
    }
    return mapApiError(error, "Failed to update automation workflow.");
  }
}

export async function DELETE(
  _request: Request,
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

    const workflow = await loadWorkflowForWorkspace(access.db as any, workspaceId, workflowId);
    if (!workflow) {
      return apiError(404, "not_found", "Workflow not found.");
    }
    if (!canManageWorkflow(workflow, access.userId, access.membership?.role || null)) {
      return apiError(403, "forbidden", "You do not have access to delete this workflow.");
    }

    await deleteAutomationWorkflowById(access.db as any, workflowId);
    return apiSuccess({
      workspaceId,
      workflowId,
      deleted: true,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "workspace_mismatch") {
      return apiError(403, "forbidden", "Workflow does not belong to this workspace.");
    }
    return mapApiError(error, "Failed to delete automation workflow.");
  }
}
