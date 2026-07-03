import type { McpToolDefinition } from "@/lib/mcp-registry";

/**
 * Phase 8 pack: workspace tools.
 *
 * OWNED BY the workspace-tools pack agent. Fill WORKSPACE_TOOLS with registry
 * definitions for: list_clients, get_client_commitments, get_board_snapshot,
 * get_calendar_agenda.
 * Registration is already wired — src/lib/mcp-register-all.ts imports this module
 * exactly once. Do NOT edit any shared MCP file (registry, register-all, mcp-tools,
 * route) from this pack.
 *
 * Conventions:
 * - scope: "mcp:read" for all four; validate ALL args with zod, explicit max limits.
 * - Do NOT import session-authed route handlers (calendar/people/boards routes use
 *   resolveWorkspaceScopeForUser). Rebuild scoping with getWorkspaceMemberUserIds +
 *   buildWorkspaceFallbackScope from @/lib/mcp-tool-helpers.
 * - Clients = people with personType "client"; commitments matching should reuse the
 *   uid → email → nameKey matcher pattern (buildPersonTaskMatcher precedent in
 *   src/lib/mcp-read-tools.ts people.get).
 * - Boards: ensureDefaultBoard (@/lib/boards) + the boardItems aggregation pattern in
 *   src/app/api/workspaces/[workspaceId]/boards/[boardId]/items/route.ts is
 *   session-free once you have db + workspaceId.
 * - Serializers must strip recordingId/recordingIdHash and never expose secrets.
 */
const WORKSPACE_TOOLS: McpToolDefinition[] = [];

export const getMcpWorkspaceToolDefinitions = (): McpToolDefinition[] => WORKSPACE_TOOLS;
