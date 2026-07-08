import { randomUUID } from "crypto";
import { z } from "zod";
import type { Db } from "mongodb";
import type { McpToolDefinition } from "@/lib/mcp-registry";
import { McpToolCallError } from "@/lib/mcp-read-tools";
import { executeMcpWriteTool } from "@/lib/mcp-write-tools";
import {
  buildWorkspaceFallbackScope,
  getWorkspaceMemberUserIds,
  serializeMcpTask,
  toDateOrNull,
  truncateText,
} from "@/lib/mcp-tool-helpers";
import { TASK_LIST_PROJECTION } from "@/lib/task-projections";
import { computeTaskPriority } from "@/lib/task-priority";
import {
  buildTaskReminderDedupKey,
  cancelRemindersForTask,
  ensureTaskReminderIndexes,
  enqueueReminderSweepJob,
  serializeTaskReminder,
  TASK_REMINDERS_COLLECTION,
  type TaskReminderDoc,
} from "@/lib/task-reminders";
import { enqueueJob } from "@/lib/jobs/store";
import { getAssigneeLabel } from "@/lib/task-assignee";
import { normalizePersonNameKey } from "@/lib/transcript-utils";
import { resolveSlackReminderSettings } from "@/lib/workspace-settings";
import { findWorkspaceById } from "@/lib/workspaces";

/**
 * Phase 8 pack: task tools.
 *
 * list_tasks (read); update_task_status / assign_task / set_task_due_date /
 * prioritize_tasks / create_task_from_meeting / schedule_slack_reminder (write).
 *
 * Conventions honored here:
 * - Mutating tools use scope "mcp:write" (scope checks, write rate-limit
 *   bucket, and route audit logging).
 * - update_task_status / assign_task / set_task_due_date delegate to the
 *   frozen legacy write tools (src/lib/mcp-write-tools.ts) so single-task
 *   mutations stay byte-identical (including the task.status.changed domain
 *   event and its cancel-reminders-on-done handler).
 * - syncTasksForSource is NEVER called (it deletes canonical tasks missing
 *   from a partial list); create_task_from_meeting does a single insertOne.
 * - MCP has no session user: actor userId is task.userId (mutations) or the
 *   meeting owner / a workspace member (creation), per mcp-write-tools
 *   precedent.
 * - Review-owned cleanup/priority fields are never written by meeting
 *   re-sync paths here — the only priority writes are the explicit
 *   prioritize_tasks recompute and the initial score on a freshly created task.
 */

const STATUS_VALUES = ["todo", "inprogress", "done", "recurring"] as const;
const PRIORITY_LABELS = ["low", "medium", "high", "urgent"] as const;

const DONE_STATUSES = ["done", "completed", "complete"];
const LIST_DEFAULT_LIMIT = 50;
const LIST_MAX_LIMIT = 100;
const PRIORITIZE_MAX_TASKS = 500;
const REMINDER_MAX_HORIZON_MS = 366 * 24 * 60 * 60 * 1000;
const REMINDER_PAST_GRACE_MS = 60 * 1000;

const listTasksArgsSchema = z.object({
  limit: z.number().int().min(1).max(LIST_MAX_LIMIT).optional(),
  status: z.enum(STATUS_VALUES).optional(),
  includeDone: z.boolean().optional(),
  priorityLabel: z.enum(PRIORITY_LABELS).optional(),
});

const updateTaskStatusArgsSchema = z.object({
  taskId: z.string().trim().min(1).max(120),
  status: z.enum(STATUS_VALUES),
});

const assignTaskArgsSchema = z
  .object({
    taskId: z.string().trim().min(1).max(120),
    assignee: z
      .object({
        uid: z.string().trim().min(1).max(120).optional(),
        email: z.string().trim().email().max(320).optional(),
        name: z.string().trim().min(1).max(200).optional(),
      })
      .nullable()
      .optional(),
    assigneeName: z.string().trim().min(1).max(200).nullable().optional(),
  })
  .refine(
    (value) => value.assignee !== undefined || value.assigneeName !== undefined,
    { message: "Provide assignee and/or assigneeName (null clears)." }
  );

const setTaskDueDateArgsSchema = z.object({
  taskId: z.string().trim().min(1).max(120),
  dueAt: z.string().trim().min(1).max(64).nullable(),
});

const prioritizeTasksArgsSchema = z.object({
  limit: z.number().int().min(1).max(PRIORITIZE_MAX_TASKS).optional(),
});

const createTaskFromMeetingArgsSchema = z.object({
  meetingId: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(300),
  description: z.string().max(4000).optional(),
  dueAt: z.string().trim().min(1).max(64).optional(),
  assigneeName: z.string().trim().min(1).max(200).optional(),
});

const scheduleSlackReminderArgsSchema = z.object({
  taskId: z.string().trim().min(1).max(120),
  remindAt: z.string().trim().min(1).max(64),
});

const toDueIso = (value: unknown): string | null =>
  toDateOrNull(value)?.toISOString() ?? null;

/** Same lookup the legacy write tools use (mcp-write-tools precedent). */
const findTaskInWorkspace = async (db: Db, workspaceId: string, taskId: string) =>
  db.collection("tasks").findOne({
    workspaceId,
    taskState: { $ne: "archived" },
    $or: [{ _id: taskId }, { id: taskId }, { sourceTaskId: taskId }],
  } as any);

const isDuplicateKeyError = (error: unknown) =>
  Boolean(
    error &&
      typeof error === "object" &&
      ((error as { code?: number }).code === 11000 ||
        /E11000/i.test((error as { message?: string }).message || ""))
  );

/**
 * Open-task counts keyed by assignee uid/email/name — the same enrichment the
 * priority recompute route builds for computeTaskPriority.
 */
const buildAssigneeOpenCounts = (tasks: any[]): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const task of tasks) {
    const keys = new Set(
      [task?.assignee?.uid, task?.assignee?.email, task?.assigneeName]
        .filter(Boolean)
        .map((key: any) => String(key))
    );
    keys.forEach((key) => {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
  }
  return counts;
};

const delegateToLegacyWriteTool = async (
  db: Db,
  workspaceId: string,
  legacyToolName: string,
  toolName: string,
  args: Record<string, unknown>
) => {
  const result = await executeMcpWriteTool(db, workspaceId, legacyToolName, args);
  return { ...result, toolName };
};

const TASK_TOOLS: McpToolDefinition[] = [
  {
    name: "list_tasks",
    description:
      "List workspace tasks (non-archived, non-expired) with optional status/priority filters, sorted by priority score.",
    scope: "mcp:read",
    inputSchema: listTasksArgsSchema,
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        limit: { type: "number", minimum: 1, maximum: LIST_MAX_LIMIT },
        status: { type: "string", enum: [...STATUS_VALUES] },
        includeDone: { type: "boolean" },
        priorityLabel: { type: "string", enum: [...PRIORITY_LABELS] },
      },
    },
    handler: async ({ db, workspaceId }, rawArgs) => {
      const args = rawArgs as z.infer<typeof listTasksArgsSchema>;
      const includeDone = args.includeDone ?? false;
      const memberUserIds = await getWorkspaceMemberUserIds(db, workspaceId);
      const scope = buildWorkspaceFallbackScope(workspaceId, memberUserIds);

      const conditions: Record<string, unknown>[] = [
        scope,
        { taskState: { $ne: "archived" } },
        { cleanupStatus: { $ne: "expired" } },
      ];
      if (args.status) {
        conditions.push({ status: args.status });
      } else if (!includeDone) {
        conditions.push({ status: { $nin: DONE_STATUSES } });
      }
      if (args.priorityLabel) {
        conditions.push({ priorityLabel: args.priorityLabel });
      }

      const limit = args.limit || LIST_DEFAULT_LIMIT;
      const tasks = await db
        .collection("tasks")
        .find({ $and: conditions })
        .project(TASK_LIST_PROJECTION)
        .sort({ priorityScore: -1, lastUpdated: -1, _id: -1 })
        .limit(limit)
        .toArray();
      const serialized = tasks.map(serializeMcpTask);

      return {
        toolName: "list_tasks",
        summary: `Returned ${serialized.length} task(s).`,
        data: { tasks: serialized, totalCount: serialized.length },
      };
    },
  },
  {
    name: "update_task_status",
    description: "Update a task's status (todo | inprogress | done | recurring).",
    scope: "mcp:write",
    inputSchema: updateTaskStatusArgsSchema,
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      required: ["taskId", "status"],
      properties: {
        taskId: { type: "string", minLength: 1, maxLength: 120 },
        status: { type: "string", enum: [...STATUS_VALUES] },
      },
    },
    handler: ({ db, workspaceId }, args) =>
      delegateToLegacyWriteTool(
        db,
        workspaceId,
        "action_items.update_status",
        "update_task_status",
        args
      ),
  },
  {
    name: "assign_task",
    description:
      "Assign a task to a person (or clear the assignee by passing null).",
    scope: "mcp:write",
    inputSchema: assignTaskArgsSchema,
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      required: ["taskId"],
      properties: {
        taskId: { type: "string", minLength: 1, maxLength: 120 },
        assignee: {
          type: ["object", "null"],
          properties: {
            uid: { type: "string" },
            email: { type: "string" },
            name: { type: "string" },
          },
        },
        assigneeName: { type: ["string", "null"] },
      },
    },
    handler: ({ db, workspaceId }, args) =>
      delegateToLegacyWriteTool(
        db,
        workspaceId,
        "action_items.update_assignee",
        "assign_task",
        args
      ),
  },
  {
    name: "set_task_due_date",
    description:
      "Set or clear a task's due date (ISO date string or null). Reschedules Slack reminders when the date actually changes.",
    scope: "mcp:write",
    inputSchema: setTaskDueDateArgsSchema,
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      required: ["taskId", "dueAt"],
      properties: {
        taskId: { type: "string", minLength: 1, maxLength: 120 },
        dueAt: { type: ["string", "null"] },
      },
    },
    handler: async ({ db, workspaceId }, rawArgs) => {
      const args = rawArgs as z.infer<typeof setTaskDueDateArgsSchema>;
      const before = await findTaskInWorkspace(db, workspaceId, args.taskId);
      const previousDueIso = before ? toDueIso((before as any).dueAt) : null;

      const result = await delegateToLegacyWriteTool(
        db,
        workspaceId,
        "action_items.update_due_date",
        "set_task_due_date",
        args as Record<string, unknown>
      );

      // Phase 10 convention (PATCH /api/tasks/[id] precedent): on a REAL
      // dueAt change, cancel scheduled reminders and re-sweep. Best-effort —
      // reminder bookkeeping must never fail the due-date update itself.
      const nextDueIso = toDueIso((result.data as any)?.task?.dueAt);
      const actorUserId =
        typeof (before as any)?.userId === "string" ? (before as any).userId : null;
      if (before && actorUserId && previousDueIso !== nextDueIso) {
        try {
          const canonicalTaskId = String((before as any)._id || args.taskId);
          await cancelRemindersForTask(db, canonicalTaskId, "due_date_changed");
          await enqueueReminderSweepJob(db, {
            workspaceId,
            userId: actorUserId,
          });
        } catch {
          // Swallow — reminders are re-enrolled by the next periodic sweep.
        }
      }

      return result;
    },
  },
  {
    name: "prioritize_tasks",
    description:
      "Recompute deterministic priority scores/labels/reasons for the workspace's open tasks and persist only changed docs.",
    scope: "mcp:write",
    inputSchema: prioritizeTasksArgsSchema,
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        limit: { type: "number", minimum: 1, maximum: PRIORITIZE_MAX_TASKS },
      },
    },
    handler: async ({ db, workspaceId }, rawArgs) => {
      const args = rawArgs as z.infer<typeof prioritizeTasksArgsSchema>;
      const limit = args.limit || PRIORITIZE_MAX_TASKS;
      const memberUserIds = await getWorkspaceMemberUserIds(db, workspaceId);
      const scope = buildWorkspaceFallbackScope(workspaceId, memberUserIds);
      const tasksCollection = db.collection("tasks");

      const tasks: any[] = await tasksCollection
        .find(
          {
            $and: [
              scope,
              { status: { $ne: "done" } },
              { taskState: { $ne: "archived" } },
            ],
          },
          {
            projection: {
              _id: 1,
              title: 1,
              description: 1,
              status: 1,
              priority: 1,
              dueAt: 1,
              assignee: 1,
              assigneeName: 1,
              createdAt: 1,
              lastUpdated: 1,
              cleanupStatus: 1,
              priorityScore: 1,
              priorityLabel: 1,
            },
          }
        )
        .sort({ createdAt: -1, _id: -1 })
        .limit(limit)
        .toArray();

      // Client-person ids (client-impact signal) — cheap _id-only fetch.
      const clientAssigneeIds = new Set<string>();
      try {
        const clientPeople: any[] = await db
          .collection("people")
          .find(
            { $and: [scope, { personType: "client" }] },
            { projection: { _id: 1 } }
          )
          .toArray();
        clientPeople.forEach((person) => clientAssigneeIds.add(String(person._id)));
      } catch {
        // Client lookup is an enrichment only — scoring proceeds without it.
      }

      const now = new Date();
      const nowIso = now.toISOString();
      const ctx = {
        now,
        clientAssigneeIds,
        assigneeOpenCounts: buildAssigneeOpenCounts(tasks),
      };

      const byLabel: Record<(typeof PRIORITY_LABELS)[number], number> = {
        low: 0,
        medium: 0,
        high: 0,
        urgent: 0,
      };
      const operations: any[] = [];
      for (const task of tasks) {
        const result = computeTaskPriority(task, ctx);
        byLabel[result.priorityLabel] += 1;
        if (
          task.priorityScore === result.priorityScore &&
          task.priorityLabel === result.priorityLabel
        ) {
          continue;
        }
        operations.push({
          updateOne: {
            filter: { _id: task._id },
            update: {
              $set: {
                priorityScore: result.priorityScore,
                priorityLabel: result.priorityLabel,
                priorityReason: result.priorityReason,
                priorityUpdatedAt: nowIso,
              },
            },
          },
        });
      }

      if (operations.length) {
        await tasksCollection.bulkWrite(operations, { ordered: false });
      }

      return {
        toolName: "prioritize_tasks",
        summary: `Recomputed priorities for ${tasks.length} open task(s); updated ${operations.length}.`,
        data: {
          scanned: tasks.length,
          updated: operations.length,
          byLabel,
        },
      };
    },
  },
  {
    name: "create_task_from_meeting",
    description:
      "Create a single confirmed task linked to a meeting (sourceSessionType 'meeting'). Never re-syncs the meeting's task list.",
    scope: "mcp:write",
    inputSchema: createTaskFromMeetingArgsSchema,
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      required: ["meetingId", "title"],
      properties: {
        meetingId: { type: "string", minLength: 1, maxLength: 120 },
        title: { type: "string", minLength: 1, maxLength: 300 },
        description: { type: "string", maxLength: 4000 },
        dueAt: { type: "string", maxLength: 64 },
        assigneeName: { type: "string", minLength: 1, maxLength: 200 },
      },
    },
    handler: async ({ db, workspaceId }, rawArgs) => {
      const args = rawArgs as z.infer<typeof createTaskFromMeetingArgsSchema>;
      const meeting = await db.collection("meetings").findOne({
        workspaceId,
        isHidden: { $ne: true },
        $or: [{ _id: args.meetingId }, { id: args.meetingId }],
      } as any);
      if (!meeting) {
        throw new McpToolCallError("invalid_arguments", "Meeting not found.");
      }

      let dueAt: string | null = null;
      if (args.dueAt) {
        const parsed = toDateOrNull(args.dueAt);
        if (!parsed) {
          throw new McpToolCallError(
            "invalid_arguments",
            "dueAt must be a valid date."
          );
        }
        dueAt = parsed.toISOString();
      }

      // MCP has no session user — the meeting owner is the actor, falling
      // back to a workspace member (mcp-write-tools uses task.userId the
      // same way).
      let actorUserId =
        typeof (meeting as any).userId === "string" && (meeting as any).userId
          ? String((meeting as any).userId)
          : null;
      if (!actorUserId) {
        const memberUserIds = await getWorkspaceMemberUserIds(db, workspaceId);
        actorUserId = memberUserIds[0] || null;
      }
      if (!actorUserId) {
        throw new McpToolCallError(
          "invalid_arguments",
          "Could not resolve a task owner for this workspace."
        );
      }

      const now = new Date();
      const title = args.title.trim();
      const assigneeName = args.assigneeName?.trim() || null;
      const priority = computeTaskPriority(
        {
          title,
          description: args.description || "",
          status: "todo",
          priority: "medium",
          dueAt,
          assigneeName,
          createdAt: now,
          lastUpdated: now,
        },
        { now }
      );

      const canonicalMeetingId = String((meeting as any)._id || args.meetingId);
      const task = {
        _id: randomUUID(),
        userId: actorUserId,
        workspaceId,
        title,
        description: args.description || "",
        status: "todo",
        priority: "medium",
        dueAt,
        assignee: null,
        assigneeName,
        assigneeNameKey: assigneeName ? normalizePersonNameKey(assigneeName) : null,
        aiSuggested: false,
        origin: "meeting",
        projectId: null,
        parentId: null,
        order: 0,
        subtaskCount: 0,
        sourceSessionId: canonicalMeetingId,
        sourceSessionName: (meeting as any).title || null,
        sourceSessionType: "meeting",
        sourceTaskId: null,
        taskState: "active",
        reviewStatus: "confirmed",
        reviewedAt: now,
        priorityScore: priority.priorityScore,
        priorityLabel: priority.priorityLabel,
        priorityReason: priority.priorityReason,
        priorityUpdatedAt: now.toISOString(),
        createdAt: now,
        lastUpdated: now,
      };

      // Single insertOne by design — NEVER syncTasksForSource with a partial
      // list (it deletes canonical tasks missing from the incoming list).
      await db.collection("tasks").insertOne(task as any);

      return {
        toolName: "create_task_from_meeting",
        summary: `Created task "${truncateText(title, 80)}" from meeting "${truncateText(
          String((meeting as any).title || canonicalMeetingId),
          80
        )}".`,
        data: { task: serializeMcpTask(task) },
      };
    },
  },
  {
    name: "schedule_slack_reminder",
    description:
      "Schedule a one-off Slack reminder for a task at a specific time (delivered via the workspace's Slack reminder settings).",
    scope: "mcp:write",
    inputSchema: scheduleSlackReminderArgsSchema,
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      required: ["taskId", "remindAt"],
      properties: {
        taskId: { type: "string", minLength: 1, maxLength: 120 },
        remindAt: { type: "string", minLength: 1, maxLength: 64 },
      },
    },
    handler: async ({ db, workspaceId }, rawArgs) => {
      const args = rawArgs as z.infer<typeof scheduleSlackReminderArgsSchema>;
      const runAt = toDateOrNull(args.remindAt);
      if (!runAt) {
        throw new McpToolCallError(
          "invalid_arguments",
          "remindAt must be a valid date."
        );
      }
      const now = new Date();
      if (runAt.getTime() < now.getTime() - REMINDER_PAST_GRACE_MS) {
        throw new McpToolCallError(
          "invalid_arguments",
          "remindAt must be in the future."
        );
      }
      if (runAt.getTime() > now.getTime() + REMINDER_MAX_HORIZON_MS) {
        throw new McpToolCallError(
          "invalid_arguments",
          "remindAt must be within the next 366 days."
        );
      }

      const task = await findTaskInWorkspace(db, workspaceId, args.taskId);
      if (!task) {
        throw new McpToolCallError("invalid_arguments", "Task not found.");
      }
      if ((task as any).status === "done") {
        throw new McpToolCallError(
          "invalid_arguments",
          "Task is already done; no reminder scheduled."
        );
      }

      let actorUserId =
        typeof (task as any).userId === "string" && (task as any).userId
          ? String((task as any).userId)
          : null;
      if (!actorUserId) {
        const memberUserIds = await getWorkspaceMemberUserIds(db, workspaceId);
        actorUserId = memberUserIds[0] || null;
      }
      if (!actorUserId) {
        throw new McpToolCallError(
          "invalid_arguments",
          "Could not resolve a reminder owner for this workspace."
        );
      }

      await ensureTaskReminderIndexes(db);
      const workspace = await findWorkspaceById(db, workspaceId);
      const settings = resolveSlackReminderSettings(workspace);
      const canonicalTaskId = String((task as any)._id || args.taskId);
      const runAtIso = runAt.toISOString();

      const reminder: TaskReminderDoc = {
        _id: randomUUID(),
        workspaceId,
        userId: actorUserId,
        taskId: canonicalTaskId,
        kind: "custom",
        dedupKey: buildTaskReminderDedupKey(canonicalTaskId, "custom", runAtIso),
        status: "scheduled",
        runAt,
        taskTitle: String((task as any).title || "Untitled task"),
        taskDueAt: toDueIso((task as any).dueAt),
        target: {
          type: settings.deliver === "channel" ? "channel" : "dm",
          slackUserId: null,
          channelId: settings.deliver === "channel" ? settings.defaultChannelId : null,
          assigneeName: getAssigneeLabel(task as any) || null,
        },
        attempts: 0,
        sentAt: null,
        failedAt: null,
        canceledAt: null,
        cancelReason: null,
        lastError: null,
        createdAt: now,
        updatedAt: now,
      };

      try {
        await db.collection(TASK_REMINDERS_COLLECTION).insertOne(reminder as any);
      } catch (error) {
        if (isDuplicateKeyError(error)) {
          throw new McpToolCallError(
            "invalid_arguments",
            "A reminder for this task at that time is already scheduled."
          );
        }
        throw error;
      }

      await enqueueJob(db, {
        type: "slack-reminder-send",
        userId: actorUserId,
        payload: { reminderId: reminder._id },
        maxAttempts: 1,
        runAt,
      });

      return {
        toolName: "schedule_slack_reminder",
        summary: `Scheduled Slack reminder for "${truncateText(
          reminder.taskTitle,
          80
        )}" at ${runAtIso}.`,
        data: { reminder: serializeTaskReminder(reminder) as Record<string, unknown> },
      };
    },
  },
];

export const getMcpTaskToolDefinitions = (): McpToolDefinition[] => TASK_TOOLS;
