import { GET } from "@/app/api/chat-sessions/route";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";

jest.mock("@/lib/db", () => ({
  getDb: jest.fn(),
}));

jest.mock("@/lib/server-auth", () => ({
  getSessionUserId: jest.fn(),
}));

jest.mock("@/lib/observability-metrics", () => ({
  recordRouteMetric: jest.fn(),
}));

jest.mock("@/lib/task-hydration", () => ({
  hydrateTaskReferenceLists: jest.fn().mockImplementation(
    async (_userId: string, taskLists: any[]) => taskLists
  ),
}));

const mockedGetDb = getDb as jest.MockedFunction<typeof getDb>;
const mockedGetSessionUserId = getSessionUserId as jest.MockedFunction<
  typeof getSessionUserId
>;

describe("GET /api/chat-sessions pagination", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetSessionUserId.mockResolvedValue("user-1");
  });

  const createDbMock = (sessionsFind: jest.Mock) =>
    ({
      collection: jest.fn((name: string) => {
        if (name === "chatSessions") {
          return { find: sessionsFind };
        }
        if (name === "users") {
          return {
            findOne: jest.fn().mockResolvedValue({
              id: "user-1",
              name: "User One",
              email: "user-1@example.com",
              activeWorkspaceId: "workspace-1",
              workspace: { id: "workspace-1", name: "Workspace One" },
            }),
            updateOne: jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 0 }),
          };
        }
        if (name === "workspaces") {
          return {
            findOne: jest.fn().mockResolvedValue({
              _id: "workspace-1",
              name: "Workspace One",
              status: "active",
              settings: null,
            }),
          };
        }
        if (name === "workspaceMemberships") {
          return {
            findOne: jest.fn().mockResolvedValue({
              _id: "membership-1",
              workspaceId: "workspace-1",
              userId: "user-1",
              role: "owner",
              status: "active",
            }),
            find: jest.fn().mockReturnValue({
              sort: jest.fn().mockReturnValue({
                toArray: jest.fn().mockResolvedValue([
                  {
                    _id: "membership-1",
                    workspaceId: "workspace-1",
                    userId: "user-1",
                    role: "owner",
                    status: "active",
                  },
                ]),
              }),
            }),
          };
        }
        throw new Error(`Unexpected collection in test: ${name}`);
      }),
    }) as any;

  it("returns cursor-paginated chat sessions when paginate=1 is provided", async () => {
    const sessionsToArray = jest.fn().mockResolvedValue([
      {
        _id: "session-3",
        userId: "user-1",
        title: "Newest",
        suggestedTasks: [],
        createdAt: new Date("2026-02-15T10:00:00.000Z"),
        lastActivityAt: new Date("2026-02-15T10:00:00.000Z"),
      },
      {
        _id: "session-2",
        userId: "user-1",
        title: "Middle",
        suggestedTasks: [],
        createdAt: new Date("2026-02-15T09:00:00.000Z"),
        lastActivityAt: new Date("2026-02-15T09:00:00.000Z"),
      },
      {
        _id: "session-1",
        userId: "user-1",
        title: "Oldest",
        suggestedTasks: [],
        createdAt: new Date("2026-02-15T08:00:00.000Z"),
        lastActivityAt: new Date("2026-02-15T08:00:00.000Z"),
      },
    ]);
    const sessionsLimit = jest.fn().mockReturnValue({ toArray: sessionsToArray });
    const sessionsSort = jest.fn().mockReturnValue({ limit: sessionsLimit });
    const sessionsFind = jest.fn().mockReturnValue({ sort: sessionsSort });

    const db = createDbMock(sessionsFind);
    mockedGetDb.mockResolvedValue(db);

    const response = await GET(
      new Request("http://localhost/api/chat-sessions?paginate=1&limit=2")
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({
      hasMore: true,
      data: [{ id: "session-3" }, { id: "session-2" }],
    });
    expect(typeof payload.nextCursor).toBe("string");
    expect(sessionsLimit).toHaveBeenCalledWith(3);
  });

  it("applies a bounded legacy limit when paginate is not requested", async () => {
    const sessionsToArray = jest.fn().mockResolvedValue([
      {
        _id: "session-1",
        userId: "user-1",
        title: "Only",
        suggestedTasks: [],
        createdAt: new Date("2026-02-15T10:00:00.000Z"),
        lastActivityAt: new Date("2026-02-15T10:00:00.000Z"),
      },
    ]);
    const sessionsLimit = jest.fn().mockReturnValue({ toArray: sessionsToArray });
    const sessionsSort = jest.fn().mockReturnValue({ limit: sessionsLimit });
    const sessionsFind = jest.fn().mockReturnValue({ sort: sessionsSort });

    const db = createDbMock(sessionsFind);
    mockedGetDb.mockResolvedValue(db);

    const response = await GET(new Request("http://localhost/api/chat-sessions"));

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(Array.isArray(payload)).toBe(true);
    expect(sessionsLimit).toHaveBeenCalledWith(500);
  });
});
