import { z } from "zod";
import type { McpToolDefinition } from "@/lib/mcp-registry";
import {
  serializeMcpMeeting,
  truncateText,
} from "@/lib/mcp-tool-helpers";
import { extractTranscriptSnippets, scoreText, tokenize } from "@/lib/workspace-retrieval";

/**
 * Phase 8 pack: meeting tools.
 *
 * search_meetings / get_meeting / get_transcript_snippets — all "mcp:read".
 * Registration is wired in src/lib/mcp-register-all.ts; this module only
 * exports definitions.
 *
 * Conventions honored here:
 * - Every tool zod-validates args (hostile input) with explicit max limits.
 * - workspaceId comes exclusively from the tool context (route-authenticated),
 *   never from tool args.
 * - Serializers strip recordingId/recordingIdHash and never return raw
 *   transcripts wholesale — get_transcript_snippets returns bounded snippets
 *   only (tokenize + extractTranscriptSnippets from @/lib/workspace-retrieval).
 */

const SEARCH_CANDIDATE_LIMIT = 200;
const SEARCH_DEFAULT_LIMIT = 10;
const SEARCH_MAX_LIMIT = 25;
const SUMMARY_SNIPPET_MAX_CHARS = 280;
const MAX_TRANSCRIPT_SNIPPETS = 10;
const DEFAULT_TRANSCRIPT_SNIPPETS = 5;

// Keyword weights mirror the workspace retrieval ranking (title x3 /
// summary x2 / attendees x2) so MCP search matches in-app Chat search.
const TITLE_WEIGHT = 3;
const SUMMARY_WEIGHT = 2;
const ATTENDEE_WEIGHT = 2;

const searchMeetingsArgsSchema = z.object({
  query: z.string().trim().min(1).max(300),
  limit: z.number().int().min(1).max(SEARCH_MAX_LIMIT).optional(),
});

const getMeetingArgsSchema = z.object({
  meetingId: z.string().trim().min(1).max(120),
});

const getTranscriptSnippetsArgsSchema = z.object({
  meetingId: z.string().trim().min(1).max(120),
  query: z.string().trim().min(1).max(300),
  maxSnippets: z.number().int().min(1).max(MAX_TRANSCRIPT_SNIPPETS).optional(),
});

const extractAttendeeNames = (attendees: unknown): string => {
  if (!Array.isArray(attendees)) return "";
  return attendees
    .map((attendee) => {
      if (typeof attendee === "string") return attendee;
      if (attendee && typeof (attendee as any).name === "string") {
        return (attendee as any).name as string;
      }
      return "";
    })
    .filter(Boolean)
    .join(" ");
};

const MEETING_TOOLS: McpToolDefinition[] = [
  {
    name: "search_meetings",
    description:
      "Keyword-search workspace meetings by title, summary, and attendee names. Returns ranked matches without transcripts.",
    scope: "mcp:read",
    inputSchema: searchMeetingsArgsSchema,
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      required: ["query"],
      properties: {
        query: { type: "string", minLength: 1, maxLength: 300 },
        limit: { type: "number", minimum: 1, maximum: SEARCH_MAX_LIMIT },
      },
    },
    handler: async ({ db, workspaceId }, args) => {
      const { query, limit } = args as z.infer<typeof searchMeetingsArgsSchema>;
      const resultLimit = limit || SEARCH_DEFAULT_LIMIT;
      const tokens = tokenize(query);

      const candidates: any[] = await db
        .collection("meetings")
        .find(
          { workspaceId, isHidden: { $ne: true } },
          {
            projection: {
              _id: 1,
              title: 1,
              summary: 1,
              attendees: 1,
              startTime: 1,
              lastActivityAt: 1,
              createdAt: 1,
            },
          }
        )
        .sort({ lastActivityAt: -1, _id: -1 })
        .limit(SEARCH_CANDIDATE_LIMIT)
        .toArray();

      const meetings = candidates
        .map((meeting) => {
          const title = typeof meeting?.title === "string" ? meeting.title : "";
          const summary = typeof meeting?.summary === "string" ? meeting.summary : "";
          const attendeeNames = extractAttendeeNames(meeting?.attendees);
          const score =
            scoreText(title, tokens.tokens) * TITLE_WEIGHT +
            scoreText(summary, tokens.tokens) * SUMMARY_WEIGHT +
            scoreText(attendeeNames, tokens.tokens) * ATTENDEE_WEIGHT;
          const serialized = serializeMcpMeeting(meeting);
          return {
            id: serialized.id,
            title: title.trim() || "Untitled meeting",
            startTime: serialized.startTime,
            lastActivityAt: serialized.lastActivityAt,
            attendeeCount: Array.isArray(meeting?.attendees)
              ? meeting.attendees.length
              : 0,
            summarySnippet: summary
              ? truncateText(summary.trim(), SUMMARY_SNIPPET_MAX_CHARS)
              : null,
            score,
          };
        })
        .filter((meeting) => meeting.id && meeting.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, resultLimit);

      return {
        toolName: "search_meetings",
        summary: meetings.length
          ? `Found ${meetings.length} meeting(s) matching "${truncateText(query, 80)}".`
          : `No meetings matched "${truncateText(query, 80)}".`,
        data: { meetings, totalCount: meetings.length },
      };
    },
  },
  {
    name: "get_meeting",
    description:
      "Get one meeting by id: title, summary, attendees, and timing. Never includes the raw transcript.",
    scope: "mcp:read",
    inputSchema: getMeetingArgsSchema,
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      required: ["meetingId"],
      properties: {
        meetingId: { type: "string", minLength: 1, maxLength: 120 },
      },
    },
    handler: async ({ db, workspaceId }, args) => {
      const { meetingId } = args as z.infer<typeof getMeetingArgsSchema>;
      const meeting = await db.collection("meetings").findOne({
        workspaceId,
        isHidden: { $ne: true },
        $or: [{ _id: meetingId }, { id: meetingId }],
      } as any);
      const serialized = meeting ? serializeMcpMeeting(meeting) : null;
      return {
        toolName: "get_meeting",
        summary: serialized
          ? `Meeting found: ${String(serialized.title || serialized.id)}`
          : "Meeting not found.",
        data: { meeting: serialized },
      };
    },
  },
  {
    name: "get_transcript_snippets",
    description:
      "Extract short keyword-matching transcript snippets from one meeting. Returns bounded snippets, never the full transcript.",
    scope: "mcp:read",
    inputSchema: getTranscriptSnippetsArgsSchema,
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      required: ["meetingId", "query"],
      properties: {
        meetingId: { type: "string", minLength: 1, maxLength: 120 },
        query: { type: "string", minLength: 1, maxLength: 300 },
        maxSnippets: { type: "number", minimum: 1, maximum: MAX_TRANSCRIPT_SNIPPETS },
      },
    },
    handler: async ({ db, workspaceId }, args) => {
      const { meetingId, query, maxSnippets } = args as z.infer<
        typeof getTranscriptSnippetsArgsSchema
      >;
      const meeting = await db.collection("meetings").findOne(
        {
          workspaceId,
          isHidden: { $ne: true },
          $or: [{ _id: meetingId }, { id: meetingId }],
        } as any,
        { projection: { _id: 1, title: 1, originalTranscript: 1 } }
      );

      if (!meeting) {
        return {
          toolName: "get_transcript_snippets",
          summary: "Meeting not found.",
          data: { meeting: null, snippets: [], totalCount: 0 },
        };
      }

      const snippets = extractTranscriptSnippets(
        typeof (meeting as any).originalTranscript === "string"
          ? (meeting as any).originalTranscript
          : null,
        tokenize(query),
        maxSnippets || DEFAULT_TRANSCRIPT_SNIPPETS
      );

      return {
        toolName: "get_transcript_snippets",
        summary: snippets.length
          ? `Found ${snippets.length} transcript snippet(s).`
          : "No transcript snippets matched the query.",
        data: {
          meeting: {
            id: String((meeting as any)._id || meetingId),
            title: (meeting as any).title || "Untitled meeting",
          },
          snippets,
          totalCount: snippets.length,
        },
      };
    },
  },
];

export const getMcpMeetingToolDefinitions = (): McpToolDefinition[] => MEETING_TOOLS;
