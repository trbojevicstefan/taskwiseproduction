import { getQuickJS, shouldInterruptAfterDeadline } from "quickjs-emscripten";
import { getWorkflowGuardrailConfig } from "@/lib/workflow-guardrails";

export type WorkflowTransformErrorCode =
  | "invalid_script"
  | "invalid_input"
  | "input_too_large"
  | "output_too_large"
  | "invalid_output"
  | "timeout"
  | "memory_limit"
  | "script_error"
  | "runtime_error";

export class WorkflowTransformError extends Error {
  code: WorkflowTransformErrorCode;
  details?: Record<string, unknown>;

  constructor(
    code: WorkflowTransformErrorCode,
    message: string,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "WorkflowTransformError";
    this.code = code;
    this.details = details;
  }
}

type RunWorkflowTransformInput = {
  workflowId: string;
  script: string;
  timeoutMs: number;
  payload: unknown;
  limits?: Partial<{
    memoryLimitBytes: number;
    stackLimitBytes: number;
    inputLimitBytes: number;
    outputLimitBytes: number;
  }>;
};

type RunWorkflowTransformResult = {
  payload: unknown;
  inputBytes: number;
  outputBytes: number;
};

const toUtf8Bytes = (value: string) => Buffer.byteLength(value, "utf8");

const normalizeTimeoutMs = (timeoutMs: number) => {
  if (!Number.isFinite(timeoutMs)) return 1_000;
  return Math.max(100, Math.min(10_000, Math.floor(timeoutMs)));
};

const buildTransformProgram = (inputJson: string, script: string) => `
"use strict";
const __taskwiseInput = JSON.parse(${JSON.stringify(inputJson)});
try { globalThis.fetch = undefined; } catch (_error) {}
try { globalThis.XMLHttpRequest = undefined; } catch (_error) {}
try { globalThis.WebSocket = undefined; } catch (_error) {}
try { globalThis.importScripts = undefined; } catch (_error) {}

const __taskwiseScriptSource = ${JSON.stringify(script)};
let __taskwiseTransform = null;
try {
  __taskwiseTransform = (new Function("return (" + __taskwiseScriptSource + ");"))();
} catch (_expressionError) {
  __taskwiseTransform = (new Function(__taskwiseScriptSource))();
}

if (typeof __taskwiseTransform !== "function") {
  throw new Error("Workflow transform script must evaluate to a function.");
}

const __taskwiseOutput = __taskwiseTransform(__taskwiseInput);
if (__taskwiseOutput && typeof __taskwiseOutput.then === "function") {
  throw new Error("Workflow transform script must return synchronously.");
}

const __taskwiseResolvedOutput =
  __taskwiseOutput === undefined ? __taskwiseInput : __taskwiseOutput;
const __taskwiseOutputJson = JSON.stringify(__taskwiseResolvedOutput);
if (typeof __taskwiseOutputJson !== "string") {
  throw new Error("Workflow transform output must be JSON-serializable.");
}

__taskwiseOutputJson;
`;

const normalizeVmError = (value: any) => {
  if (value && typeof value === "object") {
    const name = typeof value.name === "string" ? value.name : "Error";
    const message =
      typeof value.message === "string" && value.message.trim()
        ? value.message.trim()
        : "Workflow transform evaluation failed.";
    return {
      name,
      message,
      stack: typeof value.stack === "string" ? value.stack : null,
    };
  }

  return {
    name: "Error",
    message: String(value || "Workflow transform evaluation failed."),
    stack: null as string | null,
  };
};

const toTransformErrorFromVm = (vmError: any, workflowId: string) => {
  const normalized = normalizeVmError(vmError);
  const messageLower = normalized.message.toLowerCase();
  if (messageLower.includes("interrupted")) {
    return new WorkflowTransformError(
      "timeout",
      `Workflow transform timed out: ${normalized.message}`,
      {
        workflowId,
        vmError: normalized,
      }
    );
  }
  if (messageLower.includes("out of memory")) {
    return new WorkflowTransformError(
      "memory_limit",
      `Workflow transform exceeded memory limits: ${normalized.message}`,
      {
        workflowId,
        vmError: normalized,
      }
    );
  }
  return new WorkflowTransformError("script_error", normalized.message, {
    workflowId,
    vmError: normalized,
  });
};

export const runWorkflowTransform = async (
  input: RunWorkflowTransformInput
): Promise<RunWorkflowTransformResult> => {
  const workflowId = String(input.workflowId || "").trim();
  const script = String(input.script || "");
  if (!workflowId) {
    throw new WorkflowTransformError(
      "invalid_script",
      "Workflow transform requires a workflow id."
    );
  }
  if (!script.trim()) {
    throw new WorkflowTransformError(
      "invalid_script",
      "Workflow transform script is empty.",
      { workflowId }
    );
  }

  const guardrails = getWorkflowGuardrailConfig();
  const limits = {
    memoryLimitBytes:
      input.limits?.memoryLimitBytes ?? guardrails.transformMemoryLimitBytes,
    stackLimitBytes:
      input.limits?.stackLimitBytes ?? guardrails.transformStackLimitBytes,
    inputLimitBytes:
      input.limits?.inputLimitBytes ?? guardrails.transformInputLimitBytes,
    outputLimitBytes:
      input.limits?.outputLimitBytes ?? guardrails.transformOutputLimitBytes,
  };

  let inputJson = "null";
  try {
    const serializedInput = JSON.stringify(input.payload ?? null);
    if (typeof serializedInput !== "string") {
      throw new Error("Workflow transform input could not be serialized.");
    }
    inputJson = serializedInput;
  } catch (error) {
    throw new WorkflowTransformError(
      "invalid_input",
      "Workflow transform input must be JSON-serializable.",
      {
        workflowId,
        error:
          error instanceof Error ? { message: error.message } : { message: String(error) },
      }
    );
  }

  const inputBytes = toUtf8Bytes(inputJson);
  if (inputBytes > limits.inputLimitBytes) {
    throw new WorkflowTransformError(
      "input_too_large",
      `Workflow transform input exceeded ${limits.inputLimitBytes} bytes.`,
      {
        workflowId,
        inputBytes,
        inputLimitBytes: limits.inputLimitBytes,
      }
    );
  }

  const QuickJS = await getQuickJS();
  const runtime = QuickJS.newRuntime();
  runtime.setMemoryLimit(limits.memoryLimitBytes);
  runtime.setMaxStackSize(limits.stackLimitBytes);
  runtime.setInterruptHandler(
    shouldInterruptAfterDeadline(Date.now() + normalizeTimeoutMs(input.timeoutMs))
  );
  const context = runtime.newContext();

  try {
    const program = buildTransformProgram(inputJson, script);
    const result = context.evalCode(program, "workflow-transform.js", {
      type: "global",
      strict: true,
    });

    if (result.error) {
      const vmError = (() => {
        try {
          return context.dump(result.error);
        } finally {
          result.error.dispose();
        }
      })();
      throw toTransformErrorFromVm(vmError, workflowId);
    }

    const outputJson = (() => {
      try {
        if (context.typeof(result.value) !== "string") {
          throw new WorkflowTransformError(
            "invalid_output",
            "Workflow transform output must be JSON-serializable.",
            { workflowId }
          );
        }
        return context.getString(result.value);
      } finally {
        result.value.dispose();
      }
    })();

    const outputBytes = toUtf8Bytes(outputJson);
    if (outputBytes > limits.outputLimitBytes) {
      throw new WorkflowTransformError(
        "output_too_large",
        `Workflow transform output exceeded ${limits.outputLimitBytes} bytes.`,
        {
          workflowId,
          outputBytes,
          outputLimitBytes: limits.outputLimitBytes,
        }
      );
    }

    try {
      return {
        payload: JSON.parse(outputJson),
        inputBytes,
        outputBytes,
      };
    } catch (error) {
      throw new WorkflowTransformError(
        "invalid_output",
        "Workflow transform output could not be parsed as JSON.",
        {
          workflowId,
          error:
            error instanceof Error
              ? { message: error.message }
              : { message: String(error) },
        }
      );
    }
  } catch (error) {
    if (error instanceof WorkflowTransformError) {
      throw error;
    }
    throw new WorkflowTransformError(
      "runtime_error",
      error instanceof Error ? error.message : "Workflow transform runtime failed.",
      {
        workflowId,
      }
    );
  } finally {
    context.dispose();
    runtime.dispose();
  }
};
