import { GET, POST } from "@/app/api/meetings/route";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { runMeetingIngestionCommand } from "@/lib/services/meeting-ingestion-command";
import { getWorkspaceIdForUser } from "@/lib/workspace";
import { assertWorkspaceAccess, ensureWorkspaceBootstrapForUser } from "@/lib/workspace-context";

jest.mock("@/lib/db", () => ({
  getDb: jest.fn(),
}));

jest.mock("@/lib/server-auth", () => ({
  getSessionUserId: jest.fn(),
}));

jest.mock("@/lib/services/meeting-ingestion-command", () => ({
  runMeetingIngestionCommand: jest.fn(),
}));

jest.mock("@/lib/workspace", () => ({
  getWorkspaceIdForUser: jest.fn(),
}));

jest.mock("@/lib/workspace-context", () => ({
  assertWorkspaceAccess: jest.fn(),
  ensureWorkspaceBootstrapForUser: jest.fn(),
}));

jest.mock("@/lib/observability-metrics", () => ({
  recordRouteMetric: jest.fn(),
}));

jest.mock("@/lib/slack-automation", () => ({
  postMeetingAutomationToSlack: jest.fn(),
}));

jest.mock("@/lib/task-completion", () => ({
  applyCompletionTargets: jest.fn(),
  buildCompletionSuggestions: jest.fn().mockResolvedValue([]),
  mergeCompletionSuggestions: jest.fn((tasks: any[]) => tasks),
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
const mockedRunMeetingIngestionCommand =
  runMeetingIngestionCommand as jest.MockedFunction<
    typeof runMeetingIngestionCommand
  >;
const mockedGetWorkspaceIdForUser =
  getWorkspaceIdForUser as jest.MockedFunction<typeof getWorkspaceIdForUser>;
const mockedEnsureWorkspaceBootstrapForUser =
  ensureWorkspaceBootstrapForUser as jest.MockedFunction<
    typeof ensureWorkspaceBootstrapForUser
  >;
const mockedAssertWorkspaceAccess =
  assertWorkspaceAccess as jest.MockedFunction<typeof assertWorkspaceAccess>;

describe("POST /api/meetings ingestion parity", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetSessionUserId.mockResolvedValue("user-1");
    mockedGetWorkspaceIdForUser.mockResolvedValue("workspace-1");
    mockedEnsureWorkspaceBootstrapForUser.mockResolvedValue(null as any);
    mockedAssertWorkspaceAccess.mockResolvedValue({
      workspace: { _id: "workspace-1", name: "Workspace 1" },
      membership: { role: "member", status: "active" },
    } as any);
    mockedRunMeetingIngestionCommand.mockResolvedValue({
      people: { created: 0, updated: 0 },
      tasks: { upserted: 0, deleted: 0 },
      boardItemsCreated: 0,
    });
  });

  it("sends canonical meeting-ingested payload into shared ingestion command", async () => {
    const usersFindOne = jest.fn().mockResolvedValue({
      _id: "user-1",
      autoApproveCompletedTasks: false,
    });
    const meetingsInsertOne = jest.fn().mockResolvedValue({ acknowledged: true });

    const db = {
      collection: jest.fn((name: string) => {
        if (name === "users") {
          return { findOne: usersFindOne };
        }
        if (name === "meetings") {
          return { insertOne: meetingsInsertOne };
        }
        throw new Error(`Unexpected collection in test: ${name}`);
      }),
    } as any;
    mockedGetDb.mockResolvedValue(db);

    const request = new Request("http://localhost/api/meetings", {
      method: "POST",
      body: JSON.stringify({
        title: "Sprint Planning",
        summary: "Discussed roadmap",
        attendees: [{ name: "Jane Doe", email: "jane@example.com" }],
        extractedTasks: [{ id: "task-1", title: "Prepare deck", priority: "medium" }],
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(mockedRunMeetingIngestionCommand).toHaveBeenCalledTimes(1);
    expect(mockedRunMeetingIngestionCommand).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        mode: "always-event",
        userId: "user-1",
        payload: expect.objectContaining({
          meetingId: expect.any(String),
          workspaceId: "workspace-1",
          title: "Sprint Planning",
          attendees: [{ name: "Jane Doe", email: "jane@example.com" }],
          extractedTasks: [{ id: "task-1", title: "Prepare deck", priority: "medium" }],
        }),
      })
    );
  });

  it("supports cursor pagination for meetings list without breaking default response mode", async () => {
    const meetingsToArray = jest.fn().mockResolvedValue([
      {
        _id: "meeting-3",
        userId: "user-1",
        title: "Newest",
        extractedTasks: [],
        createdAt: new Date("2026-02-15T10:00:00.000Z"),
        lastActivityAt: new Date("2026-02-15T10:00:00.000Z"),
      },
      {
        _id: "meeting-2",
        userId: "user-1",
        title: "Middle",
        extractedTasks: [],
        createdAt: new Date("2026-02-15T09:00:00.000Z"),
        lastActivityAt: new Date("2026-02-15T09:00:00.000Z"),
      },
      {
        _id: "meeting-1",
        userId: "user-1",
        title: "Oldest",
        extractedTasks: [],
        createdAt: new Date("2026-02-15T08:00:00.000Z"),
        lastActivityAt: new Date("2026-02-15T08:00:00.000Z"),
      },
    ]);
    const meetingsLimit = jest.fn().mockReturnValue({ toArray: meetingsToArray });
    const meetingsSort = jest.fn().mockReturnValue({ limit: meetingsLimit });
    const meetingsFind = jest.fn().mockReturnValue({ sort: meetingsSort });

    const db = {
      collection: jest.fn((name: string) => {
        if (name === "meetings") {
          return { find: meetingsFind };
        }
        throw new Error(`Unexpected collection in test: ${name}`);
      }),
    } as any;
    mockedGetDb.mockResolvedValue(db);

    const response = await GET(
      new Request("http://localhost/api/meetings?paginate=1&limit=2")
    );
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({
      hasMore: true,
      data: [{ id: "meeting-3" }, { id: "meeting-2" }],
    });
    expect(typeof payload.nextCursor).toBe("string");
    expect(meetingsLimit).toHaveBeenCalledWith(3);
  });

  it("applies a bounded legacy limit for non-paginated meeting lists", async () => {
    const meetingsToArray = jest.fn().mockResolvedValue([
      {
        _id: "meeting-1",
        userId: "user-1",
        title: "Single",
        extractedTasks: [],
        createdAt: new Date("2026-02-15T10:00:00.000Z"),
        lastActivityAt: new Date("2026-02-15T10:00:00.000Z"),
      },
    ]);
    const meetingsLimit = jest.fn().mockReturnValue({ toArray: meetingsToArray });
    const meetingsSort = jest.fn().mockReturnValue({ limit: meetingsLimit });
    const meetingsFind = jest.fn().mockReturnValue({ sort: meetingsSort });

    const db = {
      collection: jest.fn((name: string) => {
        if (name === "meetings") {
          return { find: meetingsFind };
        }
        throw new Error(`Unexpected collection in test: ${name}`);
      }),
    } as any;
    mockedGetDb.mockResolvedValue(db);

    const response = await GET(new Request("http://localhost/api/meetings"));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(Array.isArray(payload)).toBe(true);
    expect(meetingsLimit).toHaveBeenCalledWith(500);
  });

  it("filters meeting list by active workspace so invited members can see shared records", async () => {
    const meetingsToArray = jest.fn().mockResolvedValue([]);
    const meetingsLimit = jest.fn().mockReturnValue({ toArray: meetingsToArray });
    const meetingsSort = jest.fn().mockReturnValue({ limit: meetingsLimit });
    const meetingsFind = jest.fn().mockReturnValue({ sort: meetingsSort });

    const db = {
      collection: jest.fn((name: string) => {
        if (name === "meetings") {
          return { find: meetingsFind };
        }
        throw new Error(`Unexpected collection in test: ${name}`);
      }),
    } as any;
    mockedGetDb.mockResolvedValue(db);

    const response = await GET(new Request("http://localhost/api/meetings"));
    expect(response.status).toBe(200);
    expect(mockedGetWorkspaceIdForUser).toHaveBeenCalledWith(db, "user-1");
    expect(meetingsFind).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "workspace-1",
      }),
      expect.anything()
    );
    expect(meetingsFind).not.toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1" }),
      expect.anything()
    );
  });
});
