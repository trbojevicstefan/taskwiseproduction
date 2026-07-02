import { GET, PATCH } from "@/app/api/meetings/[id]/route";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { assertWorkspaceAccess, ensureWorkspaceBootstrapForUser } from "@/lib/workspace-context";

jest.mock("@/lib/db", () => ({
  getDb: jest.fn(),
}));

jest.mock("@/lib/server-auth", () => ({
  getSessionUserId: jest.fn(),
}));

jest.mock("@/lib/workspace-context", () => ({
  assertWorkspaceAccess: jest.fn(),
  ensureWorkspaceBootstrapForUser: jest.fn(),
}));

jest.mock("@/lib/task-hydration", () => ({
  hydrateTaskReferenceLists: jest.fn().mockImplementation(async (_userId: string, lists: any[]) => lists),
}));

const mockedGetDb = getDb as jest.MockedFunction<typeof getDb>;
const mockedGetSessionUserId = getSessionUserId as jest.MockedFunction<
  typeof getSessionUserId
>;
const mockedEnsureWorkspaceBootstrapForUser =
  ensureWorkspaceBootstrapForUser as jest.MockedFunction<
    typeof ensureWorkspaceBootstrapForUser
  >;
const mockedAssertWorkspaceAccess = assertWorkspaceAccess as jest.MockedFunction<
  typeof assertWorkspaceAccess
>;

describe("GET /api/meetings/[id] workspace access", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetSessionUserId.mockResolvedValue("user-2");
    mockedEnsureWorkspaceBootstrapForUser.mockResolvedValue(null as any);
    mockedAssertWorkspaceAccess.mockResolvedValue({
      workspace: { _id: "workspace-1", name: "Workspace 1" },
      membership: { role: "member", status: "active" },
    } as any);
  });

  it("returns workspace-scoped meeting for invited member", async () => {
    const db = {
      collection: jest.fn((name: string) => {
        if (name === "meetings") {
          return {
            findOne: jest.fn().mockResolvedValue({
              _id: "meeting-1",
              userId: "owner-1",
              workspaceId: "workspace-1",
              title: "Shared Meeting",
              extractedTasks: [],
              createdAt: new Date("2026-02-18T00:00:00.000Z"),
              lastActivityAt: new Date("2026-02-18T00:00:00.000Z"),
            }),
          };
        }
        throw new Error(`Unexpected collection ${name}`);
      }),
    } as any;
    mockedGetDb.mockResolvedValue(db);

    const response = await GET(new Request("http://localhost/api/meetings/meeting-1"), {
      params: Promise.resolve({ id: "meeting-1" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      id: "meeting-1",
      workspaceId: "workspace-1",
      userId: "owner-1",
    });
    expect(mockedAssertWorkspaceAccess).toHaveBeenCalledWith(
      db,
      "user-2",
      "workspace-1",
      "member"
    );
  });
});

describe("PATCH /api/meetings/[id] workspace access", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetSessionUserId.mockResolvedValue("user-2");
    mockedEnsureWorkspaceBootstrapForUser.mockResolvedValue(null as any);
    mockedAssertWorkspaceAccess.mockResolvedValue({
      workspace: { _id: "workspace-1", name: "Workspace 1" },
      membership: { role: "member", status: "active" },
    } as any);
  });

  it("updates a workspace-scoped meeting for invited member", async () => {
    const initialMeeting = {
      _id: "meeting-1",
      userId: "owner-1",
      workspaceId: "workspace-1",
      title: "Shared Meeting",
      extractedTasks: [],
      createdAt: new Date("2026-02-18T00:00:00.000Z"),
      lastActivityAt: new Date("2026-02-18T00:00:00.000Z"),
    };
    const updatedMeeting = {
      ...initialMeeting,
      fathomNotificationReadAt: "2026-02-18T01:00:00.000Z",
    };
    const findOne = jest
      .fn()
      .mockResolvedValueOnce(initialMeeting)
      .mockResolvedValueOnce(updatedMeeting);
    const updateOne = jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    const db = {
      collection: jest.fn((name: string) => {
        if (name === "meetings") {
          return {
            findOne,
            updateOne,
          };
        }
        throw new Error(`Unexpected collection ${name}`);
      }),
    } as any;
    mockedGetDb.mockResolvedValue(db);

    const response = await PATCH(
      new Request("http://localhost/api/meetings/meeting-1", {
        method: "PATCH",
        body: JSON.stringify({
          fathomNotificationReadAt: "2026-02-18T01:00:00.000Z",
        }),
      }),
      {
        params: Promise.resolve({ id: "meeting-1" }),
      }
    );

    expect(response.status).toBe(200);
    expect(updateOne).toHaveBeenCalledWith(
      { _id: "meeting-1" },
      { $set: { fathomNotificationReadAt: "2026-02-18T01:00:00.000Z" } }
    );
    expect(mockedAssertWorkspaceAccess).toHaveBeenCalledWith(
      db,
      "user-2",
      "workspace-1",
      "member"
    );
    await expect(response.json()).resolves.toMatchObject({
      id: "meeting-1",
      workspaceId: "workspace-1",
      userId: "owner-1",
      fathomNotificationReadAt: "2026-02-18T01:00:00.000Z",
    });
  });

  it("returns 404 when workspace access is denied", async () => {
    mockedAssertWorkspaceAccess.mockRejectedValueOnce(new Error("Forbidden"));

    const findOne = jest.fn().mockResolvedValue({
      _id: "meeting-1",
      userId: "owner-1",
      workspaceId: "workspace-1",
      title: "Shared Meeting",
      extractedTasks: [],
      createdAt: new Date("2026-02-18T00:00:00.000Z"),
      lastActivityAt: new Date("2026-02-18T00:00:00.000Z"),
    });
    const updateOne = jest.fn();
    const db = {
      collection: jest.fn((name: string) => {
        if (name === "meetings") {
          return {
            findOne,
            updateOne,
          };
        }
        throw new Error(`Unexpected collection ${name}`);
      }),
    } as any;
    mockedGetDb.mockResolvedValue(db);

    const response = await PATCH(
      new Request("http://localhost/api/meetings/meeting-1", {
        method: "PATCH",
        body: JSON.stringify({ title: "Updated title" }),
      }),
      {
        params: Promise.resolve({ id: "meeting-1" }),
      }
    );

    expect(response.status).toBe(404);
    expect(updateOne).not.toHaveBeenCalled();
  });
});
