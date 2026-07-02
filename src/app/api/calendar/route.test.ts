import { GET } from "@/app/api/calendar/route";
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

const EXPECTED_SCOPE_OR = [
  { workspaceId: "workspace-1" },
  {
    workspaceId: { $exists: false },
    userId: { $in: ["user-1", "user-2"] },
  },
];

const buildFindChain = (docs: any[]) => {
  const toArray = jest.fn().mockResolvedValue(docs);
  const limit = jest.fn().mockReturnValue({ toArray });
  const sort = jest.fn().mockReturnValue({ limit });
  return { sort, limit, toArray };
};

type DbFixture = {
  meetings?: any[];
  tasks?: any[];
  clientPeople?: any[];
  counts?: [number, number, number];
};

const buildDb = ({
  meetings = [],
  tasks = [],
  clientPeople = [],
  counts = [0, 0, 0],
}: DbFixture) => {
  const meetingsChain = buildFindChain(meetings);
  const tasksChain = buildFindChain(tasks);
  const meetingsFind = jest.fn().mockReturnValue(meetingsChain);
  const tasksFind = jest.fn().mockReturnValue(tasksChain);
  const peopleFind = jest.fn().mockReturnValue({
    toArray: jest.fn().mockResolvedValue(clientPeople),
  });
  const countDocuments = jest
    .fn()
    .mockResolvedValueOnce(counts[0])
    .mockResolvedValueOnce(counts[1])
    .mockResolvedValueOnce(counts[2]);

  const db = {
    collection: jest.fn((name: string) => {
      if (name === "meetings") return { find: meetingsFind };
      if (name === "tasks") return { find: tasksFind, countDocuments };
      if (name === "people") return { find: peopleFind };
      throw new Error(`Unexpected collection in test: ${name}`);
    }),
  } as any;

  return {
    db,
    meetingsFind,
    tasksFind,
    peopleFind,
    countDocuments,
    meetingsChain,
    tasksChain,
  };
};

const requestFor = (query: string) =>
  new Request(`http://localhost/api/calendar${query}`);

describe("GET /api/calendar", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetSessionUserId.mockResolvedValue("user-1");
    mockedResolveWorkspaceScopeForUser.mockResolvedValue({
      workspaceId: "workspace-1",
      workspace: null as any,
      membership: null as any,
      workspaceMemberUserIds: ["user-1", "user-2"],
    } as any);
  });

  it("returns 401 when there is no session user", async () => {
    mockedGetSessionUserId.mockResolvedValue(null as any);

    const response = await GET(
      requestFor("?from=2026-01-01T00:00:00.000Z&to=2026-01-31T00:00:00.000Z")
    );

    expect(response.status).toBe(401);
  });

  it.each([
    ["missing from", "?to=2026-01-31T00:00:00.000Z"],
    ["missing to", "?from=2026-01-01T00:00:00.000Z"],
    ["missing both", ""],
    [
      "invalid from",
      "?from=not-a-date&to=2026-01-31T00:00:00.000Z",
    ],
    [
      "inverted range",
      "?from=2026-02-01T00:00:00.000Z&to=2026-01-01T00:00:00.000Z",
    ],
    [
      "span over 62 days",
      "?from=2026-01-01T00:00:00.000Z&to=2026-03-05T00:00:00.000Z",
    ],
  ])("returns 400 request_error for %s", async (_label, query) => {
    const response = await GET(requestFor(query));

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.ok).toBe(false);
    expect(payload.errorCode).toBe("request_error");
    expect(mockedGetDb).not.toHaveBeenCalled();
  });

  it("accepts a range of exactly 62 days", async () => {
    const { db } = buildDb({});
    mockedGetDb.mockResolvedValue(db);

    const response = await GET(
      requestFor("?from=2026-01-01T00:00:00.000Z&to=2026-03-04T00:00:00.000Z")
    );

    expect(response.status).toBe(200);
  });

  it("returns meetings, range tasks, and whole-scope warnings per contract", async () => {
    const fixture = buildDb({
      meetings: [
        {
          _id: "m-1",
          title: "Kickoff with Acme",
          startTime: new Date("2020-01-05T10:00:00.000Z"),
          attendees: [{ name: "Someone Else", email: "ALICE@client.com " }],
        },
        {
          _id: "m-2",
          title: "Alias sync",
          startTime: "2020-01-10T09:00:00.000Z",
          attendees: [{ name: "  Bob   Buyer! " }, { name: "Internal Ida" }],
        },
        {
          _id: "m-3",
          title: "Internal standup",
          startTime: "2020-01-12T09:00:00.000Z",
          attendees: [
            { name: "Random Person", email: "random@internal.com" },
            { name: "Internal Ida" },
          ],
        },
        {
          _id: "m-4",
          title: "No attendees, bad date",
          startTime: "not-a-date",
        },
      ],
      tasks: [
        {
          _id: "t-1",
          title: "Send proposal",
          dueAt: "2020-01-10T00:00:00.000Z",
          status: "todo",
          priorityLabel: "high",
          priorityScore: 55,
          cleanupStatus: "suggested_expire",
          assigneeName: "Alice Client",
          sourceSessionId: "session-9",
        },
        {
          _id: "t-2",
          title: "Archive notes",
          dueAt: new Date("2020-01-20T00:00:00.000Z"),
          status: "done",
        },
        {
          _id: "t-3",
          title: "Out of range",
          dueAt: "2021-05-05T00:00:00.000Z",
          status: "todo",
        },
        {
          _id: "t-4",
          title: "Garbage due date",
          dueAt: "not-a-date",
          status: "todo",
        },
      ],
      clientPeople: [
        {
          _id: "p-1",
          name: "Alice Client",
          email: "Alice@Client.com",
          aliases: ["Bob Buyer"],
        },
      ],
      counts: [4, 2, 1],
    });
    mockedGetDb.mockResolvedValue(fixture.db);

    const from = "2020-01-01T00:00:00.000Z";
    const to = "2020-02-14T00:00:00.000Z";
    const response = await GET(requestFor(`?from=${from}&to=${to}`));

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.ok).toBe(true);

    // Meetings: serialized shape, string/Date startTime both normalized to ISO.
    expect(payload.meetings).toEqual([
      {
        id: "m-1",
        title: "Kickoff with Acme",
        startTime: "2020-01-05T10:00:00.000Z",
        attendeeCount: 1,
        isClientMeeting: true, // client match via email (case/space-insensitive)
      },
      {
        id: "m-2",
        title: "Alias sync",
        startTime: "2020-01-10T09:00:00.000Z",
        attendeeCount: 2,
        isClientMeeting: true, // client match via alias name-key
      },
      {
        id: "m-3",
        title: "Internal standup",
        startTime: "2020-01-12T09:00:00.000Z",
        attendeeCount: 2,
        isClientMeeting: false,
      },
      {
        id: "m-4",
        title: "No attendees, bad date",
        startTime: null,
        attendeeCount: 0,
        isClientMeeting: false,
      },
    ]);

    // Tasks: only in-range coercible dueAt docs survive; overdue respects status.
    expect(payload.tasks).toEqual([
      {
        id: "t-1",
        title: "Send proposal",
        dueAt: "2020-01-10T00:00:00.000Z",
        status: "todo",
        priorityLabel: "high",
        priorityScore: 55,
        cleanupStatus: "suggested_expire",
        assigneeName: "Alice Client",
        sourceSessionId: "session-9",
        overdue: true,
      },
      {
        id: "t-2",
        title: "Archive notes",
        dueAt: "2020-01-20T00:00:00.000Z",
        status: "done",
        priorityLabel: null,
        priorityScore: null,
        cleanupStatus: null,
        assigneeName: null,
        sourceSessionId: null,
        overdue: false,
      },
    ]);

    expect(payload.warnings).toEqual({
      overdueCount: 4,
      cleanupSuggestedCount: 2,
      expiredCount: 1,
    });

    // Meetings query: workspace fallback scope + isHidden + dual-type
    // startTime range (Date and ISO string).
    expect(fixture.meetingsFind).toHaveBeenCalledWith(
      {
        $and: [
          { $or: EXPECTED_SCOPE_OR },
          { isHidden: { $ne: true } },
          {
            $or: [
              { startTime: { $gte: new Date(from), $lte: new Date(to) } },
              { startTime: { $gte: from, $lte: to } },
            ],
          },
        ],
      },
      {
        projection: {
          _id: 1,
          title: 1,
          startTime: 1,
          attendees: 1,
          userId: 1,
          workspaceId: 1,
        },
      }
    );

    // Tasks query: open scope with non-null dueAt, minimal projection, cap 500.
    expect(fixture.tasksFind).toHaveBeenCalledWith(
      {
        $or: EXPECTED_SCOPE_OR,
        taskState: { $ne: "archived" },
        cleanupStatus: { $ne: "expired" },
        dueAt: { $ne: null },
      },
      {
        projection: {
          _id: 1,
          title: 1,
          dueAt: 1,
          status: 1,
          priorityLabel: 1,
          priorityScore: 1,
          cleanupStatus: 1,
          assigneeName: 1,
          sourceSessionId: 1,
        },
      }
    );
    expect(fixture.tasksChain.limit).toHaveBeenCalledWith(500);

    // Client people loaded once, scoped, minimal projection.
    expect(fixture.peopleFind).toHaveBeenCalledTimes(1);
    expect(fixture.peopleFind).toHaveBeenCalledWith(
      {
        $or: EXPECTED_SCOPE_OR,
        personType: "client",
      },
      { projection: { name: 1, email: 1, aliases: 1 } }
    );

    // Warning counts run over the whole open scope, not the range.
    expect(fixture.countDocuments).toHaveBeenCalledTimes(3);
    const [overdueFilter, suggestedFilter, expiredFilter] =
      fixture.countDocuments.mock.calls.map((call: any[]) => call[0]);
    expect(overdueFilter).toMatchObject({
      $or: EXPECTED_SCOPE_OR,
      taskState: { $ne: "archived" },
      cleanupStatus: { $ne: "expired" },
      status: { $ne: "done" },
    });
    // Overdue matches both Date-typed and ISO-string dueAt values.
    expect(overdueFilter.$and).toHaveLength(1);
    expect(overdueFilter.$and[0].$or).toHaveLength(2);
    expect(overdueFilter.$and[0].$or[0].dueAt.$lt).toBeInstanceOf(Date);
    expect(typeof overdueFilter.$and[0].$or[1].dueAt.$lt).toBe("string");
    expect(suggestedFilter).toEqual({
      $or: EXPECTED_SCOPE_OR,
      taskState: { $ne: "archived" },
      cleanupStatus: {
        $in: ["suggested_expire", "duplicate_suggested", "completed_suggested"],
      },
    });
    expect(expiredFilter).toEqual({
      $or: EXPECTED_SCOPE_OR,
      taskState: { $ne: "archived" },
      cleanupStatus: "expired",
    });

    expect(mockedResolveWorkspaceScopeForUser).toHaveBeenCalledWith(
      fixture.db,
      "user-1",
      expect.objectContaining({
        minimumRole: "member",
        includeMemberUserIds: true,
      })
    );
  });

  it("does not flag future in-range tasks as overdue", async () => {
    const { db } = buildDb({
      tasks: [
        {
          _id: "t-future",
          title: "Future task",
          dueAt: "2099-01-10T00:00:00.000Z",
          status: "todo",
        },
      ],
    });
    mockedGetDb.mockResolvedValue(db);

    const response = await GET(
      requestFor("?from=2099-01-01T00:00:00.000Z&to=2099-01-31T00:00:00.000Z")
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.tasks).toHaveLength(1);
    expect(payload.tasks[0]).toMatchObject({
      id: "t-future",
      overdue: false,
    });
  });
});
