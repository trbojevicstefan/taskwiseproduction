import { PATCH } from "@/app/api/chat-sessions/[id]/route";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { resolveWorkspaceScopeForUser } from "@/lib/workspace-scope";

jest.mock("@/lib/db", () => ({ getDb: jest.fn() }));
jest.mock("@/lib/server-auth", () => ({ getSessionUserId: jest.fn() }));
jest.mock("@/lib/workspace-scope", () => ({
  resolveWorkspaceScopeForUser: jest.fn(),
}));
jest.mock("@/lib/task-sync", () => ({ syncTasksForSource: jest.fn() }));

const mockedGetDb = getDb as jest.MockedFunction<typeof getDb>;
const mockedGetSessionUserId = getSessionUserId as jest.MockedFunction<
  typeof getSessionUserId
>;
const mockedResolveWorkspaceScopeForUser =
  resolveWorkspaceScopeForUser as jest.MockedFunction<
    typeof resolveWorkspaceScopeForUser
  >;

describe("PATCH /api/chat-sessions/[id]", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetSessionUserId.mockResolvedValue("user-1");
    mockedResolveWorkspaceScopeForUser.mockResolvedValue({
      workspaceId: "workspace-1",
      workspace: {} as any,
      membership: {} as any,
      workspaceMemberUserIds: ["user-1", "user-2"],
    });
  });

  it("queries the session through the server-derived active workspace and member visibility", async () => {
    const scopedSession = {
      _id: "session-1",
      userId: "user-2",
      workspaceId: "workspace-1",
      title: "Existing",
      messages: [],
      suggestedTasks: [],
      createdAt: new Date("2026-08-11T10:00:00.000Z"),
      lastActivityAt: new Date("2026-08-11T10:00:00.000Z"),
    };
    const findOne = jest
      .fn()
      .mockResolvedValueOnce(scopedSession)
      .mockResolvedValueOnce({ ...scopedSession, title: "Updated" });
    const updateOne = jest.fn().mockResolvedValue({ matchedCount: 1 });
    const db = {
      collection: jest.fn((name: string) => {
        if (name === "chatSessions") return { findOne, updateOne };
        throw new Error(`Unexpected collection: ${name}`);
      }),
    } as any;
    mockedGetDb.mockResolvedValue(db);

    const response = await PATCH(
      new Request("http://localhost/api/chat-sessions/session-1", {
        method: "PATCH",
        body: JSON.stringify({ title: "Updated" }),
      }),
      { params: Promise.resolve({ id: "session-1" }) }
    );

    expect(response.status).toBe(200);
    expect(mockedResolveWorkspaceScopeForUser).toHaveBeenCalledWith(
      db,
      "user-1",
      {
        minimumRole: "member",
        adminVisibilityKey: "chatSessions",
        includeMemberUserIds: true,
      }
    );
    expect(findOne).toHaveBeenCalledWith({
      $and: [
        { $or: [{ _id: "session-1" }, { id: "session-1" }] },
        {
          $or: [
            { workspaceId: "workspace-1" },
            {
              workspaceId: { $exists: false },
              userId: { $in: ["user-1", "user-2"] },
            },
          ],
        },
      ],
    });
  });

  it("rejects an invalid meeting linkage before querying the session", async () => {
    const db = { collection: jest.fn() } as any;
    mockedGetDb.mockResolvedValue(db);

    const response = await PATCH(
      new Request("http://localhost/api/chat-sessions/session-1", {
        method: "PATCH",
        body: JSON.stringify({ sourceMeetingId: { unsafe: true } }),
      }),
      { params: Promise.resolve({ id: "session-1" }) }
    );

    expect(response.status).toBe(400);
    expect(db.collection).not.toHaveBeenCalled();
  });
});
