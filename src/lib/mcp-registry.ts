import type { Db } from "mongodb";
import type { ZodTypeAny } from "zod";
import { McpToolCallError } from "@/lib/mcp-read-tools";

/**
 * Central MCP registry (Phase 8).
 *
 * Single source of truth for MCP tools, resources, and prompts:
 * - name / description / JSON Schema shown to clients (tools/list, resources/list, prompts/list)
 * - zod schema used for server-side validation (assume hostile, prompt-injected clients)
 * - scope classification ("mcp:read" | "mcp:write") driving scope enforcement, the write
 *   rate-limit bucket, and write audit logging in the transport route
 * - alias resolution (aliases are accepted on tools/call but NEVER listed as separate tools)
 * - destructive-tool guard (destructive tools require an explicit `confirm: true` argument)
 *
 * Definitions are registered once via src/lib/mcp-register-all.ts. Tool packs
 * (mcp-meeting-tools / mcp-task-tools / mcp-workspace-tools / mcp-resources / mcp-prompts)
 * only export definition arrays; they never touch this module's state directly.
 *
 * Prompts are message TEMPLATES — handlers must never call an LLM.
 */

export type McpToolScope = "mcp:read" | "mcp:write";

export type McpToolContext = {
  db: Db;
  workspaceId: string;
};

export type McpToolResult = {
  toolName: string;
  summary: string;
  data: Record<string, unknown>;
};

export interface McpToolDefinition {
  /** Canonical tool name (the only name shown in tools/list). */
  name: string;
  /** Concise, accurate description surfaced to MCP clients. */
  description: string;
  /** Scope required to call the tool; also classifies write rate limiting + audit logging. */
  scope: McpToolScope;
  /** Server-side zod validation for tool arguments — inputs are hostile. */
  inputSchema: ZodTypeAny;
  /** JSON Schema advertised to clients via tools/list (kept in sync with inputSchema by hand). */
  jsonSchema: Record<string, unknown>;
  /** Alternate call names resolved on tools/call; never listed as separate tools. */
  aliases?: string[];
  /**
   * Destructive tools must be called with an explicit `confirm: true` argument;
   * the registry rejects unconfirmed calls before the handler runs.
   */
  destructive?: boolean;
  handler: (
    ctx: McpToolContext,
    args: Record<string, unknown>
  ) => Promise<McpToolResult>;
}

export type McpResourceContents = {
  uri: string;
  mimeType: string;
  text: string;
};

export interface McpResourceDefinition {
  /** Canonical resource URI (e.g. "taskwise://workspace/summary"). */
  uri: string;
  name: string;
  description: string;
  mimeType: string;
  /** Optional matcher for parameterized URIs (e.g. "taskwise://meetings/{id}/transcript"). */
  matchesUri?: (uri: string) => boolean;
  /** Returns resource text; must never expose secrets, API keys, or raw recording ids. */
  handler: (
    ctx: McpToolContext,
    uri: string
  ) => Promise<{ text: string; mimeType?: string }>;
}

export type McpPromptArgumentDefinition = {
  name: string;
  description?: string;
  required?: boolean;
};

export type McpPromptMessage = {
  role: "user" | "assistant";
  content: { type: "text"; text: string };
};

export interface McpPromptDefinition {
  name: string;
  description: string;
  arguments?: McpPromptArgumentDefinition[];
  /** Pure message template — must NOT call any model. */
  handler: (
    ctx: McpToolContext,
    args: Record<string, string>
  ) => Promise<{ description: string; messages: McpPromptMessage[] }>;
}

const toolRegistry = new Map<string, McpToolDefinition>();
const toolAliasMap = new Map<string, string>();
const resourceRegistry = new Map<string, McpResourceDefinition>();
const promptRegistry = new Map<string, McpPromptDefinition>();

export const registerMcpTools = (definitions: McpToolDefinition[]) => {
  for (const definition of definitions) {
    toolRegistry.set(definition.name, definition);
    for (const alias of definition.aliases || []) {
      toolAliasMap.set(alias, definition.name);
    }
  }
};

export const getMcpToolDefinition = (
  nameOrAlias: string
): McpToolDefinition | null => {
  const direct = toolRegistry.get(nameOrAlias);
  if (direct) return direct;
  const canonicalName = toolAliasMap.get(nameOrAlias);
  if (!canonicalName) return null;
  return toolRegistry.get(canonicalName) || null;
};

/** Canonical tools only — aliases are intentionally not listed. */
export const listRegisteredMcpTools = (): McpToolDefinition[] =>
  Array.from(toolRegistry.values());

export const resolveToolScope = (nameOrAlias: string): McpToolScope | null =>
  getMcpToolDefinition(nameOrAlias)?.scope ?? null;

export const executeRegisteredMcpTool = async (
  ctx: McpToolContext,
  nameOrAlias: string,
  rawArgs?: Record<string, unknown>
): Promise<McpToolResult> => {
  const definition = getMcpToolDefinition(nameOrAlias);
  if (!definition) {
    throw new McpToolCallError("tool_not_found", `Tool not found: ${nameOrAlias}`);
  }

  const parsed = definition.inputSchema.safeParse(rawArgs || {});
  if (!parsed.success) {
    throw new McpToolCallError(
      "invalid_arguments",
      "Invalid tool arguments.",
      parsed.error.flatten()
    );
  }

  const args = (parsed.data ?? {}) as Record<string, unknown>;
  if (definition.destructive && args.confirm !== true) {
    throw new McpToolCallError(
      "invalid_arguments",
      `${definition.name} is a destructive tool and requires explicit confirmation. Pass "confirm": true to proceed.`
    );
  }

  return definition.handler(ctx, args);
};

export const registerMcpResources = (definitions: McpResourceDefinition[]) => {
  for (const definition of definitions) {
    resourceRegistry.set(definition.uri, definition);
  }
};

export const listRegisteredMcpResources = (): McpResourceDefinition[] =>
  Array.from(resourceRegistry.values());

export const getMcpResourceDefinition = (
  uri: string
): McpResourceDefinition | null => {
  const direct = resourceRegistry.get(uri);
  if (direct) return direct;
  for (const definition of resourceRegistry.values()) {
    if (definition.matchesUri?.(uri)) {
      return definition;
    }
  }
  return null;
};

/** Returns null when no registered resource matches the URI. */
export const readRegisteredMcpResource = async (
  ctx: McpToolContext,
  uri: string
): Promise<McpResourceContents | null> => {
  const definition = getMcpResourceDefinition(uri);
  if (!definition) return null;
  const result = await definition.handler(ctx, uri);
  return {
    uri,
    mimeType: result.mimeType || definition.mimeType,
    text: result.text,
  };
};

export const registerMcpPrompts = (definitions: McpPromptDefinition[]) => {
  for (const definition of definitions) {
    promptRegistry.set(definition.name, definition);
  }
};

export const listRegisteredMcpPrompts = (): McpPromptDefinition[] =>
  Array.from(promptRegistry.values());

export const getMcpPromptDefinition = (name: string): McpPromptDefinition | null =>
  promptRegistry.get(name) || null;

/** Test-only: clears all registries (jest isolates module state per test file). */
export const resetMcpRegistryForTests = () => {
  toolRegistry.clear();
  toolAliasMap.clear();
  resourceRegistry.clear();
  promptRegistry.clear();
};
