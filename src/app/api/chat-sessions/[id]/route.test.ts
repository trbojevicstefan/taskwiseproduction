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
        if (name === "meetings") {
          return { findOne: jest.fn().mockResolvedValue({ _id: "meeting-1" }) };
        }
        if (name === "tasks") {
          return { deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 }) };
        }
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
    const persistedUpdate = updateOne.mock.calls[0][1].$set;
    expect(persistedUpdate).not.toHaveProperty("scope");
    expect(persistedUpdate).not.toHaveProperty("sourceMeetingId");
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

  it("rejects a scope swap before looking up the requested entity", async () => {
    const scopedSession = {
      _id: "session-1",
      userId: "user-1",
      workspaceId: "workspace-1",
      title: "Existing",
      messages: [],
      suggestedTasks: [],
    };
    const chatFindOne = jest.fn().mockResolvedValue(scopedSession);
    const chatUpdateOne = jest.fn();
    const meetingFindOne = jest.fn().mockResolvedValue(null);
    const db = {
      collection: jest.fn((name: string) => {
        if (name === "chatSessions") {
          return { findOne: chatFindOne, updateOne: chatUpdateOne };
        }
        if (name === "meetings") return { findOne: meetingFindOne };
        throw new Error(`Unexpected collection: ${name}`);
      }),
    } as any;
    mockedGetDb.mockResolvedValue(db);

    const response = await PATCH(
      new Request("http://localhost/api/chat-sessions/session-1", {
        method: "PATCH",
        headers: { "x-correlation-id": "correlation-scope-test" },
        body: JSON.stringify({
          scope: { type: "meeting", meetingId: "meeting-other" },
        }),
      }),
      { params: Promise.resolve({ id: "session-1" }) }
    );

    expect(response.status).toBe(409);
    expect(response.headers.get("x-correlation-id")).toBe(
      "correlation-scope-test"
    );
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "Chat session scope cannot be changed.",
      errorCode: "chat_scope_immutable",
    });
    expect(meetingFindOne).not.toHaveBeenCalled();
    expect(chatUpdateOne).not.toHaveBeenCalled();
  });

  it.each([
    [
      "workspace to planner",
      { sourceMeetingId: null, scope: { type: "workspace" } },
      { scope: { type: "planner" } },
    ],
    [
      "planner to workspace",
      { sourceMeetingId: null, scope: { type: "planner" } },
      { scope: { type: "workspace" } },
    ],
    [
      "client to person",
      {
        sourceMeetingId: null,
        scope: { type: "client", clientId: "client-1" },
      },
      { scope: { type: "person", personId: "person-1" } },
    ],
    [
      "person to client",
      {
        sourceMeetingId: null,
        scope: { type: "person", personId: "person-1" },
      },
      { scope: { type: "client", clientId: "client-1" } },
    ],
    [
      "meeting source to another meeting",
      {
        sourceMeetingId: "meeting-1",
        scope: { type: "meeting", meetingId: "meeting-1" },
      },
      { sourceMeetingId: "meeting-2" },
    ],
    [
      "meeting scope to workspace",
      {
        sourceMeetingId: "meeting-1",
        scope: { type: "meeting", meetingId: "meeting-1" },
      },
      { scope: { type: "workspace" } },
    ],
  ])("rejects immutable scope mutation: %s", async (_label, persisted, patch) => {
    const current = {
      _id: "session-1",
      userId: "user-1",
      workspaceId: "workspace-1",
      title: "Existing",
      messages: [],
      suggestedTasks: [],
      ...persisted,
    };
    const findOne = jest.fn().mockResolvedValue(current);
    const updateOne = jest.fn();
    const db = {
      collection: jest.fn((name: string) => {
        if (name === "chatSessions") return { findOne, updateOne };
        if (name === "meetings") {
          return { findOne: jest.fn().mockResolvedValue({ _id: "meeting-1" }) };
        }
        throw new Error(`Unexpected collection: ${name}`);
      }),
    } as any;
    mockedGetDb.mockResolvedValue(db);

    const response = await PATCH(
      new Request("http://localhost/api/chat-sessions/session-1", {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
      { params: Promise.resolve({ id: "session-1" }) }
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      errorCode: "chat_scope_immutable",
    });
    expect(updateOne).not.toHaveBeenCalled();
  });

  it("accepts exact immutable values without rewriting them", async () => {
    const current = {
      _id: "session-1",
      userId: "user-1",
      workspaceId: "workspace-1",
      title: "Existing",
      messages: [],
      suggestedTasks: [],
      sourceMeetingId: "meeting-1",
      scope: { type: "meeting", meetingId: "meeting-1" },
    };
    const findOne = jest
      .fn()
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce({ ...current, title: "Updated" });
    const updateOne = jest.fn().mockResolvedValue({ matchedCount: 1 });
    const db = {
      collection: jest.fn((name: string) => {
        if (name === "chatSessions") return { findOne, updateOne };
        if (name === "meetings") {
          return { findOne: jest.fn().mockResolvedValue({ _id: "meeting-1" }) };
        }
        if (name === "tasks") {
          return { deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 }) };
        }
        throw new Error(`Unexpected collection: ${name}`);
      }),
    } as any;
    mockedGetDb.mockResolvedValue(db);

    const response = await PATCH(
      new Request("http://localhost/api/chat-sessions/session-1", {
        method: "PATCH",
        body: JSON.stringify({
          title: "Updated",
          sourceMeetingId: "meeting-1",
          scope: { type: "meeting", meetingId: "meeting-1" },
        }),
      }),
      { params: Promise.resolve({ id: "session-1" }) }
    );

    expect(response.status).toBe(200);
    const persistedUpdate = updateOne.mock.calls[0][1].$set;
    expect(persistedUpdate).not.toHaveProperty("sourceMeetingId");
    expect(persistedUpdate).not.toHaveProperty("scope");
  });
});
