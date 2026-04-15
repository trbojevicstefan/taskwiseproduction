import { randomUUID } from "crypto";
import type { Db } from "mongodb";

export type AutomationWorkflowTrigger = "meeting.ingested" | "meeting.updated";
export type AutomationWorkflowFilterOperator =
  | "equals"
  | "not_equals"
  | "contains"
  | "not_contains"
  | "in"
  | "not_in"
  | "exists"
  | "not_exists";

export interface AutomationWorkflowFilter {
  field: string;
  operator: AutomationWorkflowFilterOperator;
  value?: string | number | boolean | null | Array<string | number | boolean>;
  caseSensitive?: boolean;
}

export interface AutomationWorkflowFieldSelection {
  mode: "all" | "subset";
  fields: string[];
}

export interface AutomationWorkflowTransform {
  runtime: "quickjs";
  script: string | null;
  timeoutMs: number;
}

export interface AutomationWorkflowDestination {
  type: "webhook";
  url: string;
  signingSecret?: string | null;
  headers?: Record<string, string> | null;
}

export interface AutomationWorkflowDoc {
  _id: string;
  workspaceId: string;
  name: string;
  description?: string | null;
  enabled: boolean;
  version: number;
  trigger: AutomationWorkflowTrigger;
  filters: AutomationWorkflowFilter[];
  fieldSelection: AutomationWorkflowFieldSelection;
  transform: AutomationWorkflowTransform;
  destination: AutomationWorkflowDestination;
  createdByUserId: string;
  updatedByUserId: string;
  createdAt: Date;
  updatedAt: Date;
}

const AUTOMATION_WORKFLOWS_COLLECTION = "automationWorkflows";

const serializeDate = (value: Date | string | null | undefined) => {
  if (!value) return null;
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value;
};

export const ensureAutomationWorkflowIndexes = async (db: Db) => {
  const collection = db.collection<AutomationWorkflowDoc>(AUTOMATION_WORKFLOWS_COLLECTION);
  await Promise.all([
    collection.createIndex({ workspaceId: 1, updatedAt: -1 }),
    collection.createIndex({ workspaceId: 1, enabled: 1, trigger: 1, updatedAt: -1 }),
    collection.createIndex(
      { workspaceId: 1, name: 1 },
      { unique: true, name: "automation_workflows_workspace_name_unique" }
    ),
    collection.createIndex({ workspaceId: 1, "destination.type": 1, enabled: 1 }),
  ]);
};

export const createAutomationWorkflow = async (
  db: Db,
  input: {
    workspaceId: string;
    name: string;
    description?: string | null;
    enabled?: boolean;
    trigger: AutomationWorkflowTrigger;
    filters?: AutomationWorkflowFilter[];
    fieldSelection?: Partial<AutomationWorkflowFieldSelection>;
    transform?: Partial<AutomationWorkflowTransform>;
    destination: AutomationWorkflowDestination;
    createdByUserId: string;
    updatedByUserId?: string;
    version?: number;
    id?: string;
  }
) => {
  const now = new Date();
  const workflow: AutomationWorkflowDoc = {
    _id: input.id || randomUUID(),
    workspaceId: input.workspaceId,
    name: input.name.trim(),
    description: input.description || null,
    enabled: input.enabled ?? true,
    version: Math.max(1, input.version || 1),
    trigger: input.trigger,
    filters: input.filters || [],
    fieldSelection: {
      mode: input.fieldSelection?.mode || "all",
      fields: input.fieldSelection?.fields || [],
    },
    transform: {
      runtime: input.transform?.runtime || "quickjs",
      script: input.transform?.script || null,
      timeoutMs: Math.max(100, input.transform?.timeoutMs || 1_000),
    },
    destination: {
      type: "webhook",
      url: input.destination.url,
      signingSecret: input.destination.signingSecret || null,
      headers: input.destination.headers || {},
    },
    createdByUserId: input.createdByUserId,
    updatedByUserId: input.updatedByUserId || input.createdByUserId,
    createdAt: now,
    updatedAt: now,
  };

  await db
    .collection<AutomationWorkflowDoc>(AUTOMATION_WORKFLOWS_COLLECTION)
    .insertOne(workflow);

  return workflow;
};

export const findAutomationWorkflowById = async (db: Db, workflowId: string) =>
  db.collection<AutomationWorkflowDoc>(AUTOMATION_WORKFLOWS_COLLECTION).findOne({
    _id: workflowId,
  });

export const listAutomationWorkflowsForWorkspace = async (
  db: Db,
  workspaceId: string
) =>
  db
    .collection<AutomationWorkflowDoc>(AUTOMATION_WORKFLOWS_COLLECTION)
    .find({ workspaceId })
    .sort({ updatedAt: -1, createdAt: -1 })
    .toArray();

export const listEnabledAutomationWorkflowsForTrigger = async (
  db: Db,
  workspaceId: string,
  trigger: AutomationWorkflowTrigger
) =>
  db
    .collection<AutomationWorkflowDoc>(AUTOMATION_WORKFLOWS_COLLECTION)
    .find({ workspaceId, trigger, enabled: true })
    .sort({ updatedAt: -1, createdAt: -1 })
    .toArray();

export const updateAutomationWorkflowById = async (
  db: Db,
  workflowId: string,
  update: Partial<
    Omit<AutomationWorkflowDoc, "_id" | "workspaceId" | "createdAt" | "createdByUserId">
  >,
  options: { bumpVersion?: boolean } = {}
) => {
  await db.collection<AutomationWorkflowDoc>(AUTOMATION_WORKFLOWS_COLLECTION).updateOne(
    { _id: workflowId },
    {
      $set: {
        ...update,
        updatedAt: new Date(),
      },
      ...(options.bumpVersion === false ? {} : { $inc: { version: 1 } }),
    }
  );

  return findAutomationWorkflowById(db, workflowId);
};

export const deleteAutomationWorkflowById = async (db: Db, workflowId: string) =>
  db
    .collection<AutomationWorkflowDoc>(AUTOMATION_WORKFLOWS_COLLECTION)
    .deleteOne({ _id: workflowId });

export const serializeAutomationWorkflow = (
  workflow: AutomationWorkflowDoc | null,
  options: { includeSecrets?: boolean } = {}
) => {
  if (!workflow) return null;

  return {
    id: workflow._id,
    workspaceId: workflow.workspaceId,
    name: workflow.name,
    description: workflow.description || null,
    enabled: workflow.enabled,
    version: workflow.version,
    trigger: workflow.trigger,
    filters: workflow.filters,
    fieldSelection: workflow.fieldSelection,
    transform: workflow.transform,
    destination: {
      type: workflow.destination.type,
      url: workflow.destination.url,
      ...(options.includeSecrets
        ? { signingSecret: workflow.destination.signingSecret || null }
        : {}),
      headers: workflow.destination.headers || {},
    },
    createdByUserId: workflow.createdByUserId,
    updatedByUserId: workflow.updatedByUserId,
    createdAt: serializeDate(workflow.createdAt),
    updatedAt: serializeDate(workflow.updatedAt),
  };
};
