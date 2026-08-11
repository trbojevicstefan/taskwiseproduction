import type { Db } from "mongodb";
import "@/lib/mcp-register-all";
import {
  executeRegisteredMcpTool,
  listRegisteredMcpTools,
  type McpToolResult,
} from "@/lib/mcp-registry";
import type { ChatScope } from "@/types/general-chat";

export type OpenAiFunctionTool = {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  strict: false;
};

export type ScopedMcpToolExecution =
  | { ok: true; result: McpToolResult }
  | {
      ok: false;
      error: {
        code: "tool_not_available" | "invalid_arguments" | "tool_error";
        message: string;
      };
    };

export type PreparedScopedMcpToolCall =
  | { ok: true; name: string; args: Record<string, unknown> }
  | {
      ok: false;
      error: {
        code: "tool_not_available";
        message: string;
      };
    };

const WORKSPACE_READ_TOOLS = new Set([
  "search_workspace_knowledge",
  "search_meetings",
  "get_meeting",
  "get_transcript_snippets",
  "list_clients",
  "get_client_commitments",
  "list_tasks",
  "get_calendar_agenda",
  "get_board_snapshot",
]);

const MEETING_READ_TOOLS = new Set([
  "search_workspace_knowledge",
  "get_meeting",
  "get_transcript_snippets",
]);

// Client knowledge search already returns related commitments, meetings, tasks,
// and people. The broader individual tools cannot accept a company id, so they
// are intentionally omitted instead of letting a model escape client scope.
const CLIENT_READ_TOOLS = new Set(["search_workspace_knowledge"]);

const PERSON_READ_TOOLS = new Set([
  "search_workspace_knowledge",
  "get_client_commitments",
]);

const PLANNER_READ_TOOLS = new Set([
  "search_workspace_knowledge",
  "search_meetings",
  "get_meeting",
  "get_transcript_snippets",
  "list_tasks",
  "get_calendar_agenda",
  "get_board_snapshot",
]);

const getAllowedToolNames = (scope: ChatScope): ReadonlySet<string> => {
  switch (scope.type) {
    case "meeting":
      return MEETING_READ_TOOLS;
    case "client":
      return CLIENT_READ_TOOLS;
    case "person":
      return PERSON_READ_TOOLS;
    case "planner":
      return PLANNER_READ_TOOLS;
    case "workspace":
      return WORKSPACE_READ_TOOLS;
  }
};

const toResponsesParameters = (
  name: string,
  jsonSchema: Readonly<Record<string, unknown>>
): Record<string, unknown> => {
  if (name !== "search_workspace_knowledge") {
    return jsonSchema as Record<string, unknown>;
  }
  const properties =
    jsonSchema.properties && typeof jsonSchema.properties === "object"
      ? (jsonSchema.properties as Record<string, unknown>)
      : {};
  return {
    ...jsonSchema,
    required: Array.isArray(jsonSchema.required)
      ? jsonSchema.required.filter(
          (field) => field !== "scopeType" && field !== "scopeId"
        )
      : ["query"],
    properties: Object.fromEntries(
      Object.entries(properties).filter(
        ([field]) => field !== "scopeType" && field !== "scopeId"
      )
    ),
  };
};

export const getOpenAiReadToolsForScope = (
  scope: ChatScope
): OpenAiFunctionTool[] => {
  const allowedNames = getAllowedToolNames(scope);
  return listRegisteredMcpTools()
    .filter(
      (definition) =>
        definition.scope === "mcp:read" &&
        allowedNames.has(definition.name) &&
        /^[A-Za-z0-9_-]{1,64}$/.test(definition.name)
    )
    .map((definition) => ({
      type: "function" as const,
      name: definition.name,
      description: definition.description,
      parameters: toResponsesParameters(
        definition.name,
        definition.jsonSchema
      ),
      // Several registry entries intentionally preserve non-strict legacy
      // schemas. Zod validation remains authoritative on the server.
      strict: false as const,
    }));
};

const scopeToKnowledgeArgs = (
  scope: ChatScope,
  args: Record<string, unknown>
): Record<string, unknown> => {
  const scopedArgs = { ...args };
  delete scopedArgs.scopeType;
  delete scopedArgs.scopeId;
  scopedArgs.scopeType = scope.type;
  switch (scope.type) {
    case "meeting":
      scopedArgs.scopeId = scope.meetingId;
      break;
    case "client":
      scopedArgs.scopeId = scope.clientId;
      break;
    case "person":
      scopedArgs.scopeId = scope.personId;
      break;
    case "planner":
    case "workspace":
      break;
  }
  return scopedArgs;
};

const constrainToolArgs = (
  scope: ChatScope,
  name: string,
  args: Record<string, unknown>
): Record<string, unknown> => {
  if (name === "search_workspace_knowledge") {
    return scopeToKnowledgeArgs(scope, args);
  }
  if (
    scope.type === "meeting" &&
    (name === "get_meeting" || name === "get_transcript_snippets")
  ) {
    return { ...args, meetingId: scope.meetingId };
  }
  if (scope.type === "person" && name === "get_client_commitments") {
    return { ...args, personId: scope.personId };
  }
  return { ...args };
};

export const prepareScopedMcpToolCall = (input: {
  scope: ChatScope;
  name: string;
  args: Record<string, unknown>;
}): PreparedScopedMcpToolCall => {
  const available = getOpenAiReadToolsForScope(input.scope).some(
    (tool) => tool.name === input.name
  );
  if (!available) {
    return {
      ok: false,
      error: {
        code: "tool_not_available",
        message: "This read tool is not available in the active chat scope.",
      },
    };
  }

  return {
    ok: true,
    name: input.name,
    args: constrainToolArgs(input.scope, input.name, input.args),
  };
};

export async function executeScopedMcpTool(input: {
  db: Db;
  workspaceId: string;
  scope: ChatScope;
  name: string;
  args: Record<string, unknown>;
}): Promise<ScopedMcpToolExecution> {
  const prepared = prepareScopedMcpToolCall(input);
  if (!prepared.ok) return prepared;

  try {
    const result = await executeRegisteredMcpTool(
      { db: input.db, workspaceId: input.workspaceId },
      prepared.name,
      prepared.args
    );
    return { ok: true, result };
  } catch (error) {
    const code =
      error &&
      typeof error === "object" &&
      (error as { code?: unknown }).code === "invalid_arguments"
        ? "invalid_arguments"
        : "tool_error";
    return {
      ok: false,
      error: {
        code,
        message:
          code === "invalid_arguments"
            ? "The tool arguments were invalid."
            : "The read tool could not be completed safely.",
      },
    };
  }
}
