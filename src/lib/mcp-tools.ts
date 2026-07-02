import type { Db } from "mongodb";
import {
  executeMcpReadTool,
  listMcpReadTools,
  type McpReadToolExecutionResult,
  McpToolCallError,
} from "@/lib/mcp-read-tools";
import {
  executeMcpWriteTool,
  getMcpWriteToolNames,
  listMcpWriteTools,
  type McpWriteToolExecutionResult,
} from "@/lib/mcp-write-tools";

export type McpToolExecutionResult =
  | McpReadToolExecutionResult
  | McpWriteToolExecutionResult;

export { McpToolCallError };

const writeToolNameSet = new Set<string>(getMcpWriteToolNames());
const readToolNameSet = new Set<string>(listMcpReadTools().map((tool) => tool.name));

export const listMcpTools = () => [...listMcpReadTools(), ...listMcpWriteTools()];

export const resolveMcpToolScopeRequirement = (toolName: string) => {
  if (writeToolNameSet.has(toolName)) {
    return "mcp:write";
  }
  if (readToolNameSet.has(toolName)) {
    return "mcp:read";
  }
  if (toolName.startsWith("action_items.update_")) {
    return "mcp:write";
  }
  return null;
};

export const executeMcpTool = async (
  db: Db,
  workspaceId: string,
  toolName: string,
  rawArgs?: Record<string, unknown>
): Promise<McpToolExecutionResult> => {
  if (writeToolNameSet.has(toolName)) {
    return executeMcpWriteTool(db, workspaceId, toolName, rawArgs);
  }
  if (readToolNameSet.has(toolName)) {
    return executeMcpReadTool(db, workspaceId, toolName, rawArgs);
  }
  throw new McpToolCallError("tool_not_found", `Tool not found: ${toolName}`);
};
