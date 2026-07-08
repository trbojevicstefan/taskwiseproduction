import { getMcpWorkspaceToolDefinitions } from "@/lib/mcp-workspace-tools";
import {
  executeRegisteredMcpTool,
  registerMcpTools,
  resetMcpRegistryForTests,
} from "@/lib/mcp-registry";
import { McpToolCallError } from "@/lib/mcp-read-tools";
import { listActiveWorkspaceMembershipsForWorkspace } from "@/lib/workspace-memberships";

jest.mock("@/lib/workspace-memberships", () => ({
  listActiveWorkspaceMembershipsForWorkspace: jest.fn(),
}));

const mockedMemberships =
  listActiveWorkspaceMembershipsForWorkspace as jest.MockedFunction<
    typeof listActiveWorkspaceMembershipsForWorkspace
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

describe("mcp-workspace-tools", () => {
  beforeAll(() => {
    resetMcpRegistryForTests();
    registerMcpTools(getMcpWorkspaceToolDefinitions());
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockedMemberships.mockResolvedValue([
      { userId: "user-1", status: "active" },
    ] as any);
  });

  it("exposes the four workspace tools, all read-scoped", () => {
    const definitions = getMcpWorkspaceToolDefinitions();
    expect(definitions.map((definition) => definition.name)).toEqual([
      "list_clients",
      "get_client_commitments",
      "get_board_snapshot",
      "get_calendar_agenda",
    ]);
    expect(definitions.every((definition) => definition.scope === "mcp:read")).toBe(
      true
    );
  });

  it("list_clients filters people by personType client", async () => {
    const peopleCursor = createCursor([
      {
        _id: "person-1",
        name: "Casey Client",
        email: "casey@client.com",
        personType: "client",
        company: "Client Co",
        lastSeenAt: new Date("2026-06-01T10:00:00.000Z"),
      },
    ]);
    const find = jest.fn(() => peopleCursor);
    const db = {
      collection: jest.fn((name: string) => {
        if (name === "people") return { find };
        throw new Error(`Unexpected collection: ${name}`);
      }),
    } as any;

    const result = await run(db, "list_clients", { query: "casey" });
    const data = result.data as any;

    const filter = (find.mock.calls as any[])[0][0];
    expect(filter.$and).toEqual(
      expect.arrayContaining([{ personType: "client" }])
    );
    expect(data.totalCount).toBe(1);
    expect(data.clients[0]).toMatchObject({
      id: "person-1",
      name: "Casey Client",
      company: "Client Co",
    });
  });

  it("get_client_commitments matches the person's tasks and flags overdue ones", async () => {
    const personFindOne = jest.fn(async () => ({
      _id: "person-1",
      name: "Casey Client",
      email: "casey@client.com",
      personType: "client",
    }));
    const tasksCursor = createCursor([
      {
        _id: "task-overdue",
        title: "Send proposal",
        status: "todo",
        dueAt: "2026-01-01T00:00:00.000Z",
        assignee: { uid: "person-1" },
      },
      {
        _id: "task-future",
        title: "Kickoff prep",
        status: "todo",
        dueAt: "2999-01-01T00:00:00.000Z",
        assignee: { uid: "person-1" },
      },
    ]);
    const tasksFind = jest.fn(() => tasksCursor);
    const db = {
      collection: jest.fn((name: string) => {
        if (name === "people") return { findOne: personFindOne };
        if (name === "tasks") return { find: tasksFind };
        throw new Error(`Unexpected collection: ${name}`);
      }),
    } as any;

    const result = await run(db, "get_client_commitments", { personId: "person-1" });
    const data = result.data as any;

    const filter = (tasksFind.mock.calls as any[])[0][0];
    expect(filter.$and).toEqual(
      expect.arrayContaining([
        { taskState: { $ne: "archived" } },
        { cleanupStatus: { $ne: "expired" } },
        { status: { $nin: ["done", "completed", "complete"] } },
        expect.objectContaining({
          $or: expect.arrayContaining([
            { "assignee.uid": "person-1" },
            { "assignee.email": "casey@client.com" },
          ]),
        }),
      ])
    );
    expect(data.person).toMatchObject({ id: "person-1", name: "Casey Client" });
    expect(data.totalCount).toBe(2);
    expect(data.overdueCount).toBe(1);
    expect(
      data.commitments.find((task: any) => task.id === "task-overdue").overdue
    ).toBe(true);
    expect(
      data.commitments.find((task: any) => task.id === "task-future").overdue
    ).toBe(false);
  });

  it("get_client_commitments returns empty data for unknown people", async () => {
    const db = {
      collection: jest.fn(() => ({ findOne: jest.fn(async () => null) })),
    } as any;

    const result = await run(db, "get_client_commitments", { personId: "ghost" });
    expect((result.data as any).person).toBeNull();
    expect((result.data as any).commitments).toEqual([]);
  });

  it("get_board_snapshot groups board items under ordered columns", async () => {
    const board = { _id: "board-1", name: "Delivery", isDefault: true };
    const statuses = [
      { _id: "status-todo", label: "To do", category: "todo", order: 0 },
      { _id: "status-done", label: "Done", category: "done", order: 1, isTerminal: true },
    ];
    const items = [
      {
        _id: "item-1",
        statusId: "status-todo",
        rank: 1000,
        task: {
          _id: "task-1",
          title: "Ship the deck",
          status: "todo",
          createdAt: new Date("2026-06-01T10:00:00.000Z"),
          lastUpdated: new Date("2026-06-02T10:00:00.000Z"),
        },
      },
    ];
    const aggregate = jest.fn(() => ({ toArray: jest.fn(async () => items) }));
    const db = {
      collection: jest.fn((name: string) => {
        if (name === "boards") return { findOne: jest.fn(async () => board) };
        if (name === "boardStatuses") return { find: jest.fn(() => createCursor(statuses)) };
        if (name === "boardItems") return { aggregate };
        throw new Error(`Unexpected collection: ${name}`);
      }),
    } as any;

    const result = await run(db, "get_board_snapshot", {});
    const data = result.data as any;

    expect(data.board).toEqual({ id: "board-1", name: "Delivery", isDefault: true });
    expect(data.statuses).toHaveLength(2);
    expect(data.statuses[0]).toMatchObject({
      id: "status-todo",
      label: "To do",
      itemCount: 1,
    });
    expect(data.statuses[0].items[0]).toMatchObject({
      id: "task-1",
      title: "Ship the deck",
      boardItemId: "item-1",
    });
    expect(data.statuses[1].itemCount).toBe(0);
    expect(data.totalItems).toBe(1);
  });

  it("get_board_snapshot returns an empty snapshot when no boards exist", async () => {
    const db = {
      collection: jest.fn((name: string) => {
        if (name === "boards") {
          return {
            findOne: jest.fn(async () => null),
            find: jest.fn(() => createCursor([])),
          };
        }
        throw new Error(`Unexpected collection: ${name}`);
      }),
    } as any;

    const result = await run(db, "get_board_snapshot", {});
    expect((result.data as any).board).toBeNull();
    expect((result.data as any).totalItems).toBe(0);
  });

  it("get_calendar_agenda returns meetings, range-filtered tasks, and reminders", async () => {
    const meetings = [
      {
        _id: "meeting-1",
        title: "Client sync",
        startTime: new Date("2026-07-08T10:00:00.000Z"),
        attendees: [{ name: "Casey Client", email: "casey@client.com" }],
      },
    ];
    const tasks = [
      {
        _id: "task-in-range",
        title: "Ship the deck",
        status: "todo",
        dueAt: "2026-07-09T00:00:00.000Z",
      },
      {
        _id: "task-out-of-range",
        title: "Far future",
        status: "todo",
        dueAt: "2999-01-01T00:00:00.000Z",
      },
    ];
    const reminders = [
      {
        _id: "reminder-1",
        taskId: "task-in-range",
        taskTitle: "Ship the deck",
        kind: "on_due",
        runAt: new Date("2026-07-09T09:00:00.000Z"),
      },
    ];
    const clients = [{ name: "Casey Client", email: "casey@client.com" }];
    const db = {
      collection: jest.fn((name: string) => {
        if (name === "meetings") return { find: jest.fn(() => createCursor(meetings)) };
        if (name === "tasks") return { find: jest.fn(() => createCursor(tasks)) };
        if (name === "taskReminders")
          return { find: jest.fn(() => createCursor(reminders)) };
        if (name === "people") return { find: jest.fn(() => createCursor(clients)) };
        throw new Error(`Unexpected collection: ${name}`);
      }),
    } as any;

    const result = await run(db, "get_calendar_agenda", {
      from: "2026-07-06T00:00:00.000Z",
      to: "2026-07-13T00:00:00.000Z",
    });
    const data = result.data as any;

    expect(data.meetings).toHaveLength(1);
    expect(data.meetings[0]).toMatchObject({
      id: "meeting-1",
      link: "/meetings/meeting-1",
      attendees: [{ name: "Casey Client", email: "casey@client.com" }],
      attendeeCount: 1,
      isClientMeeting: true,
    });
    expect(data.tasks.map((task: any) => task.id)).toEqual(["task-in-range"]);
    expect(data.reminders[0]).toMatchObject({
      id: "reminder-1",
      kind: "on_due",
      status: "scheduled",
    });
  });

  it("get_calendar_agenda rejects inverted and oversized ranges", async () => {
    const db = { collection: jest.fn() } as any;

    await expect(
      run(db, "get_calendar_agenda", {
        from: "2026-07-10T00:00:00.000Z",
        to: "2026-07-01T00:00:00.000Z",
      })
    ).rejects.toBeInstanceOf(McpToolCallError);

    await expect(
      run(db, "get_calendar_agenda", {
        from: "2026-01-01T00:00:00.000Z",
        to: "2026-12-31T00:00:00.000Z",
      })
    ).rejects.toMatchObject({ code: "invalid_arguments" });
  });
});
