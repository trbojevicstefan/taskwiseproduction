import { POST } from "@/app/api/tasks/cleanup/scan/route";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { runTaskCleanupScan } from "@/lib/task-cleanup";
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

jest.mock("@/lib/task-cleanup", () => ({
  runTaskCleanupScan: jest.fn(),
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
const mockedRunTaskCleanupScan = runTaskCleanupScan as jest.MockedFunction<
  typeof runTaskCleanupScan
>;

const buildRequest = () =>
  new Request("http://localhost/api/tasks/cleanup/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });

describe("POST /api/tasks/cleanup/scan", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 401 when there is no session user", async () => {
    mockedGetSessionUserId.mockResolvedValue(null as any);

    const response = await POST(buildRequest());

    expect(response.status).toBe(401);
    expect(mockedRunTaskCleanupScan).not.toHaveBeenCalled();
  });

  it("runs the cleanup scan with workspace scope and resolved settings", async () => {
    mockedGetSessionUserId.mockResolvedValue("user-1");
    const db = { collection: jest.fn() } as any;
    mockedGetDb.mockResolvedValue(db);
    mockedResolveWorkspaceScopeForUser.mockResolvedValue({
      workspaceId: "workspace-1",
      workspace: {
        _id: "workspace-1",
        settings: {
          taskCleanup: {
            strictness: "aggressive",
            autoExpireDays: 7,
            categories: { duplicate: false },
          },
        },
      } as any,
      membership: null as any,
      workspaceMemberUserIds: ["user-1", "user-2"],
    });
    mockedRunTaskCleanupScan.mockResolvedValue({
      scanned: 12,
      flagged: 3,
      expired: 1,
      byCategory: { scheduling_admin: 2, stale_follow_up: 1 },
    });

    const response = await POST(buildRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      scanned: 12,
      flagged: 3,
      expired: 1,
      byCategory: { scheduling_admin: 2, stale_follow_up: 1 },
    });

    expect(mockedResolveWorkspaceScopeForUser).toHaveBeenCalledWith(
      db,
      "user-1",
      expect.objectContaining({
        minimumRole: "member",
        includeMemberUserIds: true,
      })
    );
    expect(mockedRunTaskCleanupScan).toHaveBeenCalledTimes(1);
    const [scanDb, scope, settings] = mockedRunTaskCleanupScan.mock.calls[0];
    expect(scanDb).toBe(db);
    expect(scope).toEqual({
      userId: "user-1",
      workspaceId: "workspace-1",
      memberUserIds: ["user-1", "user-2"],
    });
    // Settings resolved from the workspace doc with defaults filled in.
    expect(settings).toMatchObject({
      enabled: true,
      strictness: "aggressive",
      autoExpireDays: 7,
    });
    expect(settings.categories).toMatchObject({
      duplicate: false,
      scheduling_admin: true,
      meeting_logistics: true,
    });
  });
});
