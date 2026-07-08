import { z } from "zod";
import {
  registerMcpPrompts,
  registerMcpResources,
  registerMcpTools,
  type McpToolDefinition,
} from "@/lib/mcp-registry";
import { executeMcpReadTool, listMcpReadTools } from "@/lib/mcp-read-tools";
import { executeMcpWriteTool, listMcpWriteTools } from "@/lib/mcp-write-tools";
import { getMcpMeetingToolDefinitions } from "@/lib/mcp-meeting-tools";
import { getMcpTaskToolDefinitions } from "@/lib/mcp-task-tools";
import { getMcpWorkspaceToolDefinitions } from "@/lib/mcp-workspace-tools";
import { getMcpResourceDefinitions } from "@/lib/mcp-resources";
import { getMcpPromptDefinitions } from "@/lib/mcp-prompts";

/**
 * Single MCP registration entrypoint (Phase 8).
 *
 * Wraps the 11 pre-registry tools (src/lib/mcp-read-tools.ts / mcp-write-tools.ts)
 * as registry entries WITHOUT changing their behavior, and imports each tool pack
 * exactly once. Pack agents add definitions inside their own pack file only —
 * nothing here (or in mcp-registry/mcp-tools/the route) needs to change when a
 * pack fills in its tools/resources/prompts.
 */

// Legacy tools zod-validate their own args inside executeMcp{Read,Write}Tool; the
// registry-level schema is a permissive object so behavior (including
// invalid_arguments error details) stays byte-identical.
const legacyToolArgsSchema = z.record(z.unknown());

// Compatibility call names documented in /docs/mcp. Resolved on tools/call via the
// registry alias map; intentionally never listed as separate tools in tools/list.
const LEGACY_READ_TOOL_ALIASES: Record<string, string[]> = {
  "people.list": ["attendees.list"],
  "people.get": ["attendees.get"],
};

const buildLegacyReadToolDefinitions = (): McpToolDefinition[] =>
  listMcpReadTools().map((tool) => ({
    name: tool.name,
    description: tool.description,
    scope: "mcp:read",
    inputSchema: legacyToolArgsSchema,
    jsonSchema: tool.inputSchema,
    aliases: LEGACY_READ_TOOL_ALIASES[tool.name],
    handler: ({ db, workspaceId }, args) =>
      executeMcpReadTool(db, workspaceId, tool.name, args),
  }));

const buildLegacyWriteToolDefinitions = (): McpToolDefinition[] =>
  listMcpWriteTools().map((tool) => ({
    name: tool.name,
    description: tool.description,
    scope: "mcp:write",
    inputSchema: legacyToolArgsSchema,
    jsonSchema: tool.inputSchema,
    handler: ({ db, workspaceId }, args) =>
      executeMcpWriteTool(db, workspaceId, tool.name, args),
  }));

let registered = false;

export const registerAllMcpDefinitions = () => {
  if (registered) return;
  registered = true;

  registerMcpTools([
    ...buildLegacyReadToolDefinitions(),
    ...buildLegacyWriteToolDefinitions(),
    ...getMcpMeetingToolDefinitions(),
    ...getMcpTaskToolDefinitions(),
    ...getMcpWorkspaceToolDefinitions(),
  ]);
  registerMcpResources(getMcpResourceDefinitions());
  registerMcpPrompts(getMcpPromptDefinitions());
};

// Register on import so any entrypoint (mcp-tools facade, transport route) that
// pulls this module gets a populated registry.
registerAllMcpDefinitions();
