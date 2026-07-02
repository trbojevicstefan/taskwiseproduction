import { GET } from "@/app/api/tasks/route";
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
  resolveWorkspaceScopeForUser as jest.MockedFunction<typeof resolveWorkspaceScopeForUser>;

describe("GET /api/tasks pagination", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetSessionUserId.mockResolvedValue("user-1");
    mockedResolveWorkspaceScopeForUser.mockResolvedValue({
      workspaceId: "workspace-1",
      workspace: null as any,
      membership: null as any,
      workspaceMemberUserIds: ["user-1"],
    });
  });

  it("returns cursor-paginated tasks when paginate=1 is provided", async () => {
    const tasksToArray = jest.fn().mockResolvedValue([
      {
        _id: "task-3",
        userId: "user-1",
        title: "Newest",
        createdAt: new Date("2026-02-15T10:00:00.000Z"),
        lastUpdated: new Date("2026-02-15T10:00:00.000Z"),
      },
      {
        _id: "task-2",
        userId: "user-1",
        title: "Middle",
        createdAt: new Date("2026-02-15T09:00:00.000Z"),
        lastUpdated: new Date("2026-02-15T09:00:00.000Z"),
      },
      {
        _id: "task-1",
        userId: "user-1",
        title: "Oldest",
        createdAt: new Date("2026-02-15T08:00:00.000Z"),
        lastUpdated: new Date("2026-02-15T08:00:00.000Z"),
      },
    ]);
    const tasksLimit = jest.fn().mockReturnValue({ toArray: tasksToArray });
    const tasksSort = jest.fn().mockReturnValue({ limit: tasksLimit });
    const tasksProject = jest.fn().mockReturnValue({ sort: tasksSort });
    const tasksFind = jest.fn().mockReturnValue({ project: tasksProject });

    const db = {
      collection: jest.fn((name: string) => {
        if (name === "tasks") {
          return {
            find: tasksFind,
          };
        }
        throw new Error(`Unexpected collection in test: ${name}`);
      }),
    } as any;
    mockedGetDb.mockResolvedValue(db);

    const response = await GET(
      new Request("http://localhost/api/tasks?paginate=1&limit=2")
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({
      hasMore: true,
      data: [{ id: "task-3" }, { id: "task-2" }],
    });
    expect(typeof payload.nextCursor).toBe("string");
    expect(tasksLimit).toHaveBeenCalledWith(3);
  });

  it("applies a bounded legacy limit when paginate is not requested", async () => {
    const tasksToArray = jest.fn().mockResolvedValue([
      {
        _id: "task-1",
        userId: "user-1",
        title: "Task",
        createdAt: new Date("2026-02-15T08:00:00.000Z"),
        lastUpdated: new Date("2026-02-15T08:00:00.000Z"),
      },
    ]);
    const tasksLimit = jest.fn().mockReturnValue({ toArray: tasksToArray });
    const tasksSort = jest.fn().mockReturnValue({ limit: tasksLimit });
    const tasksProject = jest.fn().mockReturnValue({ sort: tasksSort });
    const tasksFind = jest.fn().mockReturnValue({ project: tasksProject });

    const db = {
      collection: jest.fn((name: string) => {
        if (name === "tasks") {
          return {
            find: tasksFind,
          };
        }
        throw new Error(`Unexpected collection in test: ${name}`);
      }),
    } as any;
    mockedGetDb.mockResolvedValue(db);

    const response = await GET(new Request("http://localhost/api/tasks"));

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(Array.isArray(payload)).toBe(true);
    expect(tasksLimit).toHaveBeenCalledWith(500);
  });
});
