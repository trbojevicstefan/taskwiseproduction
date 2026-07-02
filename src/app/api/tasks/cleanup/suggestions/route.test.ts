import { GET } from "@/app/api/tasks/cleanup/suggestions/route";
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

const buildFindChain = (docs: any[]) => {
  const toArray = jest.fn().mockResolvedValue(docs);
  const limit = jest.fn().mockReturnValue({ toArray });
  const sort = jest.fn().mockReturnValue({ limit });
  const project = jest.fn().mockReturnValue({ sort });
  return { project, sort, limit, toArray };
};

describe("GET /api/tasks/cleanup/suggestions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetSessionUserId.mockResolvedValue("user-1");
    mockedResolveWorkspaceScopeForUser.mockResolvedValue({
      workspaceId: "workspace-1",
      workspace: null as any,
      membership: null as any,
      workspaceMemberUserIds: ["user-1", "user-2"],
    });
  });

  it("returns 401 when there is no session user", async () => {
    mockedGetSessionUserId.mockResolvedValue(null as any);

    const response = await GET(
      new Request("http://localhost/api/tasks/cleanup/suggestions")
    );

    expect(response.status).toBe(401);
  });

  it("returns suggested and expired buckets scoped to the workspace", async () => {
    const suggestionChain = buildFindChain([
      {
        _id: "task-1",
        title: "Send meeting invite",
        cleanupStatus: "suggested_expire",
        lastUpdated: new Date("2026-06-30T10:00:00.000Z"),
        createdAt: new Date("2026-06-01T10:00:00.000Z"),
      },
    ]);
    const expiredChain = buildFindChain([
      {
        _id: "task-2",
        title: "Book the meeting room",
        cleanupStatus: "expired",
        lastUpdated: new Date("2026-06-20T10:00:00.000Z"),
        createdAt: new Date("2026-05-01T10:00:00.000Z"),
      },
    ]);

    const chains = [suggestionChain, expiredChain];
    const filters: any[] = [];
    const find = jest.fn().mockImplementation((filter: any) => {
      filters.push(filter);
      const chain = chains.shift()!;
      return { project: chain.project };
    });

    const db = {
      collection: jest.fn((name: string) => {
        if (name === "tasks") {
          return { find };
        }
        throw new Error(`Unexpected collection in test: ${name}`);
      }),
    } as any;
    mockedGetDb.mockResolvedValue(db);

    const response = await GET(
      new Request("http://localhost/api/tasks/cleanup/suggestions")
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.ok).toBe(true);
    expect(payload.suggestions).toHaveLength(1);
    expect(payload.suggestions[0]).toMatchObject({
      id: "task-1",
      cleanupStatus: "suggested_expire",
    });
    expect(payload.expired).toHaveLength(1);
    expect(payload.expired[0]).toMatchObject({
      id: "task-2",
      cleanupStatus: "expired",
    });

    // Suggestions bucket: only suggested_* statuses, workspace-fallback scope.
    expect(filters[0]).toEqual({
      $or: [
        { workspaceId: "workspace-1" },
        {
          workspaceId: { $exists: false },
          userId: { $in: ["user-1", "user-2"] },
        },
      ],
      cleanupStatus: {
        $in: ["suggested_expire", "duplicate_suggested", "completed_suggested"],
      },
    });
    // Expired bucket has the same scope filter.
    expect(filters[1]).toEqual({
      $or: [
        { workspaceId: "workspace-1" },
        {
          workspaceId: { $exists: false },
          userId: { $in: ["user-1", "user-2"] },
        },
      ],
      cleanupStatus: "expired",
    });

    // Newest first, capped at 100 each.
    expect(suggestionChain.sort).toHaveBeenCalledWith({
      lastUpdated: -1,
      _id: -1,
    });
    expect(suggestionChain.limit).toHaveBeenCalledWith(100);
    expect(expiredChain.limit).toHaveBeenCalledWith(100);
  });
});
