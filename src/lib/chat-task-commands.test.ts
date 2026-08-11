import {
  planChatTaskCommand,
  runChatTaskCommand,
  type ChatTaskCommand,
} from "@/lib/chat-task-commands";
import { executeRegisteredMcpTool } from "@/lib/mcp-registry";
import { McpToolCallError } from "@/lib/mcp-read-tools";

jest.mock("@/lib/mcp-register-all", () => ({}));
jest.mock("@/lib/mcp-registry", () => ({
  executeRegisteredMcpTool: jest.fn(),
}));

const mockedExecuteRegisteredMcpTool =
  executeRegisteredMcpTool as jest.MockedFunction<
    typeof executeRegisteredMcpTool
  >;

const scope = {
  userId: "user-1",
  workspaceId: "workspace-1",
  memberUserIds: ["user-1", "user-2"],
};

const createCursor = (rows: any[]) => {
  let workingRows = [...rows];
  const cursor: any = {};
  cursor.sort = jest.fn(() => cursor);
  cursor.limit = jest.fn((limit: number) => {
    workingRows = workingRows.slice(0, limit);
    return cursor;
  });
  cursor.toArray = jest.fn(async () => workingRows);
  return cursor;
};

const buildDb = (options?: { findOne?: any; rows?: any[] }) => {
  const findOne = jest.fn(async () => options?.findOne ?? null);
  const find = jest.fn((filter: any = {}) => {
    const titleRegex = filter?.title?.$regex;
    const rows =
      typeof titleRegex === "string"
        ? (options?.rows ?? []).filter((row) =>
            new RegExp(titleRegex, filter.title.$options).test(
              String(row?.title ?? "")
            )
          )
        : (options?.rows ?? []);
    return createCursor(rows);
  });
  const insertOne = jest.fn();
  const updateOne = jest.fn();
  return {
    db: {
      collection: jest.fn(() => ({ findOne, find, insertOne, updateOne })),
    } as any,
    findOne,
    find,
    insertOne,
    updateOne,
  };
};

const command = (question: string): ChatTaskCommand => {
  const planned = planChatTaskCommand(
    question,
    new Date("2026-08-11T10:00:00.000Z")
  );
  if (!planned) throw new Error(`Expected command for: ${question}`);
  return planned;
};

describe("chat-task-commands", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("creates workspace tasks through the typed create_task registry handler", async () => {
    const { db, insertOne } = buildDb();
    mockedExecuteRegisteredMcpTool.mockResolvedValue({
      toolName: "create_task",
      summary: "Created task.",
      data: {
        task: {
          id: "task-new",
          title: "Follow up with Casey",
          status: "todo",
        },
      },
    });

    const result = await runChatTaskCommand(
      db,
      scope,
      command("Create a task to follow up with Casey")
    );

    expect(mockedExecuteRegisteredMcpTool).toHaveBeenCalledWith(
      { db, workspaceId: "workspace-1" },
      "create_task",
      {
        ownerUserId: "user-1",
        title: "Follow up with Casey",
        description: undefined,
        dueAt: null,
      }
    );
    expect(insertOne).not.toHaveBeenCalled();
    expect(result.answer).toContain('Created task "Follow up with Casey"');
  });

  it("does not mistake a destructive-sounding task title for a destructive task edit", async () => {
    const { db } = buildDb();
    mockedExecuteRegisteredMcpTool.mockResolvedValue({
      toolName: "create_task",
      summary: "Created task.",
      data: {
        task: {
          id: "task-new",
          title: "Archive old meeting notes",
          status: "todo",
        },
      },
    });

    await runChatTaskCommand(
      db,
      scope,
      command("Create a task to archive old meeting notes")
    );

    expect(mockedExecuteRegisteredMcpTool).toHaveBeenCalledWith(
      { db, workspaceId: "workspace-1" },
      "create_task",
      expect.objectContaining({ title: "Archive old meeting notes" })
    );
  });

  it("preserves create titles containing delete language", async () => {
    const { db } = buildDb();
    mockedExecuteRegisteredMcpTool.mockResolvedValue({
      toolName: "create_task",
      summary: "Created task.",
      data: {
        task: {
          id: "task-new",
          title: "Delete stale local notes after review",
          status: "todo",
        },
      },
    });

    await runChatTaskCommand(
      db,
      scope,
      command("Create a task to delete stale local notes after review")
    );

    expect(mockedExecuteRegisteredMcpTool).toHaveBeenCalledWith(
      { db, workspaceId: "workspace-1" },
      "create_task",
      expect.objectContaining({
        title: "Delete stale local notes after review",
      })
    );
  });

  it("creates meeting-scoped tasks through create_task_from_meeting", async () => {
    const { db } = buildDb();
    mockedExecuteRegisteredMcpTool.mockResolvedValue({
      toolName: "create_task_from_meeting",
      summary: "Created meeting task.",
      data: {
        task: {
          id: "task-meeting",
          title: "Send meeting notes",
          status: "todo",
        },
      },
    });

    await runChatTaskCommand(
      db,
      scope,
      command("Create a task to send meeting notes"),
      { meetingId: "meeting-1" }
    );

    expect(mockedExecuteRegisteredMcpTool).toHaveBeenCalledWith(
      { db, workspaceId: "workspace-1" },
      "create_task_from_meeting",
      {
        meetingId: "meeting-1",
        title: "Send meeting notes",
        description: undefined,
        dueAt: undefined,
      }
    );
  });

  it.each([
    {
      label: "status",
      question: "Mark the selected task done",
      toolName: "update_task_status",
      expectedArgs: { taskId: "canonical-1", status: "done" },
    },
    {
      label: "title",
      question: "Rename the selected task to Send final proposal",
      toolName: "action_items.update_title",
      expectedArgs: { taskId: "canonical-1", title: "Send final proposal" },
    },
    {
      label: "due date",
      question: "Set the selected task due tomorrow",
      toolName: "set_task_due_date",
      expectedArgs: {
        taskId: "canonical-1",
        dueAt: "2026-08-12T23:59:59.999Z",
      },
    },
    {
      label: "cleared due date",
      question: "Clear the selected task due date",
      toolName: "set_task_due_date",
      expectedArgs: { taskId: "canonical-1", dueAt: null },
    },
    {
      label: "removed due date",
      question: "Remove the due date from the selected task",
      toolName: "set_task_due_date",
      expectedArgs: { taskId: "canonical-1", dueAt: null },
    },
  ])(
    "routes a selected task $label edit through its registered typed tool",
    async ({ question, toolName, expectedArgs }) => {
      const selectedTask = {
          _id: "canonical-1",
          sourceTaskId: "source-1",
          workspaceId: "workspace-1",
          userId: "user-1",
          title: "Follow up",
          status: "todo",
      };
      const { db, find, updateOne } = buildDb({ rows: [selectedTask] });
      mockedExecuteRegisteredMcpTool.mockResolvedValue({
        toolName,
        summary: "Updated task.",
        data: {
          task: {
            id: "canonical-1",
            title:
              toolName === "action_items.update_title"
                ? "Send final proposal"
                : "Follow up",
            status: toolName === "update_task_status" ? "done" : "todo",
          },
        },
      });

      await runChatTaskCommand(db, scope, command(question), {
        selectedTaskIds: ["source-1"],
      });

      expect(find).toHaveBeenCalledWith({
        $and: [
          expect.any(Object),
          { taskState: { $ne: "archived" } },
          {
            $or: [
              { _id: "source-1" },
              { sourceTaskId: "source-1" },
            ],
          },
        ],
      });
      expect(mockedExecuteRegisteredMcpTool).toHaveBeenCalledWith(
        { db, workspaceId: "workspace-1" },
        toolName,
        expectedArgs
      );
      expect(updateOne).not.toHaveBeenCalled();
    }
  );

  it("uses the server-resolved canonical id for an exact title match", async () => {
    const { db } = buildDb({
      rows: [
        {
          _id: "canonical-1",
          sourceTaskId: "source-1",
          workspaceId: "workspace-1",
          title: "Follow up with Casey",
          status: "todo",
        },
      ],
    });
    mockedExecuteRegisteredMcpTool.mockResolvedValue({
      toolName: "update_task_status",
      summary: "Updated status.",
      data: {
        task: {
          id: "canonical-1",
          title: "Follow up with Casey",
          status: "done",
        },
      },
    });

    await runChatTaskCommand(
      db,
      scope,
      command("Set task Follow up with Casey to done")
    );

    expect(mockedExecuteRegisteredMcpTool).toHaveBeenCalledWith(
      { db, workspaceId: "workspace-1" },
      "update_task_status",
      { taskId: "canonical-1", status: "done" }
    );
  });

  it("blocks destructive language anywhere in a non-create command", async () => {
    const { db } = buildDb({
      rows: [
        {
          _id: "canonical-1",
          title: "Archive old meeting notes",
          status: "todo",
        },
      ],
    });
    const planned = command(
      "Rename task Archive old meeting notes to File old meeting notes"
    );
    expect(planned.kind).toBe("clarify");

    const result = await runChatTaskCommand(db, scope, planned);

    expect(result.confidence).toBe("low");
    expect(mockedExecuteRegisteredMcpTool).not.toHaveBeenCalled();
  });

  it("clarifies multi-selection without reading or writing", async () => {
    const { db, find, findOne, insertOne, updateOne } = buildDb();

    const result = await runChatTaskCommand(
      db,
      scope,
      command("Mark the selected task done"),
      { selectedTaskIds: ["task-1", "task-2"] }
    );

    expect(result.answer).toMatch(/one task at a time/i);
    expect(find).not.toHaveBeenCalled();
    expect(findOne).not.toHaveBeenCalled();
    expect(insertOne).not.toHaveBeenCalled();
    expect(updateOne).not.toHaveBeenCalled();
    expect(mockedExecuteRegisteredMcpTool).not.toHaveBeenCalled();
  });

  it("clarifies an out-of-scope selected id without falling back to title", async () => {
    const { db, find, updateOne } = buildDb({ rows: [] });

    const result = await runChatTaskCommand(
      db,
      scope,
      command("Mark the selected task done"),
      { selectedTaskIds: ["other-workspace-task"] }
    );

    expect(result.answer).toMatch(/selected task.*workspace/i);
    expect(find).toHaveBeenCalledTimes(1);
    expect(updateOne).not.toHaveBeenCalled();
    expect(mockedExecuteRegisteredMcpTool).not.toHaveBeenCalled();
  });

  it("clarifies when a selected id collides with another task source id", async () => {
    const { db, updateOne } = buildDb({
      findOne: {
        _id: "shared-id",
        title: "First task",
        workspaceId: "workspace-1",
      },
      rows: [
        { _id: "shared-id", title: "First task", workspaceId: "workspace-1" },
        {
          _id: "canonical-2",
          sourceTaskId: "shared-id",
          title: "Second task",
          workspaceId: "workspace-1",
        },
      ],
    });

    const result = await runChatTaskCommand(
      db,
      scope,
      command("Mark the selected task done"),
      { selectedTaskIds: ["shared-id"] }
    );

    expect(result.answer).toMatch(/multiple matching tasks|selected task.*ambiguous/i);
    expect(updateOne).not.toHaveBeenCalled();
    expect(mockedExecuteRegisteredMcpTool).not.toHaveBeenCalled();
  });

  it("clarifies ambiguous title matches and performs zero writes", async () => {
    const { db, insertOne, updateOne } = buildDb({
      rows: [
        { _id: "task-1", title: "Follow up with Casey", status: "todo" },
        { _id: "task-2", title: "Follow up with Casey", status: "done" },
      ],
    });

    const result = await runChatTaskCommand(
      db,
      scope,
      command("Mark task Follow up with Casey done")
    );

    expect(result.answer).toMatch(/multiple matching tasks/i);
    expect(insertOne).not.toHaveBeenCalled();
    expect(updateOne).not.toHaveBeenCalled();
    expect(mockedExecuteRegisteredMcpTool).not.toHaveBeenCalled();
  });

  it("finds ambiguity beyond the former 25-task scan without an unbounded read", async () => {
    const rows = [
      { _id: "task-1", title: "Follow up with Casey", status: "todo" },
      ...Array.from({ length: 24 }, (_, index) => ({
        _id: `distractor-${index}`,
        title: `Unrelated task ${index}`,
        status: "todo",
      })),
      { _id: "task-older", title: "Follow up with Casey", status: "todo" },
    ];
    const { db, find, updateOne } = buildDb({ rows });
    mockedExecuteRegisteredMcpTool.mockResolvedValue({
      toolName: "update_task_status",
      summary: "Updated status.",
      data: { task: { id: "task-1", title: "Follow up with Casey" } },
    });

    const result = await runChatTaskCommand(
      db,
      scope,
      command("Mark task Follow up with Casey done")
    );

    expect(result.answer).toMatch(/multiple matching tasks/i);
    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.objectContaining({ $regex: expect.any(String) }),
      })
    );
    expect(updateOne).not.toHaveBeenCalled();
    expect(mockedExecuteRegisteredMcpTool).not.toHaveBeenCalled();
  });

  it.each([
    "Mark task Foo done and then delete it",
    "Delete task Foo and remove task Foo due date",
    "Mark task Foo done and task Bar done",
  ])("blocks mixed or multi-target task writes with zero registry calls: %s", async (question) => {
    const { db, findOne, insertOne, updateOne } = buildDb({
      findOne: { _id: "task-foo", title: "Foo", workspaceId: "workspace-1" },
      rows: [{ _id: "task-foo", title: "Foo", workspaceId: "workspace-1" }],
    });

    const planned = command(question);
    expect(planned.kind).toBe("clarify");

    const result = await runChatTaskCommand(db, scope, planned);

    expect(result.confidence).toBe("low");
    expect(findOne).not.toHaveBeenCalled();
    expect(insertOne).not.toHaveBeenCalled();
    expect(updateOne).not.toHaveBeenCalled();
    expect(mockedExecuteRegisteredMcpTool).not.toHaveBeenCalled();
  });

  it.each([
    { label: "missing", data: {} },
    { label: "malformed", data: { task: {} } },
  ])("does not claim success when the update tool returns $label task data", async ({ data }) => {
    const { db } = buildDb({
      rows: [{ _id: "task-1", title: "Follow up", status: "todo" }],
    });
    mockedExecuteRegisteredMcpTool.mockResolvedValue({
      toolName: "update_task_status",
      summary: "Updated status.",
      data,
    });

    const result = await runChatTaskCommand(
      db,
      scope,
      command("Mark task Follow up done")
    );

    expect(result.confidence).toBe("low");
    expect(result.answer).toMatch(/couldn't confirm|did not return/i);
  });

  it("maps a known typed-tool rejection to a safe clarification", async () => {
    const { db } = buildDb({
      rows: [{ _id: "task-1", title: "Follow up", status: "todo" }],
    });
    mockedExecuteRegisteredMcpTool.mockRejectedValue(
      new McpToolCallError("invalid_arguments", "Task not found.")
    );

    await expect(
      runChatTaskCommand(db, scope, command("Mark task Follow up done"))
    ).resolves.toMatchObject({ confidence: "low" });
  });

  it.each([
    "Delete the selected task",
    "Archive task Follow up with Casey",
    "Mark all tasks done",
    "Bulk update these tasks to in progress",
  ])("clarifies unsafe task language with zero writes: %s", async (question) => {
    const { db, find, findOne, insertOne, updateOne } = buildDb();
    const planned = command(question);

    expect(planned.kind).toBe("clarify");
    const result = await runChatTaskCommand(db, scope, planned, {
      selectedTaskIds: ["task-1"],
    });

    expect(result.answer).toMatch(/can't.*(delete|archive|bulk)|one task/i);
    expect(find).not.toHaveBeenCalled();
    expect(findOne).not.toHaveBeenCalled();
    expect(insertOne).not.toHaveBeenCalled();
    expect(updateOne).not.toHaveBeenCalled();
    expect(mockedExecuteRegisteredMcpTool).not.toHaveBeenCalled();
  });
});
