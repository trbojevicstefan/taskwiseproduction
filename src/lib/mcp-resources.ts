import type { Db } from "mongodb";
import type { McpResourceDefinition, McpToolContext } from "@/lib/mcp-registry";
import { McpToolCallError } from "@/lib/mcp-read-tools";
import {
  buildWorkspaceFallbackScope,
  getWorkspaceMemberUserIds,
  toDateOrNull,
  truncateText,
} from "@/lib/mcp-tool-helpers";

/**
 * Phase 8 pack: MCP resources.
 *
 * Eight taskwise:// resources: workspace summary, meetings, meeting
 * transcript (parameterized), tasks, board state, people, clients, calendar.
 *
 * Conventions honored here:
 * - workspaceId comes exclusively from the route-authenticated context.
 * - Handlers return whitelisted fields only — recordingId/recordingIdHash,
 *   tokens, and API keys never appear because fields are picked explicitly,
 *   never spread from raw docs.
 * - The transcript resource returns CAPPED text (never an unbounded blob) and
 *   validates the parsed meeting id (length + charset, equality lookup only —
 *   no regex built from input).
 */

const SUMMARY_RECENT_MEETINGS = 5;
const MEETINGS_LIMIT = 20;
const MEETING_SUMMARY_MAX_CHARS = 280;
const TRANSCRIPT_MAX_CHARS = 20_000;
const TASKS_LIMIT = 50;
const BOARD_ITEMS_PER_COLUMN = 15;
const BOARD_MAX_ITEMS = 300;
const PEOPLE_LIMIT = 50;
const CLIENTS_LIMIT = 100;
const CALENDAR_RANGE_DAYS = 14;
const CALENDAR_MAX_MEETINGS = 100;
const CALENDAR_MAX_TASKS = 200;
const CALENDAR_MAX_REMINDERS = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

const TRANSCRIPT_URI_PATTERN =
  /^taskwise:\/\/meetings\/([A-Za-z0-9._:-]{1,120})\/transcript$/;

const toIso = (value: unknown): string | null =>
  toDateOrNull(value)?.toISOString() ?? null;

const asJson = (payload: unknown) => ({ text: JSON.stringify(payload, null, 2) });

const openTaskConditions = (scope: Record<string, unknown>) => [
  scope,
  { taskState: { $ne: "archived" } },
  { cleanupStatus: { $ne: "expired" } },
];

const getScope = async (db: Db, workspaceId: string) => {
  const memberUserIds = await getWorkspaceMemberUserIds(db, workspaceId);
  return buildWorkspaceFallbackScope(workspaceId, memberUserIds);
};

const pickMeeting = (meeting: any) => ({
  id: String(meeting._id),
  title: meeting.title || "Untitled meeting",
  startTime: toIso(meeting.startTime),
  attendeeCount: Array.isArray(meeting.attendees) ? meeting.attendees.length : 0,
  summary:
    typeof meeting.summary === "string" && meeting.summary.trim()
      ? truncateText(meeting.summary.trim(), MEETING_SUMMARY_MAX_CHARS)
      : null,
});

const pickTask = (task: any) => ({
  id: String(task._id),
  title: task.title || "",
  status: task.status ?? null,
  dueAt: toIso(task.dueAt),
  priorityScore: typeof task.priorityScore === "number" ? task.priorityScore : null,
  priorityLabel: task.priorityLabel ?? null,
  priorityReason: task.priorityReason ?? null,
  assigneeName: task.assigneeName ?? null,
  sourceSessionId: task.sourceSessionId ?? null,
});

const pickPerson = (person: any) => ({
  id: String(person._id),
  name: person.name || "",
  email: person.email ?? null,
  personType: person.personType ?? null,
  company: person.company ?? null,
  lastSeenAt: toIso(person.lastSeenAt),
});

const RESOURCES: McpResourceDefinition[] = [
  {
    uri: "taskwise://workspace/summary",
    name: "Workspace summary",
    description:
      "Counts (meetings, open/overdue tasks, people, clients, scheduled reminders) and the most recent meetings.",
    mimeType: "application/json",
    handler: async ({ db, workspaceId }: McpToolContext) => {
      const scope = await getScope(db, workspaceId);
      const now = new Date();
      const nowIso = now.toISOString();

      const [
        meetingCount,
        openTaskCount,
        overdueTaskCount,
        peopleCount,
        clientCount,
        scheduledReminderCount,
        recentMeetings,
      ] = await Promise.all([
        db
          .collection("meetings")
          .countDocuments({ workspaceId, isHidden: { $ne: true } }),
        db.collection("tasks").countDocuments({
          $and: [...openTaskConditions(scope), { status: { $ne: "done" } }],
        }),
        db.collection("tasks").countDocuments({
          $and: [
            ...openTaskConditions(scope),
            { status: { $ne: "done" } },
            // dueAt is schemaless (Date OR ISO string) — count both types.
            {
              $or: [{ dueAt: { $lt: now } }, { dueAt: { $gt: "", $lt: nowIso } }],
            },
          ],
        }),
        db.collection("people").countDocuments(scope as any),
        db
          .collection("people")
          .countDocuments({ $and: [scope, { personType: "client" }] }),
        db
          .collection("taskReminders")
          .countDocuments({ workspaceId, status: "scheduled" }),
        db
          .collection("meetings")
          .find(
            { workspaceId, isHidden: { $ne: true } },
            { projection: { _id: 1, title: 1, startTime: 1, attendees: 1, summary: 1 } }
          )
          .sort({ lastActivityAt: -1, _id: -1 })
          .limit(SUMMARY_RECENT_MEETINGS)
          .toArray(),
      ]);

      return asJson({
        workspaceId,
        generatedAt: nowIso,
        counts: {
          meetings: meetingCount,
          openTasks: openTaskCount,
          overdueTasks: overdueTaskCount,
          people: peopleCount,
          clients: clientCount,
          scheduledReminders: scheduledReminderCount,
        },
        recentMeetings: recentMeetings.map(pickMeeting),
      });
    },
  },
  {
    uri: "taskwise://meetings",
    name: "Recent meetings",
    description: "The 20 most recently active meetings (no transcripts).",
    mimeType: "application/json",
    handler: async ({ db, workspaceId }: McpToolContext) => {
      const meetings = await db
        .collection("meetings")
        .find(
          { workspaceId, isHidden: { $ne: true } },
          { projection: { _id: 1, title: 1, startTime: 1, attendees: 1, summary: 1 } }
        )
        .sort({ lastActivityAt: -1, _id: -1 })
        .limit(MEETINGS_LIMIT)
        .toArray();
      return asJson({ meetings: meetings.map(pickMeeting), totalCount: meetings.length });
    },
  },
  {
    uri: "taskwise://meetings/{meetingId}/transcript",
    name: "Meeting transcript (capped)",
    description:
      "Transcript text for one meeting, capped at 20k characters. Substitute {meetingId} with a meeting id.",
    mimeType: "text/plain",
    matchesUri: (uri: string) => TRANSCRIPT_URI_PATTERN.test(uri),
    handler: async ({ db, workspaceId }: McpToolContext, uri: string) => {
      const match = TRANSCRIPT_URI_PATTERN.exec(uri);
      const meetingId = match?.[1];
      if (!meetingId) {
        throw new McpToolCallError(
          "invalid_arguments",
          "Invalid transcript resource URI. Expected taskwise://meetings/{meetingId}/transcript."
        );
      }

      const meeting = await db.collection("meetings").findOne(
        {
          workspaceId,
          isHidden: { $ne: true },
          $or: [{ _id: meetingId }, { id: meetingId }],
        } as any,
        { projection: { _id: 1, title: 1, originalTranscript: 1 } }
      );
      if (!meeting) {
        throw new McpToolCallError("invalid_arguments", "Meeting not found.");
      }

      const transcript =
        typeof (meeting as any).originalTranscript === "string"
          ? (meeting as any).originalTranscript
          : "";
      if (!transcript.trim()) {
        return {
          text: `No transcript available for meeting "${(meeting as any).title || meetingId}".`,
        };
      }
      const capped =
        transcript.length > TRANSCRIPT_MAX_CHARS
          ? `${transcript.slice(0, TRANSCRIPT_MAX_CHARS)}\n\n[Transcript truncated at ${TRANSCRIPT_MAX_CHARS} characters]`
          : transcript;
      return { text: capped };
    },
  },
  {
    uri: "taskwise://tasks",
    name: "Open tasks",
    description: "Top 50 open tasks ordered by priority score.",
    mimeType: "application/json",
    handler: async ({ db, workspaceId }: McpToolContext) => {
      const scope = await getScope(db, workspaceId);
      const tasks = await db
        .collection("tasks")
        .find(
          {
            $and: [...openTaskConditions(scope), { status: { $ne: "done" } }],
          },
          {
            projection: {
              _id: 1,
              title: 1,
              status: 1,
              dueAt: 1,
              priorityScore: 1,
              priorityLabel: 1,
              priorityReason: 1,
              assigneeName: 1,
              sourceSessionId: 1,
            },
          }
        )
        .sort({ priorityScore: -1, lastUpdated: -1, _id: -1 })
        .limit(TASKS_LIMIT)
        .toArray();
      return asJson({ tasks: tasks.map(pickTask), totalCount: tasks.length });
    },
  },
  {
    uri: "taskwise://board",
    name: "Board state",
    description:
      "Default board snapshot: columns in order with item counts and their top tasks.",
    mimeType: "application/json",
    handler: async ({ db, workspaceId }: McpToolContext) => {
      const board =
        (await db.collection("boards").findOne({ workspaceId, isDefault: true })) ||
        (
          await db
            .collection("boards")
            .find({ workspaceId })
            .sort({ createdAt: 1, _id: 1 })
            .limit(1)
            .toArray()
        )[0] ||
        null;
      if (!board) {
        return asJson({ board: null, statuses: [], totalItems: 0 });
      }
      const boardId = String((board as any)._id);

      const [statuses, items] = await Promise.all([
        db
          .collection("boardStatuses")
          .find({ workspaceId, boardId })
          .sort({ order: 1, _id: 1 })
          .toArray(),
        db
          .collection("boardItems")
          .aggregate([
            { $match: { workspaceId, boardId } },
            {
              $lookup: {
                from: "tasks",
                let: { lookupTaskId: "$taskId" },
                pipeline: [
                  {
                    $match: {
                      $expr: { $eq: ["$_id", "$$lookupTaskId"] },
                      workspaceId,
                      taskState: { $ne: "archived" },
                      cleanupStatus: { $ne: "expired" },
                    },
                  },
                  {
                    $project: {
                      _id: 1,
                      title: 1,
                      status: 1,
                      dueAt: 1,
                      priorityScore: 1,
                      priorityLabel: 1,
                      assigneeName: 1,
                    },
                  },
                ],
                as: "task",
              },
            },
            { $unwind: "$task" },
            { $sort: { statusId: 1, rank: 1, createdAt: 1 } },
            { $limit: BOARD_MAX_ITEMS },
          ])
          .toArray(),
      ]);

      const itemsByStatusId = new Map<string, any[]>();
      for (const item of items) {
        const statusId = String((item as any).statusId || "");
        const bucket = itemsByStatusId.get(statusId) || [];
        bucket.push((item as any).task);
        itemsByStatusId.set(statusId, bucket);
      }

      return asJson({
        board: {
          id: boardId,
          name: (board as any).name || "",
          isDefault: Boolean((board as any).isDefault),
        },
        statuses: statuses.map((status: any) => {
          const statusItems = itemsByStatusId.get(String(status._id)) || [];
          return {
            id: String(status._id),
            label: status.label || "",
            category: status.category || null,
            order: typeof status.order === "number" ? status.order : 0,
            itemCount: statusItems.length,
            items: statusItems.slice(0, BOARD_ITEMS_PER_COLUMN).map(pickTask),
          };
        }),
        totalItems: items.length,
      });
    },
  },
  {
    uri: "taskwise://people",
    name: "People",
    description: "The 50 most recently seen people in the workspace.",
    mimeType: "application/json",
    handler: async ({ db, workspaceId }: McpToolContext) => {
      const scope = await getScope(db, workspaceId);
      const people = await db
        .collection("people")
        .find(scope as any, {
          projection: {
            _id: 1,
            name: 1,
            email: 1,
            personType: 1,
            company: 1,
            lastSeenAt: 1,
          },
        })
        .sort({ lastSeenAt: -1, _id: -1 })
        .limit(PEOPLE_LIMIT)
        .toArray();
      return asJson({ people: people.map(pickPerson), totalCount: people.length });
    },
  },
  {
    uri: "taskwise://clients",
    name: "Clients",
    description: "Client people (personType 'client') with company and follow-up info.",
    mimeType: "application/json",
    handler: async ({ db, workspaceId }: McpToolContext) => {
      const scope = await getScope(db, workspaceId);
      const clients = await db
        .collection("people")
        .find(
          { $and: [scope, { personType: "client" }] },
          {
            projection: {
              _id: 1,
              name: 1,
              email: 1,
              personType: 1,
              company: 1,
              lastSeenAt: 1,
              nextFollowUpAt: 1,
            },
          }
        )
        .sort({ lastSeenAt: -1, _id: -1 })
        .limit(CLIENTS_LIMIT)
        .toArray();
      return asJson({
        clients: clients.map((client: any) => ({
          ...pickPerson(client),
          nextFollowUpAt: toIso(client.nextFollowUpAt),
        })),
        totalCount: clients.length,
      });
    },
  },
  {
    uri: "taskwise://calendar",
    name: "Calendar / deadlines",
    description:
      "Next 14 days: meetings, tasks due (with overdue flags), and scheduled Slack reminders.",
    mimeType: "application/json",
    handler: async ({ db, workspaceId }: McpToolContext) => {
      const scope = await getScope(db, workspaceId);
      const from = new Date();
      const to = new Date(from.getTime() + CALENDAR_RANGE_DAYS * DAY_MS);
      const windowFromIso = from.toISOString();
      const windowToIso = to.toISOString();

      const [meetingDocs, taskDocs, reminderDocs] = await Promise.all([
        db
          .collection("meetings")
          .find(
            {
              $and: [
                scope,
                { isHidden: { $ne: true } },
                {
                  $or: [
                    { startTime: { $gte: from, $lte: to } },
                    { startTime: { $gte: windowFromIso, $lte: windowToIso } },
                  ],
                },
              ],
            },
            { projection: { _id: 1, title: 1, startTime: 1, attendees: 1 } }
          )
          .sort({ startTime: 1, _id: 1 })
          .limit(CALENDAR_MAX_MEETINGS)
          .toArray(),
        db
          .collection("tasks")
          .find(
            { $and: [...openTaskConditions(scope), { dueAt: { $ne: null } }] },
            {
              projection: {
                _id: 1,
                title: 1,
                dueAt: 1,
                status: 1,
                priorityLabel: 1,
                assigneeName: 1,
              },
            }
          )
          .sort({ dueAt: 1, _id: 1 })
          .limit(CALENDAR_MAX_TASKS)
          .toArray(),
        db
          .collection("taskReminders")
          .find(
            { workspaceId, status: "scheduled", runAt: { $gte: from, $lte: to } },
            { projection: { _id: 1, taskId: 1, taskTitle: 1, kind: 1, runAt: 1 } }
          )
          .sort({ runAt: 1, _id: 1 })
          .limit(CALENDAR_MAX_REMINDERS)
          .toArray(),
      ]);

      const now = Date.now();
      return asJson({
        from: windowFromIso,
        to: windowToIso,
        meetings: meetingDocs.map((meeting: any) => ({
          id: String(meeting._id),
          title: meeting.title || "Untitled meeting",
          startTime: toDateOrNull(meeting.startTime)?.toISOString() ?? null,
          attendeeCount: Array.isArray(meeting.attendees) ? meeting.attendees.length : 0,
        })),
        tasks: taskDocs.flatMap((task: any) => {
          const due = toDateOrNull(task.dueAt);
          if (!due || due.getTime() < from.getTime() || due.getTime() > to.getTime()) {
            return [];
          }
          return [
            {
              id: String(task._id),
              title: task.title || "",
              dueAt: due.toISOString(),
              status: task.status ?? null,
              priorityLabel: task.priorityLabel ?? null,
              assigneeName: task.assigneeName ?? null,
              overdue: due.getTime() < now && task.status !== "done",
            },
          ];
        }),
        reminders: reminderDocs.flatMap((reminder: any) => {
          const runAt = toDateOrNull(reminder.runAt);
          if (!runAt) return [];
          return [
            {
              id: String(reminder._id),
              taskId: reminder.taskId ?? null,
              taskTitle: reminder.taskTitle || "",
              kind: reminder.kind ?? null,
              runAt: runAt.toISOString(),
            },
          ];
        }),
      });
    },
  },
];

export const getMcpResourceDefinitions = (): McpResourceDefinition[] => RESOURCES;
