import { z } from "zod";
import { apiError, apiSuccess, mapApiError, parseJsonBody } from "@/lib/api-route";
import {
  createAutomationWorkflow,
  listAutomationWorkflowsForWorkspace,
  serializeAutomationWorkflow,
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

const createWorkflowSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  enabled: z.boolean().optional(),
  trigger: z.enum(["meeting.ingested", "meeting.updated"]),
  filters: z.array(workflowFilterSchema).optional(),
  fieldSelection: workflowFieldSelectionSchema.optional(),
  transform: workflowTransformSchema.optional(),
  destination: workflowDestinationSchema,
});

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

export async function GET(
  _request: Request,
  {
    params,
  }: {
    params: { workspaceId: string } | Promise<{ workspaceId: string }>;
  }
) {
  try {
    const { workspaceId: rawWorkspaceId } = await Promise.resolve(params);
    const workspaceId = rawWorkspaceId?.trim();
    if (!workspaceId) {
      return apiError(400, "request_error", "Workspace ID is required.");
    }

    const access = await requireWorkspaceRouteAccess(workspaceId, "member", {
      adminVisibilityKey: "integrations",
    });
    if (!access.ok) {
      return access.response;
    }

    const workflows = await listAutomationWorkflowsForWorkspace(access.db as any, workspaceId);
    return apiSuccess({
      workspaceId,
      workflows: workflows.map((workflow) =>
        toWorkflowResponse(workflow, {
          currentUserId: access.userId,
          currentUserRole: access.membership?.role || null,
        })
      ),
      totalCount: workflows.length,
    });
  } catch (error) {
    return mapApiError(error, "Failed to load automation workflows.");
  }
}

export async function POST(
  request: Request,
  {
    params,
  }: {
    params: { workspaceId: string } | Promise<{ workspaceId: string }>;
  }
) {
  try {
    const { workspaceId: rawWorkspaceId } = await Promise.resolve(params);
    const workspaceId = rawWorkspaceId?.trim();
    if (!workspaceId) {
      return apiError(400, "request_error", "Workspace ID is required.");
    }

    const access = await requireWorkspaceRouteAccess(workspaceId, "member", {
      adminVisibilityKey: "integrations",
    });
    if (!access.ok) {
      return access.response;
    }
    if (!canManageWorkspaceWorkflows(access.membership?.role || null)) {
      return apiError(403, "forbidden", "You do not have access to create workflows.");
    }

    const input = await parseJsonBody(
      request,
      createWorkflowSchema,
      "Invalid workflow create payload."
    );
    const existing = await listAutomationWorkflowsForWorkspace(access.db as any, workspaceId);
    if (existing.some((workflow) => workflow.name === input.name.trim())) {
      return apiError(
        409,
        "conflict",
        "A workflow with this name already exists in the workspace."
      );
    }

    const workflow = await createAutomationWorkflow(access.db as any, {
      workspaceId,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      enabled: input.enabled,
      trigger: input.trigger,
      filters: input.filters || [],
      fieldSelection: input.fieldSelection,
      transform: input.transform,
      destination: {
        type: "webhook",
        url: input.destination.url,
        signingSecret: input.destination.signingSecret || null,
        headers: input.destination.headers || {},
      },
      createdByUserId: access.userId,
      updatedByUserId: access.userId,
    });

    return apiSuccess(
      {
        workspaceId,
        workflow: toWorkflowResponse(workflow, {
          currentUserId: access.userId,
          currentUserRole: access.membership?.role || null,
          includeSecrets: true,
        }),
      },
      { status: 201 }
    );
  } catch (error) {
    return mapApiError(error, "Failed to create automation workflow.");
  }
}
