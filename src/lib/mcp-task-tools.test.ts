import { getMcpTaskToolDefinitions } from "@/lib/mcp-task-tools";
import {
  executeRegisteredMcpTool,
  registerMcpTools,
  resetMcpRegistryForTests,
} from "@/lib/mcp-registry";
import { McpToolCallError } from "@/lib/mcp-read-tools";
import { executeMcpWriteTool } from "@/lib/mcp-write-tools";
import {
  cancelRemindersForTask,
  enqueueReminderSweepJob,
  ensureTaskReminderIndexes,
} from "@/lib/task-reminders";
import { enqueueJob } from "@/lib/jobs/store";
import { listActiveWorkspaceMembershipsForWorkspace } from "@/lib/workspace-memberships";
import { findWorkspaceById } from "@/lib/workspaces";

jest.mock("@/lib/workspace-memberships", () => ({
  listActiveWorkspaceMembershipsForWorkspace: jest.fn(),
}));

jest.mock("@/lib/mcp-write-tools", () => ({
  executeMcpWriteTool: jest.fn(),
}));

jest.mock("@/lib/task-reminders", () => ({
  TASK_REMINDERS_COLLECTION: "taskReminders",
  buildTaskReminderDedupKey: jest.fn(
    (taskId: string, kind: string, stamp: string) => `${taskId}:${kind}:${stamp}`
  ),
  cancelRemindersForTask: jest.fn(),
  ensureTaskReminderIndexes: jest.fn(),
  enqueueReminderSweepJob: jest.fn(),
  serializeTaskReminder: jest.fn((reminder: any) =>
    reminder ? { id: reminder._id, taskId: reminder.taskId, kind: reminder.kind } : null
  ),
}));

jest.mock("@/lib/jobs/store", () => ({
  enqueueJob: jest.fn(),
}));

jest.mock("@/lib/workspaces", () => ({
  findWorkspaceById: jest.fn(),
}));

const mockedMemberships =
  listActiveWorkspaceMembershipsForWorkspace as jest.MockedFunction<
    typeof listActiveWorkspaceMembershipsForWorkspace
  >;
const mockedExecuteMcpWriteTool = executeMcpWriteTool as jest.MockedFunction<
  typeof executeMcpWriteTool
>;
const mockedCancelReminders = cancelRemindersForTask as jest.MockedFunction<
  typeof cancelRemindersForTask
>;
const mockedEnqueueSweep = enqueueReminderSweepJob as jest.MockedFunction<
  typeof enqueueReminderSweepJob
>;
const mockedEnsureIndexes = ensureTaskReminderIndexes as jest.MockedFunction<
  typeof ensureTaskReminderIndexes
>;
const mockedEnqueueJob = enqueueJob as jest.MockedFunction<typeof enqueueJob>;
const mockedFindWorkspaceById = findWorkspaceById as jest.MockedFunction<
  typeof findWorkspaceById
>;

const createCursor = (rows: any[]) => {
  let workingRows = [...rows];
  const cursor: any = {};
  cursor.project = jest.fn(() => cursor);
  cursor.sort = jest.fn(() => cursor);
  cursor.limit = jest.fn((limit: number) => {
    workingRows = workingRows.slice(0, limit);
    return cursor;
  });
  cursor.toArray = jest.fn(async () => workingRows);
  return cursor;
};

const run = (db: any, toolName: string, args: Record<string, unknown>) =>
  executeRegisteredMcpTool({ db, workspaceId: "workspace-1" }, toolName, args);

describe("mcp-task-tools", () => {
  beforeAll(() => {
    resetMcpRegistryForTests();
    registerMcpTools(getMcpTaskToolDefinitions());
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockedMemberships.mockResolvedValue([
      { userId: "user-1", status: "active" },
    ] as any);
    mockedFindWorkspaceById.mockResolvedValue({
      _id: "workspace-1",
      settings: {},
    } as any);
    mockedEnsureIndexes.mockResolvedValue(undefined as any);
    mockedEnqueueJob.mockResolvedValue({ _id: "job-1" } as any);
    mockedCancelReminders.mockResolvedValue({ canceled: 1 } as any);
    mockedEnqueueSweep.mockResolvedValue({ enqueued: true, jobId: "job-2" } as any);
  });

  it("exposes the seven task tools with correct scopes", () => {
    const definitions = getMcpTaskToolDefinitions();
    const scopes = Object.fromEntries(
      definitions.map((definition) => [definition.name, definition.scope])
    );
    expect(scopes).toEqual({
      list_tasks: "mcp:read",
      update_task_status: "mcp:write",
      assign_task: "mcp:write",
      set_task_due_date: "mcp:write",
      prioritize_tasks: "mcp:write",
      create_task_from_meeting: "mcp:write",
      schedule_slack_reminder: "mcp:write",
    });
  });

  it("list_tasks filters open workspace tasks and serializes them", async () => {
    const tasksCursor = createCursor([
      {
        _id: "task-1",
        workspaceId: "workspace-1",
        title: "Ship the deck",
        status: "todo",
        priorityScore: 60,
        priorityLabel: "high",
        createdAt: new Date("2026-06-01T10:00:00.000Z"),
        lastUpdated: new Date("2026-06-02T10:00:00.000Z"),
      },
    ]);
    const find = jest.fn(() => tasksCursor);
    const db = {
      collection: jest.fn((name: string) => {
        if (name === "tasks") return { find };
        throw new Error(`Unexpected collection: ${name}`);
      }),
    } as any;

    const result = await run(db, "list_tasks", { priorityLabel: "high", limit: 10 });
    const data = result.data as any;

    const filter = (find.mock.calls as any[])[0][0];
    expect(filter.$and).toEqual(
      expect.arrayContaining([
        { taskState: { $ne: "archived" } },
        { cleanupStatus: { $ne: "expired" } },
        { priorityLabel: "high" },
        { status: { $nin: ["done", "completed", "complete"] } },
      ])
    );
    expect(data.totalCount).toBe(1);
    expect(data.tasks[0]).toMatchObject({
      id: "task-1",
      title: "Ship the deck",
      lastUpdated: "2026-06-02T10:00:00.000Z",
    });
  });

  it("update_task_status delegates to the legacy write tool and renames the result", async () => {
    mockedExecuteMcpWriteTool.mockResolvedValueOnce({
      toolName: "action_items.update_status",
      summary: "Updated status to done.",
      data: { task: { id: "task-1", status: "done" } },
    } as any);
    const db = { collection: jest.fn() } as any;

    const result = await run(db, "update_task_status", {
      taskId: "task-1",
      status: "done",
    });

    expect(mockedExecuteMcpWriteTool).toHaveBeenCalledWith(
      db,
      "workspace-1",
      "action_items.update_status",
      { taskId: "task-1", status: "done" }
    );
    expect(result.toolName).toBe("update_task_status");
    expect((result.data as any).task.status).toBe("done");
  });

  it("assign_task requires assignee or assigneeName", async () => {
    const db = { collection: jest.fn() } as any;
    await expect(run(db, "assign_task", { taskId: "task-1" })).rejects.toBeInstanceOf(
      McpToolCallError
    );
    expect(mockedExecuteMcpWriteTool).not.toHaveBeenCalled();

    mockedExecuteMcpWriteTool.mockResolvedValueOnce({
      toolName: "action_items.update_assignee",
      summary: "Assigned to Alex.",
      data: { task: { id: "task-1", assigneeName: "Alex" } },
    } as any);
    const result = await run(db, "assign_task", {
      taskId: "task-1",
      assigneeName: "Alex",
    });
    expect(result.toolName).toBe("assign_task");
  });

  it("set_task_due_date reschedules reminders only on a real dueAt change", async () => {
    const findOne = jest.fn(async () => ({
      _id: "task-1",
      userId: "user-1",
      dueAt: "2026-06-10T00:00:00.000Z",
    }));
    const db = {
      collection: jest.fn((name: string) => {
        if (name === "tasks") return { findOne };
        throw new Error(`Unexpected collection: ${name}`);
      }),
    } as any;
    mockedExecuteMcpWriteTool.mockResolvedValueOnce({
      toolName: "action_items.update_due_date",
      summary: "Due date updated.",
      data: { task: { id: "task-1", dueAt: "2026-06-20T00:00:00.000Z" } },
    } as any);

    const result = await run(db, "set_task_due_date", {
      taskId: "task-1",
      dueAt: "2026-06-20T00:00:00.000Z",
    });

    expect(result.toolName).toBe("set_task_due_date");
    expect(mockedCancelReminders).toHaveBeenCalledWith(
      expect.anything(),
      "task-1",
      "due_date_changed"
    );
    expect(mockedEnqueueSweep).toHaveBeenCalledWith(expect.anything(), {
      workspaceId: "workspace-1",
      userId: "user-1",
    });
  });

  it("set_task_due_date skips reminder rescheduling when dueAt is unchanged", async () => {
    const findOne = jest.fn(async () => ({
      _id: "task-1",
      userId: "user-1",
      dueAt: new Date("2026-06-20T00:00:00.000Z"),
    }));
    const db = {
      collection: jest.fn(() => ({ findOne })),
    } as any;
    mockedExecuteMcpWriteTool.mockResolvedValueOnce({
      toolName: "action_items.update_due_date",
      summary: "Due date updated.",
      data: { task: { id: "task-1", dueAt: "2026-06-20T00:00:00.000Z" } },
    } as any);

    await run(db, "set_task_due_date", {
      taskId: "task-1",
      dueAt: "2026-06-20T00:00:00.000Z",
    });

    expect(mockedCancelReminders).not.toHaveBeenCalled();
    expect(mockedEnqueueSweep).not.toHaveBeenCalled();
  });

  it("prioritize_tasks recomputes scores and bulk-writes only changed docs", async () => {
    const overdueTask = {
      _id: "task-overdue",
      title: "Send contract",
      status: "todo",
      dueAt: "2026-01-01T00:00:00.000Z",
      priorityScore: 0,
      priorityLabel: "low",
    };
    const unchangedTask = {
      _id: "task-nochange",
      title: "Someday idea",
      status: "todo",
      priorityScore: 0,
      priorityLabel: "low",
      createdAt: "2020-01-01T00:00:00.000Z",
    };
    const tasksCursor = createCursor([overdueTask, unchangedTask]);
    const peopleCursor = createCursor([]);
    const bulkWrite = jest.fn(async () => ({}));
    const db = {
      collection: jest.fn((name: string) => {
        if (name === "tasks") return { find: jest.fn(() => tasksCursor), bulkWrite };
        if (name === "people") return { find: jest.fn(() => peopleCursor) };
        throw new Error(`Unexpected collection: ${name}`);
      }),
    } as any;

    const result = await run(db, "prioritize_tasks", {});
    const data = result.data as any;

    expect(data.scanned).toBe(2);
    expect(data.updated).toBe(1);
    expect(bulkWrite).toHaveBeenCalledTimes(1);
    const operations = (bulkWrite.mock.calls as any[])[0][0];
    expect(operations).toHaveLength(1);
    expect(operations[0].updateOne.filter).toEqual({ _id: "task-overdue" });
    expect(operations[0].updateOne.update.$set.priorityScore).toBeGreaterThan(0);
    expect(operations[0].updateOne.update.$set.priorityReason).toContain("Overdue");
  });

  it("create_task_from_meeting inserts a confirmed meeting-linked task", async () => {
    const insertOne = jest.fn(async () => ({}));
    const findOne = jest.fn(async () => ({
      _id: "meeting-1",
      userId: "owner-1",
      title: "Roadmap planning",
    }));
    const db = {
      collection: jest.fn((name: string) => {
        if (name === "meetings") return { findOne };
        if (name === "tasks") return { insertOne };
        throw new Error(`Unexpected collection: ${name}`);
      }),
    } as any;

    const result = await run(db, "create_task_from_meeting", {
      meetingId: "meeting-1",
      title: "Send the roadmap deck",
      dueAt: "2026-07-10T00:00:00.000Z",
      assigneeName: "Alex Parker",
    });
    const task = (result.data as any).task;

    expect(insertOne).toHaveBeenCalledTimes(1);
    const inserted = (insertOne.mock.calls as any[])[0][0];
    expect(inserted).toMatchObject({
      userId: "owner-1",
      workspaceId: "workspace-1",
      title: "Send the roadmap deck",
      status: "todo",
      sourceSessionType: "meeting",
      sourceSessionId: "meeting-1",
      sourceSessionName: "Roadmap planning",
      taskState: "active",
      reviewStatus: "confirmed",
      origin: "meeting",
    });
    expect(inserted.dueAt).toBe("2026-07-10T00:00:00.000Z");
    expect(typeof inserted.priorityScore).toBe("number");
    expect(task.id).toBe(inserted._id);
  });

  it("create_task_from_meeting rejects an unknown meeting", async () => {
    const db = {
      collection: jest.fn(() => ({ findOne: jest.fn(async () => null) })),
    } as any;
    await expect(
      run(db, "create_task_from_meeting", { meetingId: "ghost", title: "X" })
    ).rejects.toMatchObject({ code: "invalid_arguments" });
  });

  it("schedule_slack_reminder inserts a custom reminder and enqueues the send job", async () => {
    const remindAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const insertOne = jest.fn(async () => ({}));
    const findOne = jest.fn(async () => ({
      _id: "task-1",
      userId: "user-1",
      title: "Ship the deck",
      status: "todo",
      dueAt: "2026-08-01T00:00:00.000Z",
    }));
    const db = {
      collection: jest.fn((name: string) => {
        if (name === "tasks") return { findOne };
        if (name === "taskReminders") return { insertOne };
        throw new Error(`Unexpected collection: ${name}`);
      }),
    } as any;

    const result = await run(db, "schedule_slack_reminder", {
      taskId: "task-1",
      remindAt,
    });

    expect(mockedEnsureIndexes).toHaveBeenCalled();
    expect(insertOne).toHaveBeenCalledTimes(1);
    const reminder = (insertOne.mock.calls as any[])[0][0];
    expect(reminder).toMatchObject({
      workspaceId: "workspace-1",
      userId: "user-1",
      taskId: "task-1",
      kind: "custom",
      status: "scheduled",
      taskTitle: "Ship the deck",
    });
    expect(reminder.dedupKey).toBe(`task-1:custom:${remindAt}`);
    expect(mockedEnqueueJob).toHaveBeenCalledWith(db, {
      type: "slack-reminder-send",
      userId: "user-1",
      payload: { reminderId: reminder._id },
      maxAttempts: 1,
      runAt: new Date(remindAt),
    });
    expect((result.data as any).reminder).toMatchObject({ taskId: "task-1" });
  });

  it("schedule_slack_reminder rejects past times and duplicate reminders", async () => {
    const findOne = jest.fn(async () => ({
      _id: "task-1",
      userId: "user-1",
      title: "Ship the deck",
      status: "todo",
    }));
    const duplicateError = Object.assign(new Error("E11000 duplicate key error"), {
      code: 11000,
    });
    const insertOne = jest.fn(async () => {
      throw duplicateError;
    });
    const db = {
      collection: jest.fn((name: string) => {
        if (name === "tasks") return { findOne };
        if (name === "taskReminders") return { insertOne };
        throw new Error(`Unexpected collection: ${name}`);
      }),
    } as any;

    await expect(
      run(db, "schedule_slack_reminder", {
        taskId: "task-1",
        remindAt: "2020-01-01T00:00:00.000Z",
      })
    ).rejects.toMatchObject({ code: "invalid_arguments" });

    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await expect(
      run(db, "schedule_slack_reminder", { taskId: "task-1", remindAt: future })
    ).rejects.toMatchObject({ code: "invalid_arguments" });
    expect(mockedEnqueueJob).not.toHaveBeenCalled();
  });
});
