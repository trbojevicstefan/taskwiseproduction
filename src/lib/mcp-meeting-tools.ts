import type { McpToolDefinition } from "@/lib/mcp-registry";

/**
 * Phase 8 pack: meeting tools.
 *
 * OWNED BY the meeting-tools pack agent. Fill MEETING_TOOLS with registry
 * definitions for: search_meetings, get_meeting, get_transcript_snippets.
 * Registration is already wired — src/lib/mcp-register-all.ts imports this module
 * exactly once. Do NOT edit any shared MCP file (registry, register-all, mcp-tools,
 * route) from this pack.
 *
 * Conventions:
 * - scope: "mcp:read"; validate ALL args with zod (hostile input), explicit max limits.
 * - Serializers must strip recordingId/recordingIdHash (serializeMeeting precedent in
 *   src/lib/mcp-read-tools.ts) and never return raw transcripts wholesale —
 *   get_transcript_snippets returns snippets only (tokenize + extractTranscriptSnippets
 *   from @/lib/workspace-retrieval).
 * - Shared helpers live in @/lib/mcp-tool-helpers (parseMcpToolArgs, clampListLimit,
 *   getWorkspaceMemberUserIds, buildWorkspaceFallbackScope, truncateText).
 *
 * Definition skeleton:
 *   {
 *     name: "get_meeting",
 *     description: "Get one meeting by id (no raw transcript).",
 *     scope: "mcp:read",
 *     inputSchema: z.object({ meetingId: z.string().trim().min(1).max(120) }),
 *     jsonSchema: { type: "object", additionalProperties: false, required: ["meetingId"],
 *       properties: { meetingId: { type: "string" } } },
 *     handler: async ({ db, workspaceId }, args) => ({ toolName, summary, data }),
 *   }
 */
const MEETING_TOOLS: McpToolDefinition[] = [];

export const getMcpMeetingToolDefinitions = (): McpToolDefinition[] => MEETING_TOOLS;
