import { z } from "zod";
import type { Db } from "mongodb";
import { TASK_LIST_PROJECTION } from "@/lib/task-projections";
import { normalizePersonNameKey } from "@/lib/transcript-utils";
import { listActiveWorkspaceMembershipsForWorkspace } from "@/lib/workspace-memberships";

type JsonSchema = Record<string, unknown>;

export type McpReadToolDefinition = {
  name: string;
  description: string;
  inputSchema: JsonSchema;
};

export type McpReadToolExecutionResult = {
  toolName: string;
  summary: string;
  data: Record<string, unknown>;
};

export class McpToolCallError extends Error {
  code: "tool_not_found" | "invalid_arguments";
  details?: unknown;

  constructor(
    code: "tool_not_found" | "invalid_arguments",
    message: string,
    details?: unknown
  ) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

const MAX_LIST_LIMIT = 100;

const meetingsListArgsSchema = z.object({
  limit: z.number().int().min(1).max(MAX_LIST_LIMIT).optional(),
});

const meetingGetArgsSchema = z.object({
  meetingId: z.string().trim().min(1),
});

const actionItemsListArgsSchema = z.object({
  limit: z.number().int().min(1).max(200).optional(),
  status: z.string().trim().min(1).max(40).optional(),
  includeDone: z.boolean().optional(),
  includeSubtasks: z.boolean().optional(),
  personId: z.string().trim().min(1).max(120).optional(),
  attendeeId: z.string().trim().min(1).max(120).optional(),
  sourceSessionType: z.enum(["meeting", "chat", "task"]).optional(),
});

const peopleListArgsSchema = z.object({
  limit: z.number().int().min(1).max(MAX_LIST_LIMIT).optional(),
  query: z.string().trim().max(120).optional(),
});

const peopleGetArgsSchema = z
  .object({
    personId: z.string().trim().min(1).optional(),
    attendeeId: z.string().trim().min(1).optional(),
    includeActionItems: z.boolean().optional(),
    actionItemsLimit: z.number().int().min(1).max(MAX_LIST_LIMIT).optional(),
  })
  .refine((value) => Boolean(value.personId || value.attendeeId), {
    message: "personId is required.",
  });

const MCP_READ_TOOLS: McpReadToolDefinition[] = [
  {
    name: "meetings.latest",
    description: "Get the most recent meeting in the workspace.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
  },
  {
    name: "meetings.list",
    description: "List recent meetings in the workspace.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        limit: { type: "number", minimum: 1, maximum: MAX_LIST_LIMIT },
      },
    },
  },
  {
    name: "meetings.get",
    description: "Get meeting details by meeting ID.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["meetingId"],
      properties: {
        meetingId: { type: "string" },
      },
    },
  },
  {
    name: "action_items.list",
    description:
      "List workspace action items (tasks), with optional status/person filters.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        limit: { type: "number", minimum: 1, maximum: 200 },
        status: { type: "string" },
        includeDone: { type: "boolean" },
        includeSubtasks: { type: "boolean" },
        personId: { type: "string" },
        sourceSessionType: { type: "string", enum: ["meeting", "chat", "task"] },
      },
    },
  },
  {
    name: "people.list",
    description: "List people in the workspace.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        limit: { type: "number", minimum: 1, maximum: MAX_LIST_LIMIT },
        query: { type: "string" },
      },
    },
  },
  {
    name: "people.get",
    description:
      "Get person details by person ID and optionally include assigned action items.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["personId"],
      properties: {
        personId: { type: "string" },
        includeActionItems: { type: "boolean" },
        actionItemsLimit: { type: "number", minimum: 1, maximum: MAX_LIST_LIMIT },
      },
    },
  },
];

const serializeDate = (value: unknown) => {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value ?? null;
};

const normalizeMeetingTitleKey = (value: unknown) => {
  if (typeof value !== "string") return null;
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || null;
};

const normalizeMeetingUrlKey = (value: unknown) => {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    parsed.hash = "";
    const path = parsed.pathname.replace(/\/+$/, "");
    const search = parsed.searchParams.toString();
    return `${parsed.protocol}//${parsed.host}${path || "/"}${
      search ? `?${search}` : ""
    }`.toLowerCase();
  } catch {
    return raw.replace(/\/+$/, "").toLowerCase();
  }
};

const toFiveMinuteBucket = (value: unknown) => {
  const date = value instanceof Date ? value : value ? new Date(String(value)) : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  return String(Math.floor(date.getTime() / (5 * 60 * 1000)));
};

const serializeMeeting = (meeting: any) => {
  const { recordingId, recordingIdHash, _id, ...rest } = meeting || {};
  return {
    ...rest,
    id: String(_id || meeting?.id || ""),
    createdAt: serializeDate(meeting?.createdAt),
    lastActivityAt: serializeDate(meeting?.lastActivityAt),
    startTime: serializeDate(meeting?.startTime),
    endTime: serializeDate(meeting?.endTime),
  };
};

const buildMeetingListDedupeKey = (meeting: any) => {
  const fingerprint = Array.isArray(meeting?.dedupeFingerprints)
    ? meeting.dedupeFingerprints.find((value: any) => typeof value === "string" && value.trim())
    : null;
  if (fingerprint) {
    return `fp:${fingerprint}`;
  }

  const bucket =
    toFiveMinuteBucket(meeting?.startTime) ||
    toFiveMinuteBucket(meeting?.endTime) ||
    toFiveMinuteBucket(meeting?.createdAt);
  const titleKey = normalizeMeetingTitleKey(meeting?.title);
  const shareUrlKey = normalizeMeetingUrlKey(meeting?.shareUrl);
  const recordingUrlKey = normalizeMeetingUrlKey(meeting?.recordingUrl);

  if (shareUrlKey && bucket) return `share:${shareUrlKey}|t:${bucket}`;
  if (recordingUrlKey && bucket) return `url:${recordingUrlKey}|t:${bucket}`;
  if (titleKey && bucket) return `title:${titleKey}|t:${bucket}`;
  return `id:${String(meeting?._id || meeting?.id || "")}`;
};

const dedupeMeetings = (meetings: any[], limit: number) => {
  const deduped: any[] = [];
  const seen = new Set<string>();
  for (const meeting of meetings) {
    const key = buildMeetingListDedupeKey(meeting);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(meeting);
    if (deduped.length >= limit) break;
  }
  return deduped;
};

const serializeTask = (task: any) => ({
  ...task,
  id: String(task?._id || task?.id || ""),
  _id: undefined,
  createdAt: serializeDate(task?.createdAt),
  lastUpdated: serializeDate(task?.lastUpdated),
  dueAt: serializeDate(task?.dueAt),
});

const serializePerson = (person: any) => ({
  ...person,
  id: String(person?._id || person?.id || ""),
  _id: undefined,
  createdAt: serializeDate(person?.createdAt),
  lastSeenAt: serializeDate(person?.lastSeenAt),
});

const toArrayCursor = (cursor: any, limit: number) =>
  cursor.sort({ lastActivityAt: -1, _id: -1 }).limit(limit).toArray();

const toTaskStatusFilter = (includeDone: boolean) =>
  includeDone
    ? {}
    : {
        status: {
          $nin: ["done", "completed", "complete"],
        },
      };

const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const getWorkspaceMemberUserIds = async (db: Db, workspaceId: string) => {
  const memberships = await listActiveWorkspaceMembershipsForWorkspace(db, workspaceId);
  const ids = Array.from(
    new Set(
      memberships.map((membership: any) => String(membership?.userId || "").trim()).filter(Boolean)
    )
  );
  return ids.length ? ids : [];
};

const buildWorkspaceFallbackScope = (workspaceId: string, workspaceMemberUserIds: string[]) => ({
  $or: [
    { workspaceId },
    {
      workspaceId: { $exists: false },
      userId: { $in: workspaceMemberUserIds },
    },
  ],
});

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

const parseArgs = <TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  rawArgs: Record<string, unknown> | undefined
) => {
  const parsed = schema.safeParse(rawArgs || {});
  if (!parsed.success) {
    throw new McpToolCallError(
      "invalid_arguments",
      "Invalid tool arguments.",
      parsed.error.flatten()
    );
  }
  return parsed.data as z.infer<TSchema>;
};

export const listMcpReadTools = () => MCP_READ_TOOLS;

export const executeMcpReadTool = async (
  db: Db,
  workspaceId: string,
  toolName: string,
  rawArgs?: Record<string, unknown>
): Promise<McpReadToolExecutionResult> => {
  switch (toolName) {
    case "meetings.latest": {
      const meetings = await toArrayCursor(
        db.collection("meetings").find({
          workspaceId,
          isHidden: { $ne: true },
        }),
        10
      );
      const deduped = dedupeMeetings(meetings, 1);
      const meeting = deduped[0] ? serializeMeeting(deduped[0]) : null;
      return {
        toolName,
        summary: meeting
          ? `Latest meeting: ${String(meeting.title || "Untitled meeting")}`
          : "No meetings found for this workspace.",
        data: { meeting },
      };
    }
    case "meetings.list": {
      const args = parseArgs(meetingsListArgsSchema, rawArgs);
      const limit = args.limit || 20;
      const fetchLimit = Math.min(MAX_LIST_LIMIT * 5, Math.max(limit * 4, limit + 10));
      const meetings = await toArrayCursor(
        db.collection("meetings").find({
          workspaceId,
          isHidden: { $ne: true },
        }),
        fetchLimit
      );
      const deduped = dedupeMeetings(meetings, limit);
      const data = deduped.map(serializeMeeting);
      return {
        toolName,
        summary: `Returned ${data.length} meeting(s).`,
        data: { meetings: data, totalCount: data.length },
      };
    }
    case "meetings.get": {
      const args = parseArgs(meetingGetArgsSchema, rawArgs);
      const meeting = await db.collection("meetings").findOne({
        workspaceId,
        isHidden: { $ne: true },
        $or: [{ _id: args.meetingId }, { id: args.meetingId }],
      } as any);
      const serialized = meeting ? serializeMeeting(meeting) : null;
      return {
        toolName,
        summary: serialized
          ? `Meeting found: ${String(serialized.title || serialized.id)}`
          : "Meeting not found.",
        data: { meeting: serialized },
      };
    }
    case "action_items.list": {
      const args = parseArgs(actionItemsListArgsSchema, rawArgs);
      const includeDone = args.includeDone ?? false;
      const includeSubtasks = args.includeSubtasks ?? false;
      const filter: Record<string, unknown> = {
        workspaceId,
        taskState: { $ne: "archived" },
        ...toTaskStatusFilter(includeDone),
      };
      if (!includeSubtasks) {
        filter.parentId = null;
      }
      if (args.status) {
        filter.status = args.status;
      }
      if (args.sourceSessionType) {
        filter.sourceSessionType = args.sourceSessionType;
      }
      const personId = args.personId || args.attendeeId || null;
      if (personId) {
        filter["assignee.uid"] = personId;
      }

      const limit = args.limit || 50;
      const tasks = await db
        .collection("tasks")
        .find(filter)
        .project(TASK_LIST_PROJECTION)
        .sort({ lastUpdated: -1, _id: -1 })
        .limit(limit)
        .toArray();
      const actionItems = tasks.map(serializeTask);
      return {
        toolName,
        summary: `Returned ${actionItems.length} action item(s).`,
        data: { actionItems, totalCount: actionItems.length },
      };
    }
    case "people.list":
    case "attendees.list": {
      const args = parseArgs(peopleListArgsSchema, rawArgs);
      const workspaceMemberUserIds = await getWorkspaceMemberUserIds(db, workspaceId);
      const workspaceScope = buildWorkspaceFallbackScope(
        workspaceId,
        workspaceMemberUserIds
      );
      let filter: Record<string, unknown> = workspaceScope;
      if (args.query) {
        const pattern = new RegExp(escapeRegex(args.query), "i");
        filter = {
          $and: [
            workspaceScope,
            {
              $or: [{ name: pattern }, { email: pattern }, { aliases: pattern }],
            },
          ],
        };
      }
      const limit = args.limit || 50;
      const attendees = await db
        .collection("people")
        .find(filter)
        .sort({ lastSeenAt: -1, _id: -1 })
        .limit(limit)
        .toArray();
      const data = attendees.map(serializePerson);
      return {
        toolName,
        summary: `Returned ${data.length} people.`,
        data: { people: data, totalCount: data.length },
      };
    }
    case "people.get":
    case "attendees.get": {
      const args = parseArgs(peopleGetArgsSchema, rawArgs);
      const personLookupId = (args.personId || args.attendeeId || "").trim();
      const includeActionItems = args.includeActionItems ?? true;
      const workspaceMemberUserIds = await getWorkspaceMemberUserIds(db, workspaceId);
      const workspaceFallbackScope = buildWorkspaceFallbackScope(
        workspaceId,
        workspaceMemberUserIds
      );
      const person = await db.collection("people").findOne({
        $and: [
          workspaceFallbackScope,
          {
            $or: [
              { _id: personLookupId },
              { id: personLookupId },
              { slackId: personLookupId },
            ],
          },
        ],
      } as any);

      if (!person) {
        return {
          toolName,
          summary: "Person not found.",
          data: { person: null, actionItems: [] },
        };
      }

      let actionItems: any[] = [];
      if (includeActionItems) {
        const limit = args.actionItemsLimit || 20;
        const taskMatcher = buildPersonTaskMatcher(person, personLookupId);
        const tasks = await db
          .collection("tasks")
          .find({
            $and: [
              {
                $or: [
                  { workspaceId },
                  {
                    workspaceId: { $exists: false },
                    userId: { $in: workspaceMemberUserIds },
                  },
                ],
              },
              taskMatcher,
              { taskState: { $ne: "archived" } },
            ],
          })
          .project(TASK_LIST_PROJECTION)
          .sort({ lastUpdated: -1, _id: -1 })
          .limit(limit)
          .toArray();
        actionItems = tasks.map(serializeTask);
      }

      return {
        toolName,
        summary: `Person loaded: ${String(person.name || person._id || personLookupId)}`,
        data: {
          person: serializePerson(person),
          actionItems,
        },
      };
    }
    default:
      throw new McpToolCallError("tool_not_found", `Tool not found: ${toolName}`);
  }
};
