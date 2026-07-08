import type { McpPromptDefinition, McpPromptMessage } from "@/lib/mcp-registry";

/**
 * Phase 8 pack: MCP prompts.
 *
 * Five spec prompts: summarize_client_commitments, prioritize_open_tasks,
 * prepare_status_update, find_broken_promises,
 * generate_implementation_plan_from_meetings.
 *
 * Conventions honored here:
 * - Prompts are pure message TEMPLATES — handlers never call any model or the
 *   database; they only assemble instructions telling the CLIENT model which
 *   registered MCP tools/resources to call.
 * - Argument values arrive as strings from hostile clients: they are
 *   sanitized (control characters stripped, whitespace collapsed) and
 *   truncated before interpolation.
 */

const MAX_ARG_CHARS = 200;

/** Strip control chars, collapse whitespace, and cap length (hostile input). */
export const sanitizePromptArg = (
  value: string | undefined,
  maxLength: number = MAX_ARG_CHARS
): string =>
  String(value ?? "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);

const userMessage = (text: string): McpPromptMessage[] => [
  { role: "user", content: { type: "text", text } },
];

const PROMPTS: McpPromptDefinition[] = [
  {
    name: "summarize_client_commitments",
    description:
      "Summarize client commitments: what was promised to each client, what is open, and what is overdue.",
    arguments: [
      {
        name: "client",
        description:
          "Optional client name or person id to focus on. Omit to cover all clients.",
        required: false,
      },
    ],
    handler: async (_ctx, args) => {
      const client = sanitizePromptArg(args.client);
      const focus = client
        ? `Focus only on the client "${client}".`
        : "Cover every client in the workspace.";
      return {
        description: "Summarize client commitments",
        messages: userMessage(
          [
            "You are connected to the Taskwise MCP server for this workspace.",
            `Summarize the commitments made to clients. ${focus}`,
            "",
            "Steps:",
            "1. Call the `list_clients` tool (or read `taskwise://clients`) to enumerate client people.",
            "2. For each relevant client, call `get_client_commitments` with their person id to load their open tasks and overdue flags.",
            "3. Where a commitment traces back to a meeting (sourceSessionId), you may call `get_meeting` for context.",
            "",
            "Produce a per-client summary: promised items, current status, due dates, and anything overdue. Flag clients with overdue commitments first. Base every statement strictly on the tool results — do not invent commitments.",
          ].join("\n")
        ),
      };
    },
  },
  {
    name: "prioritize_open_tasks",
    description:
      "Review and prioritize the workspace's open tasks, explaining what to do first and why.",
    arguments: [
      {
        name: "focus",
        description:
          "Optional focus area (e.g. a project, client, or person) to weight the recommendation.",
        required: false,
      },
    ],
    handler: async (_ctx, args) => {
      const focus = sanitizePromptArg(args.focus);
      return {
        description: "Prioritize open tasks",
        messages: userMessage(
          [
            "You are connected to the Taskwise MCP server for this workspace.",
            "Determine what should be worked on first.",
            focus ? `Give extra weight to work related to: "${focus}".` : "",
            "",
            "Steps:",
            "1. Optionally call the `prioritize_tasks` tool (requires the mcp:write scope) to refresh deterministic priority scores.",
            "2. Call `list_tasks` (or read `taskwise://tasks`) to load open tasks sorted by priority score.",
            "3. Use `get_calendar_agenda` to check imminent deadlines and overdue items.",
            "",
            "Recommend a ranked shortlist (top 5-10) with a one-line justification each, citing the priorityReason and due dates from the tool results. Do not invent tasks.",
          ]
            .filter(Boolean)
            .join("\n")
        ),
      };
    },
  },
  {
    name: "prepare_status_update",
    description:
      "Prepare a project status update from recent meetings, task states, and upcoming deadlines.",
    arguments: [
      {
        name: "audience",
        description: "Optional audience (e.g. 'client', 'leadership', 'team').",
        required: false,
      },
      {
        name: "timeframe",
        description: "Optional timeframe to cover (e.g. 'last week', 'this sprint').",
        required: false,
      },
    ],
    handler: async (_ctx, args) => {
      const audience = sanitizePromptArg(args.audience) || "the team";
      const timeframe = sanitizePromptArg(args.timeframe) || "the recent period";
      return {
        description: "Prepare a project status update",
        messages: userMessage(
          [
            "You are connected to the Taskwise MCP server for this workspace.",
            `Draft a status update for ${audience} covering ${timeframe}.`,
            "",
            "Steps:",
            "1. Read `taskwise://workspace/summary` for headline counts.",
            "2. Call `search_meetings` / `get_meeting` (or read `taskwise://meetings`) for recent decisions and discussion topics.",
            "3. Call `list_tasks` for completed vs open work, and `get_board_snapshot` for the board state.",
            "4. Call `get_calendar_agenda` for upcoming deadlines and reminders.",
            "",
            "Structure the update as: Highlights, Progress, Risks/Blockers, Upcoming. Every claim must trace to tool output; do not fabricate progress.",
          ].join("\n")
        ),
      };
    },
  },
  {
    name: "find_broken_promises",
    description:
      "Find broken promises: overdue or stalled commitments, especially those made to clients.",
    arguments: [
      {
        name: "person",
        description: "Optional person name or id to audit. Omit to audit everyone.",
        required: false,
      },
    ],
    handler: async (_ctx, args) => {
      const person = sanitizePromptArg(args.person);
      return {
        description: "Find broken promises",
        messages: userMessage(
          [
            "You are connected to the Taskwise MCP server for this workspace.",
            person
              ? `Audit commitments involving "${person}" for broken promises.`
              : "Audit the workspace for broken promises.",
            "",
            "Steps:",
            "1. Call `get_calendar_agenda` and `list_tasks` to find overdue tasks (overdue flag / past dueAt with status not done).",
            "2. Call `list_clients` then `get_client_commitments` per client to surface overdue client-facing commitments.",
            "3. For suspicious items, call `get_transcript_snippets` on the source meeting (sourceSessionId) with keywords from the task title to quote what was actually promised.",
            "",
            "Report each broken promise with: what was promised (with transcript evidence when available), who owns it, when it was due, and how late it is. Order by severity (client-facing and most overdue first). Only report items backed by tool results.",
          ].join("\n")
        ),
      };
    },
  },
  {
    name: "generate_implementation_plan_from_meetings",
    description:
      "Generate an implementation plan for a topic using evidence from meeting discussions and existing tasks.",
    arguments: [
      {
        name: "topic",
        description: "The feature/project/topic to plan (required).",
        required: true,
      },
    ],
    handler: async (_ctx, args) => {
      const topic = sanitizePromptArg(args.topic);
      return {
        description: "Generate an implementation plan from meetings",
        messages: userMessage(
          [
            "You are connected to the Taskwise MCP server for this workspace.",
            `Build an implementation plan for: "${topic}".`,
            "",
            "Steps:",
            "1. Call `search_meetings` with keywords from the topic to find relevant meetings.",
            "2. For the top matches, call `get_meeting` for summaries and `get_transcript_snippets` (same keywords) for verbatim requirements and constraints.",
            "3. Call `list_tasks` to see which related work already exists so the plan does not duplicate it.",
            "",
            "Produce a plan with: goals, requirements (each cited to a meeting/snippet), workstreams with concrete steps, owners where known, open questions, and suggested next tasks. If the user approves creating tasks, use `create_task_from_meeting` (requires the mcp:write scope) — one call per task, linked to the meeting the requirement came from.",
          ].join("\n")
        ),
      };
    },
  },
];

export const getMcpPromptDefinitions = (): McpPromptDefinition[] => PROMPTS;
