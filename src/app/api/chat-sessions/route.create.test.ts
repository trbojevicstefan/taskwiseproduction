import { POST } from "@/app/api/chat-sessions/route";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { resolveWorkspaceScopeForUser } from "@/lib/workspace-scope";

jest.mock("@/lib/db", () => ({ getDb: jest.fn() }));
jest.mock("@/lib/server-auth", () => ({ getSessionUserId: jest.fn() }));
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

describe("POST /api/chat-sessions", () => {
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

  const createDb = (meeting: Record<string, unknown> | null = null) => {
    const insertOne = jest.fn().mockResolvedValue({ acknowledged: true });
    const meetingFindOne = jest.fn().mockResolvedValue(meeting);
    const db = {
      collection: jest.fn((name: string) => {
        if (name === "chatSessions") return { insertOne };
        if (name === "meetings") return { findOne: meetingFindOne };
        throw new Error(`Unexpected collection: ${name}`);
      }),
    } as any;
    return { db, insertOne, meetingFindOne };
  };

  it("normalizes a whitespace sourceMeetingId to null and workspace scope", async () => {
    const { db, insertOne, meetingFindOne } = createDb();
    mockedGetDb.mockResolvedValue(db);

    const response = await POST(
      new Request("http://localhost/api/chat-sessions", {
        method: "POST",
        body: JSON.stringify({ title: "Whitespace", sourceMeetingId: "   " }),
      })
    );

    expect(response.status).toBe(200);
    expect(insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceMeetingId: null,
        scope: { type: "workspace" },
      })
    );
    expect(meetingFindOne).not.toHaveBeenCalled();
  });

  it("validates a normalized non-empty meeting id and forces meeting scope", async () => {
    const { db, insertOne, meetingFindOne } = createDb({ _id: "meeting-1" });
    mockedGetDb.mockResolvedValue(db);

    const response = await POST(
      new Request("http://localhost/api/chat-sessions", {
        method: "POST",
        body: JSON.stringify({
          title: "Meeting",
          sourceMeetingId: " meeting-1 ",
          scope: { type: "workspace" },
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(meetingFindOne).toHaveBeenCalledWith({
      $and: [
        { $or: [{ _id: "meeting-1" }, { id: "meeting-1" }] },
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
    expect(insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceMeetingId: "meeting-1",
        scope: { type: "meeting", meetingId: "meeting-1" },
      })
    );
  });
});
