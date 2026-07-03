import type { McpResourceDefinition } from "@/lib/mcp-registry";

/**
 * Phase 8 pack: MCP resources.
 *
 * OWNED BY the resources pack agent. Fill RESOURCES with registry definitions for:
 * workspace summary, meetings, meeting transcripts, tasks, board state, people,
 * clients, calendar/deadline view.
 * Registration is already wired — src/lib/mcp-register-all.ts imports this module
 * exactly once. Do NOT edit any shared MCP file (registry, register-all, mcp-tools,
 * route) from this pack.
 *
 * Conventions:
 * - URI scheme: "taskwise://..." (e.g. "taskwise://workspace/summary",
 *   "taskwise://meetings", "taskwise://meetings/{meetingId}/transcript").
 *   For parameterized URIs set `matchesUri` and parse ids from the uri argument the
 *   handler receives — validate parsed ids (length caps, no regex injection).
 * - resources/read requires the "mcp:read" scope (enforced by the route).
 * - Handlers return { text, mimeType? }; text should be JSON or markdown. Never
 *   expose secrets/API keys/recordingId(...Hash); transcript resources should return
 *   bounded snippets or capped text, never unbounded raw transcript blobs.
 * - Shared helpers live in @/lib/mcp-tool-helpers.
 *
 * Definition skeleton:
 *   {
 *     uri: "taskwise://workspace/summary",
 *     name: "Workspace summary",
 *     description: "Counts and recent activity for the workspace.",
 *     mimeType: "application/json",
 *     handler: async ({ db, workspaceId }) => ({ text: JSON.stringify({...}) }),
 *   }
 */
const RESOURCES: McpResourceDefinition[] = [];

export const getMcpResourceDefinitions = (): McpResourceDefinition[] => RESOURCES;
