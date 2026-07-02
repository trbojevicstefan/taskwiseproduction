import type { Db } from "mongodb";
import { disableAutomationWorkflowById } from "@/lib/automation-workflows";

const DEFAULT_TRANSFORM_MEMORY_LIMIT_BYTES = 8 * 1024 * 1024;
const DEFAULT_TRANSFORM_STACK_LIMIT_BYTES = 512 * 1024;
const DEFAULT_TRANSFORM_INPUT_LIMIT_BYTES = 256 * 1024;
const DEFAULT_TRANSFORM_OUTPUT_LIMIT_BYTES = 256 * 1024;
const DEFAULT_DELIVERY_BODY_LIMIT_BYTES = 512 * 1024;
const DEFAULT_AUTO_DISABLE_FAILURE_THRESHOLD = 5;
const DEFAULT_AUTO_DISABLE_WINDOW_MS = 60 * 60 * 1000;

export const WORKFLOW_GUARDRAIL_SYSTEM_USER_ID = "system:workflow-guardrail";

const parseIntegerEnv = (
  value: string | undefined,
  fallback: number,
  options: { min?: number; max?: number } = {}
) => {
  if (typeof value !== "string") return fallback;
  const parsed = Number.parseInt(value.trim(), 10);
  if (!Number.isFinite(parsed)) return fallback;

  const min = options.min ?? Number.MIN_SAFE_INTEGER;
  const max = options.max ?? Number.MAX_SAFE_INTEGER;
  return Math.min(max, Math.max(min, parsed));
};

export const getWorkflowGuardrailConfig = () => ({
  transformMemoryLimitBytes: parseIntegerEnv(
    process.env.WORKFLOW_TRANSFORM_MEMORY_LIMIT_BYTES,
    DEFAULT_TRANSFORM_MEMORY_LIMIT_BYTES,
    { min: 256 * 1024, max: 128 * 1024 * 1024 }
  ),
  transformStackLimitBytes: parseIntegerEnv(
    process.env.WORKFLOW_TRANSFORM_STACK_LIMIT_BYTES,
    DEFAULT_TRANSFORM_STACK_LIMIT_BYTES,
    { min: 64 * 1024, max: 8 * 1024 * 1024 }
  ),
  transformInputLimitBytes: parseIntegerEnv(
    process.env.WORKFLOW_TRANSFORM_INPUT_LIMIT_BYTES,
    DEFAULT_TRANSFORM_INPUT_LIMIT_BYTES,
    { min: 1024, max: 8 * 1024 * 1024 }
  ),
  transformOutputLimitBytes: parseIntegerEnv(
    process.env.WORKFLOW_TRANSFORM_OUTPUT_LIMIT_BYTES,
    DEFAULT_TRANSFORM_OUTPUT_LIMIT_BYTES,
    { min: 1024, max: 8 * 1024 * 1024 }
  ),
  deliveryBodyLimitBytes: parseIntegerEnv(
    process.env.WORKFLOW_DELIVERY_BODY_LIMIT_BYTES,
    DEFAULT_DELIVERY_BODY_LIMIT_BYTES,
    { min: 1024, max: 16 * 1024 * 1024 }
  ),
  autoDisableFailureThreshold: parseIntegerEnv(
    process.env.WORKFLOW_AUTO_DISABLE_FAILURE_THRESHOLD,
    DEFAULT_AUTO_DISABLE_FAILURE_THRESHOLD,
    { min: 0, max: 1000 }
  ),
  autoDisableWindowMs: parseIntegerEnv(
    process.env.WORKFLOW_AUTO_DISABLE_WINDOW_MS,
    DEFAULT_AUTO_DISABLE_WINDOW_MS,
    { min: 60 * 1000, max: 30 * 24 * 60 * 60 * 1000 }
  ),
});

export const maybeAutoDisableWorkflowForRepeatedFailures = async (
  db: Db,
  input: {
    workflowId: string;
    workspaceId: string;
    reason: string;
    now?: Date;
    updatedByUserId?: string;
  }
) => {
  const workflowId = String(input.workflowId || "").trim();
  const workspaceId = String(input.workspaceId || "").trim();
  const reason = String(input.reason || "").trim();
  const config = getWorkflowGuardrailConfig();

  if (!workflowId || !workspaceId || !reason) {
    return {
      checked: false,
      threshold: config.autoDisableFailureThreshold,
      failedCount: 0,
      disabled: false,
      windowStartAt: null as string | null,
    };
  }
  if (config.autoDisableFailureThreshold <= 0) {
    return {
      checked: false,
      threshold: config.autoDisableFailureThreshold,
      failedCount: 0,
      disabled: false,
      windowStartAt: null as string | null,
    };
  }

  const now = input.now || new Date();
  const windowStartAt = new Date(now.getTime() - config.autoDisableWindowMs);

  const failedCount = await db.collection("webhookDeliveries").countDocuments({
    workflowId,
    workspaceId,
    status: "failed",
    eventType: { $ne: "workflow.test" },
    failedAt: { $gte: windowStartAt },
  });

  if (failedCount < config.autoDisableFailureThreshold) {
    return {
      checked: true,
      threshold: config.autoDisableFailureThreshold,
      failedCount,
      disabled: false,
      windowStartAt: windowStartAt.toISOString(),
    };
  }

  const updatedWorkflow = await disableAutomationWorkflowById(db, workflowId, {
    updatedByUserId: input.updatedByUserId || WORKFLOW_GUARDRAIL_SYSTEM_USER_ID,
    reason,
    disabledAt: now,
    failureCount: failedCount,
    windowStartAt,
  });

  return {
    checked: true,
    threshold: config.autoDisableFailureThreshold,
    failedCount,
    disabled: Boolean(updatedWorkflow && updatedWorkflow.enabled === false),
    windowStartAt: windowStartAt.toISOString(),
  };
};
