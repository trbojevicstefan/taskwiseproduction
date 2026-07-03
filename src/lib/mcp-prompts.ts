import type { McpPromptDefinition } from "@/lib/mcp-registry";

/**
 * Phase 8 pack: MCP prompts.
 *
 * OWNED BY the prompts pack agent. Fill PROMPTS with registry definitions for the
 * five spec prompts: "summarize_client_commitments", "prioritize_open_tasks",
 * "project_status_update", "find_broken_promises",
 * "implementation_plan_from_meetings" (snake_case names; human titles go in
 * description).
 * Registration is already wired — src/lib/mcp-register-all.ts imports this module
 * exactly once. Do NOT edit any shared MCP file (registry, register-all, mcp-tools,
 * route) from this pack.
 *
 * Conventions:
 * - Prompts are pure message TEMPLATES: handlers must NOT call any model. They return
 *   { description, messages: [{ role, content: { type: "text", text } }] } and should
 *   instruct the CLIENT model which registered MCP tools/resources to call
 *   (e.g. list_clients + get_client_commitments).
 * - Declare `arguments` (name/description/required); the route rejects prompts/get
 *   calls missing required arguments before the handler runs. Argument values arrive
 *   as strings — sanitize/truncate before interpolation (hostile input).
 * - prompts/list and prompts/get require the "mcp:read" scope (enforced by the route).
 */
const PROMPTS: McpPromptDefinition[] = [];

export const getMcpPromptDefinitions = (): McpPromptDefinition[] => PROMPTS;
