import { GET } from "@/app/api/slack/reminders/route";
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

jest.mock("@/lib/task-reminders", () => ({
  TASK_REMINDERS_COLLECTION: "taskReminders",
  serializeTaskReminder: jest.fn((doc: any) => ({
    id: doc._id,
    taskId: doc.taskId,
    kind: doc.kind,
    status: doc.status,
    runAt: doc.runAt instanceof Date ? doc.runAt.toISOString() : doc.runAt,
    taskTitle: doc.taskTitle,
  })),
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

const buildDb = (reminders: any[]) => {
  const toArray = jest.fn().mockResolvedValue(reminders);
  const limit = jest.fn().mockReturnValue({ toArray });
  const sort = jest.fn().mockReturnValue({ limit });
  const find = jest.fn().mockReturnValue({ sort });
  const db = {
    collection: jest.fn((name: string) => {
      if (name === "taskReminders") return { find };
      throw new Error(`Unexpected collection in test: ${name}`);
    }),
  } as any;
  return { db, find, sort, limit, toArray };
};

const requestFor = (query = "") =>
  new Request(`http://localhost/api/slack/reminders${query}`);

describe("GET /api/slack/reminders", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetSessionUserId.mockResolvedValue("user-1");
    mockedResolveWorkspaceScopeForUser.mockResolvedValue({
      workspaceId: "workspace-1",
      workspace: null as any,
      membership: null as any,
      workspaceMemberUserIds: ["user-1"],
    } as any);
  });

  it("returns 401 when there is no session user", async () => {
    mockedGetSessionUserId.mockResolvedValue(null as any);

    const response = await GET(requestFor());

    expect(response.status).toBe(401);
    expect(mockedGetDb).not.toHaveBeenCalled();
  });

  it("returns 400 for an unknown status value", async () => {
    const response = await GET(requestFor("?status=bogus"));

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.ok).toBe(false);
    expect(payload.errorCode).toBe("request_error");
    expect(mockedGetDb).not.toHaveBeenCalled();
  });

  it("filters by taskId (all statuses) when taskId is provided", async () => {
    const { db, find } = buildDb([
      {
        _id: "rem-1",
        taskId: "task-1",
        kind: "on_due",
        status: "sent",
        runAt: new Date("2026-07-04T09:00:00.000Z"),
        taskTitle: "Send proposal",
      },
    ]);
    mockedGetDb.mockResolvedValue(db);

    const response = await GET(requestFor("?taskId=task-1"));

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.ok).toBe(true);
    expect(payload.reminders).toEqual([
      {
        id: "rem-1",
        taskId: "task-1",
        kind: "on_due",
        status: "sent",
        runAt: "2026-07-04T09:00:00.000Z",
        taskTitle: "Send proposal",
      },
    ]);
    // taskId scope: no implicit status filter.
    expect(find).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      taskId: "task-1",
    });
  });

  it("combines taskId and status filters", async () => {
    const { db, find } = buildDb([]);
    mockedGetDb.mockResolvedValue(db);

    const response = await GET(requestFor("?taskId=task-1&status=canceled"));

    expect(response.status).toBe(200);
    expect(find).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      taskId: "task-1",
      status: "canceled",
    });
  });

  it("returns the workspace's upcoming scheduled reminders capped at 100 without taskId", async () => {
    const { db, find, sort, limit } = buildDb([
      {
        _id: "rem-2",
        taskId: "task-2",
        kind: "before_due",
        status: "scheduled",
        runAt: new Date("2026-07-05T09:00:00.000Z"),
        taskTitle: "Prepare deck",
      },
    ]);
    mockedGetDb.mockResolvedValue(db);

    const response = await GET(requestFor());

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.reminders).toHaveLength(1);
    expect(payload.reminders[0]).toMatchObject({
      id: "rem-2",
      status: "scheduled",
    });
    expect(find).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      status: "scheduled",
    });
    expect(sort).toHaveBeenCalledWith({ runAt: 1, _id: 1 });
    expect(limit).toHaveBeenCalledWith(100);
    expect(mockedResolveWorkspaceScopeForUser).toHaveBeenCalledWith(
      db,
      "user-1",
      expect.objectContaining({ minimumRole: "member" })
    );
  });
});
