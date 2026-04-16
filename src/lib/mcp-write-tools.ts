import { z } from "zod";
import type { Db } from "mongodb";
import { publishDomainEvent } from "@/lib/domain-events";
import { normalizePersonNameKey } from "@/lib/transcript-utils";
import { McpToolCallError } from "@/lib/mcp-read-tools";

type JsonSchema = Record<string, unknown>;

export type McpWriteToolDefinition = {
  name: string;
  description: string;
  inputSchema: JsonSchema;
};

export type McpWriteToolExecutionResult = {
  toolName: string;
  summary: string;
  data: Record<string, unknown>;
};

const statusValues = ["todo", "inprogress", "done", "recurring"] as const;

const updateStatusArgsSchema = z.object({
  taskId: z.string().trim().min(1),
  status: z.enum(statusValues),
});

const updateAssigneeArgsSchema = z.object({
  taskId: z.string().trim().min(1),
  assignee: z
    .object({
      uid: z.string().trim().min(1).optional(),
      email: z.string().trim().email().optional(),
      name: z.string().trim().min(1).optional(),
    })
    .nullable()
    .optional(),
  assigneeName: z.string().trim().min(1).max(200).nullable().optional(),
});

const updateDueDateArgsSchema = z.object({
  taskId: z.string().trim().min(1),
  dueAt: z.string().trim().min(1).nullable(),
});

const updateNotesArgsSchema = z.object({
  taskId: z.string().trim().min(1),
  notes: z.string().max(10_000).nullable(),
});

const updateTitleArgsSchema = z.object({
  taskId: z.string().trim().min(1),
  title: z.string().trim().min(1).max(300),
});

const MCP_WRITE_TOOLS: McpWriteToolDefinition[] = [
  {
    name: "action_items.update_status",
    description: "Update action-item status.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["taskId", "status"],
      properties: {
        taskId: { type: "string" },
        status: { type: "string", enum: statusValues },
      },
    },
  },
  {
    name: "action_items.update_assignee",
    description: "Update action-item assignee.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["taskId"],
      properties: {
        taskId: { type: "string" },
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
  },
  {
    name: "action_items.update_due_date",
    description: "Update action-item due date.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["taskId", "dueAt"],
      properties: {
        taskId: { type: "string" },
        dueAt: { type: ["string", "null"] },
      },
    },
  },
  {
    name: "action_items.update_notes",
    description: "Update action-item notes/comments.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["taskId", "notes"],
      properties: {
        taskId: { type: "string" },
        notes: { type: ["string", "null"] },
      },
    },
  },
  {
    name: "action_items.update_title",
    description: "Update the canonical action-item title.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["taskId", "title"],
      properties: {
        taskId: { type: "string" },
        title: { type: "string" },
      },
    },
  },
];

const serializeDate = (value: unknown) => {
  if (value instanceof Date) return value.toISOString();
  return value ?? null;
};

const serializeTask = (task: any) => ({
  ...task,
  id: String(task?._id || task?.id || ""),
  _id: undefined,
  createdAt: serializeDate(task?.createdAt),
  lastUpdated: serializeDate(task?.lastUpdated),
  dueAt: serializeDate(task?.dueAt),
});

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

const findTaskInWorkspace = async (db: Db, workspaceId: string, taskId: string) => {
  return db.collection("tasks").findOne({
    workspaceId,
    taskState: { $ne: "archived" },
    $or: [{ _id: taskId }, { id: taskId }, { sourceTaskId: taskId }],
  } as any);
};

const updateTaskById = async (
  db: Db,
  task: any,
  update: Record<string, unknown>
) => {
  const now = new Date();
  await db.collection("tasks").updateOne(
    { _id: task._id },
    {
      $set: {
        ...update,
        lastUpdated: now,
      },
    }
  );
  return db.collection("tasks").findOne({ _id: task._id });
};

export const listMcpWriteTools = () => MCP_WRITE_TOOLS;

export const getMcpWriteToolNames = () => MCP_WRITE_TOOLS.map((tool) => tool.name);

export const executeMcpWriteTool = async (
  db: Db,
  workspaceId: string,
  toolName: string,
  rawArgs?: Record<string, unknown>
): Promise<McpWriteToolExecutionResult> => {
  switch (toolName) {
    case "action_items.update_status": {
      const args = parseArgs(updateStatusArgsSchema, rawArgs);
      const task = await findTaskInWorkspace(db, workspaceId, args.taskId);
      if (!task) {
        throw new McpToolCallError("invalid_arguments", "Task not found.");
      }

      const updated = await updateTaskById(db, task, { status: args.status });
      if (!updated) {
        throw new McpToolCallError("invalid_arguments", "Task not found.");
      }

      const userId = typeof updated.userId === "string" ? updated.userId : null;
      if (userId) {
        await publishDomainEvent(db as any, {
          type: "task.status.changed",
          userId,
          payload: {
            taskId: String(updated._id || args.taskId),
            status: args.status,
            sourceSessionType:
              updated.sourceSessionType === "meeting" || updated.sourceSessionType === "chat"
                ? updated.sourceSessionType
                : undefined,
            sourceSessionId: updated.sourceSessionId
              ? String(updated.sourceSessionId)
              : undefined,
          },
        });
      }

      return {
        toolName,
        summary: `Updated status to ${args.status}.`,
        data: { task: serializeTask(updated) },
      };
    }
    case "action_items.update_assignee": {
      const args = parseArgs(updateAssigneeArgsSchema, rawArgs);
      const task = await findTaskInWorkspace(db, workspaceId, args.taskId);
      if (!task) {
        throw new McpToolCallError("invalid_arguments", "Task not found.");
      }

      const assignee = args.assignee === undefined ? task.assignee || null : args.assignee;
      const assigneeName =
        args.assigneeName !== undefined
          ? args.assigneeName
          : assignee?.name || null;
      const assigneeNameKey = assigneeName ? normalizePersonNameKey(assigneeName) : null;

      const updated = await updateTaskById(db, task, {
        assignee: assignee || null,
        assigneeName: assigneeName || null,
        assigneeNameKey,
      });
      if (!updated) {
        throw new McpToolCallError("invalid_arguments", "Task not found.");
      }

      return {
        toolName,
        summary: assigneeName
          ? `Assigned to ${assigneeName}.`
          : "Assignee cleared.",
        data: { task: serializeTask(updated) },
      };
    }
    case "action_items.update_due_date": {
      const args = parseArgs(updateDueDateArgsSchema, rawArgs);
      const task = await findTaskInWorkspace(db, workspaceId, args.taskId);
      if (!task) {
        throw new McpToolCallError("invalid_arguments", "Task not found.");
      }

      let dueAt: string | null = null;
      if (args.dueAt) {
        const parsedDate = new Date(args.dueAt);
        if (Number.isNaN(parsedDate.getTime())) {
          throw new McpToolCallError("invalid_arguments", "dueAt must be a valid date.");
        }
        dueAt = parsedDate.toISOString();
      }

      const updated = await updateTaskById(db, task, { dueAt });
      if (!updated) {
        throw new McpToolCallError("invalid_arguments", "Task not found.");
      }

      return {
        toolName,
        summary: dueAt ? `Due date updated to ${dueAt}.` : "Due date cleared.",
        data: { task: serializeTask(updated) },
      };
    }
    case "action_items.update_notes": {
      const args = parseArgs(updateNotesArgsSchema, rawArgs);
      const task = await findTaskInWorkspace(db, workspaceId, args.taskId);
      if (!task) {
        throw new McpToolCallError("invalid_arguments", "Task not found.");
      }

      const updated = await updateTaskById(db, task, {
        comments: args.notes ?? null,
      });
      if (!updated) {
        throw new McpToolCallError("invalid_arguments", "Task not found.");
      }

      return {
        toolName,
        summary: args.notes ? "Notes updated." : "Notes cleared.",
        data: { task: serializeTask(updated) },
      };
    }
    case "action_items.update_title": {
      const args = parseArgs(updateTitleArgsSchema, rawArgs);
      const task = await findTaskInWorkspace(db, workspaceId, args.taskId);
      if (!task) {
        throw new McpToolCallError("invalid_arguments", "Task not found.");
      }

      const updated = await updateTaskById(db, task, { title: args.title.trim() });
      if (!updated) {
        throw new McpToolCallError("invalid_arguments", "Task not found.");
      }

      return {
        toolName,
        summary: "Title updated.",
        data: { task: serializeTask(updated) },
      };
    }
    default:
      throw new McpToolCallError("tool_not_found", `Tool not found: ${toolName}`);
  }
};
