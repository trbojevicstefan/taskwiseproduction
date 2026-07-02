import { GET } from "@/app/api/people/route";
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

const DAY_MS = 24 * 60 * 60 * 1000;

describe("GET /api/people", () => {
  const overdueDueAt = new Date(Date.now() - DAY_MS);
  const meetingStartTime = new Date(Date.now() - 2 * DAY_MS);

  const clientPerson = {
    _id: "person-1",
    userId: "user-1",
    name: "Alice Client",
    email: "alice@acme.com",
    aliases: [],
    personType: "client",
    personTypeSource: "auto",
    personTypeReason: "External email domain @acme.com",
    company: "Acme",
    sourceSessionIds: ["meeting-1", "chat-1"],
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    lastSeenAt: new Date("2026-06-30T00:00:00.000Z"),
  };

  let peopleFind: jest.Mock;

  const buildDb = ({
    people,
    tasks,
    meetings,
    chatSessions,
  }: {
    people: any[];
    tasks: any[];
    meetings: any[];
    chatSessions: any[];
  }) => {
    peopleFind = jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue(people),
      }),
    });
    const projectedFind = (docs: any[]) =>
      jest.fn().mockReturnValue({
        project: jest.fn().mockReturnValue({
          toArray: jest.fn().mockResolvedValue(docs),
        }),
      });
    return {
      collection: jest.fn((name: string) => {
        if (name === "people") return { find: peopleFind };
        if (name === "tasks") return { find: projectedFind(tasks) };
        if (name === "meetings") return { find: projectedFind(meetings) };
        if (name === "chatSessions") return { find: projectedFind(chatSessions) };
        throw new Error(`Unexpected collection in test: ${name}`);
      }),
    } as any;
  };

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

  it("returns 401 when unauthorized", async () => {
    mockedGetSessionUserId.mockResolvedValue(null);
    const response = await GET(new Request("http://localhost/api/people"));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      errorCode: "request_error",
      error: "Unauthorized",
    });
  });

  it("filters by ?type=client and includes derived fields", async () => {
    mockedGetDb.mockResolvedValue(
      buildDb({
        people: [clientPerson],
        tasks: [
          {
            _id: "task-1",
            status: "todo",
            dueAt: overdueDueAt,
            assignee: { uid: "person-1" },
          },
          {
            _id: "task-2",
            status: "done",
            dueAt: overdueDueAt,
            assignee: { uid: "person-1" },
          },
          {
            _id: "task-3",
            status: "inprogress",
            assignee: { uid: "person-1" },
          },
        ],
        meetings: [
          {
            _id: "meeting-1",
            startTime: meetingStartTime,
            extractedTasks: [],
          },
          {
            _id: "meeting-2",
            startTime: new Date(Date.now() - DAY_MS),
            extractedTasks: [],
          },
        ],
        chatSessions: [],
      })
    );

    const response = await GET(
      new Request("http://localhost/api/people?type=client")
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(Array.isArray(payload)).toBe(true);
    expect(payload).toHaveLength(1);
    expect(payload[0]).toMatchObject({
      id: "person-1",
      personType: "client",
      personTypeSource: "auto",
      personTypeReason: "External email domain @acme.com",
      company: "Acme",
      nextFollowUpAt: null,
      lastMeetingAt: meetingStartTime.toISOString(),
      overdueTaskCount: 1,
      taskCount: 2,
    });
    expect(payload[0].taskCounts).toMatchObject({
      total: 3,
      open: 2,
      done: 1,
    });

    // The type filter must be part of the people query (alongside the
    // workspace fallback scope).
    expect(peopleFind).toHaveBeenCalledWith(
      expect.objectContaining({
        $and: expect.arrayContaining([
          expect.objectContaining({ personType: "client" }),
        ]),
      })
    );
  });

  it("matches docs without personType when ?type=unknown", async () => {
    mockedGetDb.mockResolvedValue(
      buildDb({
        people: [
          {
            ...clientPerson,
            _id: "person-2",
            personType: undefined,
            personTypeSource: undefined,
            personTypeReason: undefined,
            company: undefined,
            sourceSessionIds: [],
          },
        ],
        tasks: [],
        meetings: [],
        chatSessions: [],
      })
    );

    const response = await GET(
      new Request("http://localhost/api/people?type=unknown")
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload[0]).toMatchObject({
      id: "person-2",
      personType: "unknown",
      personTypeSource: null,
      personTypeReason: null,
      company: null,
      lastMeetingAt: null,
      overdueTaskCount: 0,
    });
    expect(peopleFind).toHaveBeenCalledWith(
      expect.objectContaining({
        $and: expect.arrayContaining([
          expect.objectContaining({
            $or: expect.arrayContaining([
              { personType: { $exists: false } },
              { personType: null },
              { personType: "unknown" },
            ]),
          }),
        ]),
      })
    );
  });
});
