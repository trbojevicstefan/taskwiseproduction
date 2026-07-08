import { z } from "zod";
import type { Db } from "mongodb";
import type { McpToolDefinition } from "@/lib/mcp-registry";
import { McpToolCallError } from "@/lib/mcp-read-tools";
import {
  buildWorkspaceFallbackScope,
  escapeRegexPattern,
  getWorkspaceMemberUserIds,
  serializeMcpPerson,
  serializeMcpTask,
  toDateOrNull,
} from "@/lib/mcp-tool-helpers";
import { TASK_LIST_PROJECTION } from "@/lib/task-projections";
import { normalizePersonNameKey } from "@/lib/transcript-utils";

/**
 * Phase 8 pack: workspace tools.
 *
 * list_clients / get_client_commitments / get_board_snapshot /
 * get_calendar_agenda — all "mcp:read".
 *
 * Conventions honored here:
 * - No session-authed route handlers are imported; scoping is rebuilt with
 *   getWorkspaceMemberUserIds + buildWorkspaceFallbackScope.
 * - Clients = people with personType "client"; commitments matching reuses the
 *   uid -> email -> nameKey matcher pattern (buildPersonTaskMatcher precedent
 *   in src/lib/mcp-read-tools.ts).
 * - get_board_snapshot is read-only by design: it looks up the default board
 *   instead of calling ensureDefaultBoard (a read-scope tool must never
 *   insert boards — that would bypass write scope/rate-limit/audit).
 * - Serializers strip recordingId/recordingIdHash and never expose secrets.
 */

const LIST_MAX_LIMIT = 100;
const LIST_DEFAULT_LIMIT = 50;
const COMMITMENTS_DEFAULT_LIMIT = 25;
const BOARD_MAX_ITEMS = 500;
const AGENDA_MAX_RANGE_DAYS = 62;
const AGENDA_DEFAULT_RANGE_DAYS = 7;
const AGENDA_MAX_MEETINGS = 200;
const AGENDA_MAX_TASKS = 500;
const AGENDA_MAX_REMINDERS = 200;
const DAY_MS = 24 * 60 * 60 * 1000;

const listClientsArgsSchema = z.object({
  limit: z.number().int().min(1).max(LIST_MAX_LIMIT).optional(),
  query: z.string().trim().max(120).optional(),
});

const getClientCommitmentsArgsSchema = z.object({
  personId: z.string().trim().min(1).max(120),
  includeDone: z.boolean().optional(),
  limit: z.number().int().min(1).max(LIST_MAX_LIMIT).optional(),
});

const getBoardSnapshotArgsSchema = z.object({
  boardId: z.string().trim().min(1).max(120).optional(),
  includeExpired: z.boolean().optional(),
});

const getCalendarAgendaArgsSchema = z.object({
  from: z.string().trim().min(1).max(64).optional(),
  to: z.string().trim().min(1).max(64).optional(),
});

/** uid -> email -> nameKey matcher (buildPersonTaskMatcher precedent). */
const buildPersonTaskMatcher = (person: any, personLookupId: string) => {
  const personId = String(person?._id || person?.id || personLookupId);
  const nameKeys = new Set<string>();
  if (person?.name) {
    const key = normalizePersonNameKey(person.name);
    if (key) nameKeys.add(key);
  }
  if (Array.isArray(person?.aliases)) {
    person.aliases.forEach((alias: string) => {
      const key = normalizePersonNameKey(alias);
      if (key) nameKeys.add(key);
    });
  }

  const nameKeyList = Array.from(nameKeys).filter(Boolean);
  return {
    $or: [
      { "assignee.uid": personLookupId },
      { "assignee.uid": personId },
      ...(person?.email ? [{ "assignee.email": person.email }] : []),
      ...(nameKeyList.length
        ? [
            { assigneeNameKey: { $in: nameKeyList } },
            { assigneeName: { $in: nameKeyList } },
            { "assignee.name": { $in: nameKeyList } },
          ]
        : []),
    ],
  };
};

type ClientPersonIndex = {
  emails: Set<string>;
  nameKeys: Set<string>;
};

const buildClientPersonIndex = (people: any[]): ClientPersonIndex => {
  const emails = new Set<string>();
  const nameKeys = new Set<string>();
  for (const person of people) {
    const email =
      typeof person?.email === "string" ? person.email.trim().toLowerCase() : "";
    if (email) emails.add(email);
    const names = [
      person?.name,
      ...(Array.isArray(person?.aliases) ? person.aliases : []),
    ];
    for (const name of names) {
      if (typeof name !== "string") continue;
      const key = normalizePersonNameKey(name);
      if (key) nameKeys.add(key);
    }
  }
  return { emails, nameKeys };
};

const isClientMeeting = (attendees: any[], clients: ClientPersonIndex): boolean => {
  if (clients.emails.size === 0 && clients.nameKeys.size === 0) return false;
  return attendees.some((attendee) => {
    const email =
      typeof attendee?.email === "string" ? attendee.email.trim().toLowerCase() : "";
    if (email && clients.emails.has(email)) return true;
    const nameKey =
      typeof attendee?.name === "string" ? normalizePersonNameKey(attendee.name) : "";
    return Boolean(nameKey) && clients.nameKeys.has(nameKey);
  });
};

const serializeAgendaAttendee = (
  attendee: unknown
): { name: string; email: string | null } | null => {
  if (typeof attendee === "string") {
    const name = attendee.trim();
    return name ? { name, email: null } : null;
  }
  if (!attendee || typeof attendee !== "object") return null;
  const record = attendee as Record<string, unknown>;
  const name =
    typeof record.name === "string" && record.name.trim()
      ? record.name.trim()
      : typeof record.email === "string" && record.email.trim()
        ? record.email.trim()
        : "";
  if (!name) return null;
  return {
    name,
    email:
      typeof record.email === "string" && record.email.trim()
        ? record.email.trim()
        : null,
  };
};

const findBoardForSnapshot = async (
  db: Db,
  workspaceId: string,
  boardId: string | undefined
) => {
  if (boardId) {
    return db.collection("boards").findOne({
      workspaceId,
      $or: [{ _id: boardId }, { id: boardId }],
    } as any);
  }
  const defaultBoard = await db
    .collection("boards")
    .findOne({ workspaceId, isDefault: true });
  if (defaultBoard) return defaultBoard;
  const boards = await db
    .collection("boards")
    .find({ workspaceId })
    .sort({ createdAt: 1, _id: 1 })
    .limit(1)
    .toArray();
  return boards[0] || null;
};

const WORKSPACE_TOOLS: McpToolDefinition[] = [
  {
    name: "list_clients",
    description:
      "List client people in the workspace (personType 'client'), optionally filtered by name/email/company.",
    scope: "mcp:read",
    inputSchema: listClientsArgsSchema,
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        limit: { type: "number", minimum: 1, maximum: LIST_MAX_LIMIT },
        query: { type: "string", maxLength: 120 },
      },
    },
    handler: async ({ db, workspaceId }, rawArgs) => {
      const args = rawArgs as z.infer<typeof listClientsArgsSchema>;
      const memberUserIds = await getWorkspaceMemberUserIds(db, workspaceId);
      const scope = buildWorkspaceFallbackScope(workspaceId, memberUserIds);

      const conditions: Record<string, unknown>[] = [
        scope,
        { personType: "client" },
      ];
      if (args.query) {
        const pattern = new RegExp(escapeRegexPattern(args.query), "i");
        conditions.push({
          $or: [
            { name: pattern },
            { email: pattern },
            { aliases: pattern },
            { company: pattern },
          ],
        });
      }

      const limit = args.limit || LIST_DEFAULT_LIMIT;
      const clients = await db
        .collection("people")
        .find({ $and: conditions })
        .sort({ lastSeenAt: -1, _id: -1 })
        .limit(limit)
        .toArray();
      const serialized = clients.map(serializeMcpPerson);

      return {
        toolName: "list_clients",
        summary: `Returned ${serialized.length} client(s).`,
        data: { clients: serialized, totalCount: serialized.length },
      };
    },
  },
  {
    name: "get_client_commitments",
    description:
      "List open commitments (tasks) assigned to a client person, with overdue flags.",
    scope: "mcp:read",
    inputSchema: getClientCommitmentsArgsSchema,
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      required: ["personId"],
      properties: {
        personId: { type: "string", minLength: 1, maxLength: 120 },
        includeDone: { type: "boolean" },
        limit: { type: "number", minimum: 1, maximum: LIST_MAX_LIMIT },
      },
    },
    handler: async ({ db, workspaceId }, rawArgs) => {
      const args = rawArgs as z.infer<typeof getClientCommitmentsArgsSchema>;
      const includeDone = args.includeDone ?? false;
      const memberUserIds = await getWorkspaceMemberUserIds(db, workspaceId);
      const scope = buildWorkspaceFallbackScope(workspaceId, memberUserIds);

      const person = await db.collection("people").findOne({
        $and: [
          scope,
          {
            $or: [
              { _id: args.personId },
              { id: args.personId },
              { slackId: args.personId },
            ],
          },
        ],
      } as any);

      if (!person) {
        return {
          toolName: "get_client_commitments",
          summary: "Person not found.",
          data: { person: null, commitments: [], totalCount: 0, overdueCount: 0 },
        };
      }

      const conditions: Record<string, unknown>[] = [
        scope,
        buildPersonTaskMatcher(person, args.personId),
        { taskState: { $ne: "archived" } },
        { cleanupStatus: { $ne: "expired" } },
      ];
      if (!includeDone) {
        conditions.push({ status: { $nin: ["done", "completed", "complete"] } });
      }

      const limit = args.limit || COMMITMENTS_DEFAULT_LIMIT;
      const tasks = await db
        .collection("tasks")
        .find({ $and: conditions })
        .project(TASK_LIST_PROJECTION)
        .sort({ lastUpdated: -1, _id: -1 })
        .limit(limit)
        .toArray();

      const now = Date.now();
      const commitments = tasks.map((task: any) => {
        const serialized = serializeMcpTask(task);
        const due = toDateOrNull(task?.dueAt);
        return {
          ...serialized,
          overdue: Boolean(due && due.getTime() < now && task?.status !== "done"),
        };
      });
      const overdueCount = commitments.filter((task: any) => task.overdue).length;

      return {
        toolName: "get_client_commitments",
        summary: `Found ${commitments.length} commitment(s) for ${String(
          (person as any).name || args.personId
        )} (${overdueCount} overdue).`,
        data: {
          person: serializeMcpPerson(person),
          commitments,
          totalCount: commitments.length,
          overdueCount,
        },
      };
    },
  },
  {
    name: "get_board_snapshot",
    description:
      "Snapshot of a board (default board when boardId is omitted): columns in order with their tasks.",
    scope: "mcp:read",
    inputSchema: getBoardSnapshotArgsSchema,
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        boardId: { type: "string", minLength: 1, maxLength: 120 },
        includeExpired: { type: "boolean" },
      },
    },
    handler: async ({ db, workspaceId }, rawArgs) => {
      const args = rawArgs as z.infer<typeof getBoardSnapshotArgsSchema>;
      const board = await findBoardForSnapshot(db, workspaceId, args.boardId);
      if (!board) {
        return {
          toolName: "get_board_snapshot",
          summary: args.boardId ? "Board not found." : "No boards exist yet.",
          data: { board: null, statuses: [], totalItems: 0 },
        };
      }

      const boardId = String((board as any)._id);
      const includeExpired = args.includeExpired ?? false;

      const statuses = await db
        .collection("boardStatuses")
        .find({ workspaceId, boardId })
        .sort({ order: 1, _id: 1 })
        .toArray();

      // Same lookup pipeline as the board items route (session-free given
      // db + workspaceId); expired cleanup tasks hidden unless opted in.
      const pipeline = [
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
                  ...(includeExpired ? {} : { cleanupStatus: { $ne: "expired" } }),
                },
              },
              { $project: TASK_LIST_PROJECTION },
            ],
            as: "task",
          },
        },
        { $unwind: "$task" },
        { $sort: { statusId: 1, rank: 1, createdAt: 1 } },
        { $limit: BOARD_MAX_ITEMS },
      ];
      const items = await db.collection("boardItems").aggregate(pipeline).toArray();

      const itemsByStatusId = new Map<string, any[]>();
      for (const item of items) {
        const statusId = String((item as any).statusId || "");
        const bucket = itemsByStatusId.get(statusId) || [];
        bucket.push({
          ...serializeMcpTask((item as any).task),
          boardItemId: String((item as any)._id),
          boardRank: (item as any).rank ?? null,
        });
        itemsByStatusId.set(statusId, bucket);
      }

      const statusSnapshots = statuses.map((status: any) => {
        const statusId = String(status._id);
        const statusItems = itemsByStatusId.get(statusId) || [];
        return {
          id: statusId,
          label: status.label || "",
          category: status.category || null,
          order: typeof status.order === "number" ? status.order : 0,
          isTerminal: Boolean(status.isTerminal),
          itemCount: statusItems.length,
          items: statusItems,
        };
      });

      return {
        toolName: "get_board_snapshot",
        summary: `Board "${String((board as any).name || boardId)}": ${items.length} task(s) across ${statuses.length} column(s).`,
        data: {
          board: {
            id: boardId,
            name: (board as any).name || "",
            isDefault: Boolean((board as any).isDefault),
          },
          statuses: statusSnapshots,
          totalItems: items.length,
        },
      };
    },
  },
  {
    name: "get_calendar_agenda",
    description:
      "Calendar agenda for a date range (default: next 7 days, max 62): meetings, due tasks with overdue flags, and scheduled Slack reminders.",
    scope: "mcp:read",
    inputSchema: getCalendarAgendaArgsSchema,
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        from: { type: "string", maxLength: 64 },
        to: { type: "string", maxLength: 64 },
      },
    },
    handler: async ({ db, workspaceId }, rawArgs) => {
      const args = rawArgs as z.infer<typeof getCalendarAgendaArgsSchema>;
      const now = new Date();
      const from = args.from ? toDateOrNull(args.from) : now;
      const to = args.to
        ? toDateOrNull(args.to)
        : new Date(
            (from ? from.getTime() : now.getTime()) +
              AGENDA_DEFAULT_RANGE_DAYS * DAY_MS
          );
      if (!from || !to) {
        throw new McpToolCallError(
          "invalid_arguments",
          "'from' and 'to' must be valid ISO dates."
        );
      }
      if (to.getTime() < from.getTime()) {
        throw new McpToolCallError(
          "invalid_arguments",
          "'to' must not be before 'from'."
        );
      }
      if (to.getTime() - from.getTime() > AGENDA_MAX_RANGE_DAYS * DAY_MS) {
        throw new McpToolCallError(
          "invalid_arguments",
          `Requested range must not exceed ${AGENDA_MAX_RANGE_DAYS} days.`
        );
      }

      const memberUserIds = await getWorkspaceMemberUserIds(db, workspaceId);
      const scope = buildWorkspaceFallbackScope(workspaceId, memberUserIds);
      const fromIso = from.toISOString();
      const toIso = to.toISOString();

      // startTime is schemaless (Date OR ISO string) — query both range types
      // (GET /api/calendar precedent).
      const [meetingDocs, taskDocs, reminderDocs, clientPeople] = await Promise.all([
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
                    { startTime: { $gte: fromIso, $lte: toIso } },
                  ],
                },
              ],
            },
            {
              projection: {
                _id: 1,
                title: 1,
                startTime: 1,
                attendees: 1,
              },
            }
          )
          .sort({ startTime: 1, _id: 1 })
          .limit(AGENDA_MAX_MEETINGS)
          .toArray(),
        db
          .collection("tasks")
          .find(
            {
              $and: [
                scope,
                { taskState: { $ne: "archived" } },
                { cleanupStatus: { $ne: "expired" } },
                { dueAt: { $ne: null } },
              ],
            },
            {
              projection: {
                _id: 1,
                title: 1,
                dueAt: 1,
                status: 1,
                priorityLabel: 1,
                priorityScore: 1,
                assigneeName: 1,
              },
            }
          )
          .sort({ dueAt: 1, _id: 1 })
          .limit(AGENDA_MAX_TASKS)
          .toArray(),
        db
          .collection("taskReminders")
          .find(
            {
              workspaceId,
              status: "scheduled",
              runAt: { $gte: from, $lte: to },
            },
            {
              projection: { _id: 1, taskId: 1, taskTitle: 1, kind: 1, runAt: 1 },
            }
          )
          .sort({ runAt: 1, _id: 1 })
          .limit(AGENDA_MAX_REMINDERS)
          .toArray(),
        db
          .collection("people")
          .find(
            { $and: [scope, { personType: "client" }] },
            { projection: { name: 1, email: 1, aliases: 1 } }
          )
          .toArray(),
      ]);

      const clients = buildClientPersonIndex(clientPeople);
      const meetings = meetingDocs.map((meeting: any) => {
        const attendees = Array.isArray(meeting.attendees) ? meeting.attendees : [];
        const id = String(meeting._id);
        return {
          id,
          title: meeting.title || "Untitled Meeting",
          startTime: toDateOrNull(meeting.startTime)?.toISOString() ?? null,
          link: `/meetings/${id}`,
          attendees: attendees
            .map(serializeAgendaAttendee)
            .filter(Boolean),
          attendeeCount: attendees.length,
          isClientMeeting: isClientMeeting(attendees, clients),
        };
      });

      // dueAt is schemaless — coerce and range-filter in JS.
      const tasks = taskDocs.flatMap((task: any) => {
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
            priorityScore:
              typeof task.priorityScore === "number" ? task.priorityScore : null,
            assigneeName: task.assigneeName ?? null,
            overdue: due.getTime() < now.getTime() && task.status !== "done",
          },
        ];
      });

      const reminders = reminderDocs.flatMap((reminder: any) => {
        const runAt = toDateOrNull(reminder.runAt);
        if (!runAt) return [];
        return [
          {
            id: String(reminder._id),
            taskId: reminder.taskId ?? null,
            taskTitle: reminder.taskTitle || "",
            kind: reminder.kind ?? null,
            runAt: runAt.toISOString(),
            status: "scheduled" as const,
          },
        ];
      });

      return {
        toolName: "get_calendar_agenda",
        summary: `Agenda ${fromIso.slice(0, 10)} → ${toIso.slice(0, 10)}: ${meetings.length} meeting(s), ${tasks.length} due task(s), ${reminders.length} reminder(s).`,
        data: { from: fromIso, to: toIso, meetings, tasks, reminders },
      };
    },
  },
];

export const getMcpWorkspaceToolDefinitions = (): McpToolDefinition[] =>
  WORKSPACE_TOOLS;
