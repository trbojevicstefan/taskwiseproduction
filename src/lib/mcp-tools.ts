import type { Db } from "mongodb";
import { McpToolCallError } from "@/lib/mcp-read-tools";
import {
  executeRegisteredMcpTool,
  listRegisteredMcpTools,
  resolveToolScope,
  type McpToolResult,
} from "@/lib/mcp-registry";
import { registerAllMcpDefinitions } from "@/lib/mcp-register-all";

// Facade over the central MCP registry (src/lib/mcp-registry.ts). Export names and
// signatures are frozen — the transport route tests mock exactly this module shape.
registerAllMcpDefinitions();

export type McpToolExecutionResult = McpToolResult;

export { McpToolCallError };

export const listMcpTools = () =>
  listRegisteredMcpTools().map((definition) => ({
    name: definition.name,
    description: definition.description,
    inputSchema: definition.jsonSchema,
  }));

export const resolveMcpToolScopeRequirement = (toolName: string) => {
  const scope = resolveToolScope(toolName);
  if (scope) {
    return scope;
  }
  // Defensive fallback kept from the pre-registry facade: unregistered
  // action_items.update_* names still classify as writes.
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
): Promise<McpToolExecutionResult> =>
  executeRegisteredMcpTool({ db, workspaceId }, toolName, rawArgs);
