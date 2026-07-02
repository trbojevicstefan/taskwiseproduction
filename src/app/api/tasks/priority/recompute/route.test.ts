import { POST } from "@/app/api/tasks/priority/recompute/route";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { resolveWorkspaceScopeForUser } from "@/lib/workspace-scope";

jest.mock("@/lib/db", () => ({
  getDb: jest.fn(),
}));

jest.mock("@/lib/server-auth", () => ({
  getSessionUserId: jest.fn(),
}));

jest.mock("@/lib/workspace-scope", () => ({
  resolveWorkspaceScopeForUser: jest.fn(),
}));

jest.mock("@/lib/observability-metrics", () => ({
  recordRouteMetric: jest.fn(),
}));

const mockedGetDb = getDb as jest.MockedFunction<typeof getDb>;
const mockedGetSessionUserId = getSessionUserId as jest.MockedFunction<
  typeof getSessionUserId
>;
const mockedResolveWorkspaceScopeForUser =
  resolveWorkspaceScopeForUser as jest.MockedFunction<
    typeof resolveWorkspaceScopeForUser
  >;

const DAY_MS = 24 * 60 * 60 * 1000;

const buildRequest = () =>
  new Request("http://localhost/api/tasks/priority/recompute", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });

const buildDb = ({
  tasks,
  people,
}: {
  tasks: any[];
  people: any[];
}) => {
  const tasksToArray = jest.fn().mockResolvedValue(tasks);
  const tasksLimit = jest.fn().mockReturnValue({ toArray: tasksToArray });
  const tasksSort = jest.fn().mockReturnValue({ limit: tasksLimit });
  const tasksFind = jest.fn().mockReturnValue({ sort: tasksSort });
  const bulkWrite = jest.fn().mockResolvedValue({});

  const peopleToArray = jest.fn().mockResolvedValue(people);
  const peopleFind = jest.fn().mockReturnValue({ toArray: peopleToArray });

  const db = {
    collection: jest.fn((name: string) => {
      if (name === "tasks") {
        return { find: tasksFind, bulkWrite };
      }
      if (name === "people") {
        return { find: peopleFind };
      }
      throw new Error(`Unexpected collection in test: ${name}`);
    }),
  } as any;

  return { db, tasksFind, tasksLimit, bulkWrite, peopleFind };
};

describe("POST /api/tasks/priority/recompute", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 401 when there is no session user", async () => {
    mockedGetSessionUserId.mockResolvedValue(null as any);

    const response = await POST(buildRequest());

    expect(response.status).toBe(401);
    expect(mockedGetDb).not.toHaveBeenCalled();
  });

  it("recomputes priorities and bulk-writes only changed docs", async () => {
    mockedGetSessionUserId.mockResolvedValue("user-1");
    mockedResolveWorkspaceScopeForUser.mockResolvedValue({
      workspaceId: "workspace-1",
      workspace: null as any,
      membership: null as any,
      workspaceMemberUserIds: ["user-1", "user-2"],
    });

    const now = Date.now();
    // Overdue (+40) + explicit high (+20) + client assignee (+15) +
    // recent createdAt (+5) = 80 -> urgent. Stored score is stale.
    const changedTask = {
      _id: "task-a",
      title: "Ship the report",
      status: "todo",
      priority: "high",
      dueAt: new Date(now - DAY_MS).toISOString(),
      assignee: { uid: "client-1" },
      assigneeName: "Client One",
      createdAt: new Date(now - DAY_MS).toISOString(),
      priorityScore: 10,
      priorityLabel: "low",
    };
    // No signals -> score 0 / low, matching the stored values -> untouched.
    const unchangedTask = {
      _id: "task-b",
      title: "Someday idea",
      status: "todo",
      priority: "low",
      dueAt: null,
      createdAt: new Date(now - 30 * DAY_MS).toISOString(),
      lastUpdated: new Date(now - 30 * DAY_MS).toISOString(),
      priorityScore: 0,
      priorityLabel: "low",
    };

    const { db, tasksFind, tasksLimit, bulkWrite, peopleFind } = buildDb({
      tasks: [changedTask, unchangedTask],
      people: [{ _id: "client-1" }],
    });
    mockedGetDb.mockResolvedValue(db);

    const response = await POST(buildRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      updated: 1,
      byLabel: { low: 1, medium: 0, high: 0, urgent: 1 },
    });

    // Open-scope query: excludes done + archived, capped at 500 newest.
    expect(tasksFind).toHaveBeenCalledWith(
      expect.objectContaining({
        status: { $ne: "done" },
        taskState: { $ne: "archived" },
      }),
      expect.anything()
    );
    expect(tasksLimit).toHaveBeenCalledWith(500);

    // Client lookup is scoped and _id-only.
    expect(peopleFind).toHaveBeenCalledWith(
      expect.objectContaining({ personType: "client" }),
      { projection: { _id: 1 } }
    );

    // Only the changed doc is written, with all four priority fields.
    expect(bulkWrite).toHaveBeenCalledTimes(1);
    const [operations] = bulkWrite.mock.calls[0];
    expect(operations).toHaveLength(1);
    expect(operations[0].updateOne.filter).toEqual({ _id: "task-a" });
    expect(operations[0].updateOne.update.$set).toMatchObject({
      priorityScore: 80,
      priorityLabel: "urgent",
      priorityReason: expect.stringContaining("Overdue by 1 day"),
      priorityUpdatedAt: expect.any(String),
    });
  });

  it("does not call bulkWrite when nothing changed", async () => {
    mockedGetSessionUserId.mockResolvedValue("user-1");
    mockedResolveWorkspaceScopeForUser.mockResolvedValue({
      workspaceId: "workspace-1",
      workspace: null as any,
      membership: null as any,
      workspaceMemberUserIds: ["user-1"],
    });

    const { db, bulkWrite } = buildDb({
      tasks: [
        {
          _id: "task-b",
          title: "Someday idea",
          status: "todo",
          priority: "low",
          createdAt: new Date(Date.now() - 30 * DAY_MS).toISOString(),
          lastUpdated: new Date(Date.now() - 30 * DAY_MS).toISOString(),
          priorityScore: 0,
          priorityLabel: "low",
        },
      ],
      people: [],
    });
    mockedGetDb.mockResolvedValue(db);

    const response = await POST(buildRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      updated: 0,
      byLabel: { low: 1, medium: 0, high: 0, urgent: 0 },
    });
    expect(bulkWrite).not.toHaveBeenCalled();
  });
});
