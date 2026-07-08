import { GET } from "@/app/api/planning/agenda-context/route";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import {
  assertWorkspaceAccess,
  ensureWorkspaceBootstrapForUser,
} from "@/lib/workspace-context";

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

jest.mock("@/lib/workspace", () => ({
  getWorkspaceIdForUser: jest.fn().mockResolvedValue("workspace-1"),
}));

jest.mock("@/lib/observability-metrics", () => ({
  recordRouteMetric: jest.fn(),
}));

const mockedGetDb = getDb as jest.MockedFunction<typeof getDb>;
const mockedGetSessionUserId = getSessionUserId as jest.MockedFunction<
  typeof getSessionUserId
>;
const mockedAssertWorkspaceAccess =
  assertWorkspaceAccess as jest.MockedFunction<typeof assertWorkspaceAccess>;
void ensureWorkspaceBootstrapForUser;

const NOW = new Date("2026-07-06T12:00:00.000Z");

type DbFixture = {
  meeting?: any;
  tasks?: any[];
  people?: any[];
  pastMeetings?: any[];
  carryOverTasks?: any[];
};

const buildDb = ({
  meeting = null,
  tasks = [],
  people = [],
  pastMeetings = [],
  carryOverTasks = [],
}: DbFixture) => {
  const findOne = jest.fn().mockResolvedValue(meeting);

  const chain = (docs: any[]) => {
    const toArray = jest.fn().mockResolvedValue(docs);
    const limit = jest.fn().mockReturnValue({ toArray });
    const sort = jest.fn().mockReturnValue({ limit });
    return { sort, limit, toArray };
  };

  // tasks.find is called twice: open tasks (sort→limit) and carry-over
  // tasks (limit only).
  const tasksFind = jest
    .fn()
    .mockReturnValueOnce(chain(tasks))
    .mockReturnValue({
      limit: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue(carryOverTasks),
      }),
    });
  const peopleFind = jest.fn().mockReturnValue({
    toArray: jest.fn().mockResolvedValue(people),
  });
  const meetingsFind = jest.fn().mockReturnValue(chain(pastMeetings));

  const db = {
    collection: jest.fn((name: string) => {
      if (name === "meetings") return { findOne, find: meetingsFind };
      if (name === "tasks") return { find: tasksFind };
      if (name === "people") return { find: peopleFind };
      throw new Error(`Unexpected collection in test: ${name}`);
    }),
  } as any;

  return { db, findOne, tasksFind, peopleFind, meetingsFind };
};

const requestFor = (meetingId?: string) =>
  new Request(
    `http://localhost/api/planning/agenda-context${
      meetingId ? `?meetingId=${meetingId}` : ""
    }`
  );

describe("GET /api/planning/agenda-context", () => {
  beforeAll(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetSessionUserId.mockResolvedValue("user-1");
    mockedAssertWorkspaceAccess.mockResolvedValue(undefined as any);
  });

  it("returns 401 without a session and 400 without a meetingId", async () => {
    mockedGetSessionUserId.mockResolvedValueOnce(null as any);
    expect((await GET(requestFor("m-1"))).status).toBe(401);

    expect((await GET(requestFor())).status).toBe(400);
    expect(mockedGetDb).not.toHaveBeenCalled();
  });

  it("returns 404 for missing or hidden meetings and 403 when access is denied", async () => {
    mockedGetDb.mockResolvedValue(buildDb({ meeting: null }).db);
    expect((await GET(requestFor("m-1"))).status).toBe(404);

    mockedGetDb.mockResolvedValue(
      buildDb({ meeting: { _id: "m-1", userId: "user-1", isHidden: true } }).db
    );
    expect((await GET(requestFor("m-1"))).status).toBe(404);

    mockedGetDb.mockResolvedValue(
      buildDb({
        meeting: { _id: "m-1", workspaceId: "workspace-1", userId: "user-2" },
      }).db
    );
    mockedAssertWorkspaceAccess.mockRejectedValue(new Error("forbidden"));
    expect((await GET(requestFor("m-1"))).status).toBe(403);
  });

  it("assembles attendees, related people, client, open tasks, suggestions, and carry-over", async () => {
    const fixture = buildDb({
      meeting: {
        _id: "m-future",
        workspaceId: "workspace-1",
        userId: "user-1",
        title: "Weekly Client Sync",
        startTime: "2026-07-08T10:00:00.000Z",
        attendees: [
          { name: "Alice Client", email: "alice@client.com" },
          "Bob Internal",
        ],
        agenda: [{ id: "a-1", title: "Existing section", order: 0 }],
      },
      tasks: [
        {
          _id: "t-1",
          title: "Send proposal",
          status: "todo",
          dueAt: "2026-07-07T00:00:00.000Z",
          assignee: { email: "alice@client.com" },
          assigneeName: "Alice Client",
          priorityLabel: "high",
          priorityScore: 70,
          sourceSessionId: "m-old",
        },
        {
          _id: "t-unrelated",
          title: "Elsewhere",
          status: "todo",
          assigneeName: "Someone Else",
        },
      ],
      people: [
        {
          _id: "p-alice",
          name: "Alice Client",
          email: "alice@client.com",
          aliases: [],
          personType: "client",
          company: "Client Co",
        },
        {
          _id: "p-nobody",
          name: "Not In Meeting",
          email: "nobody@x.com",
          aliases: [],
          personType: "teammate",
        },
      ],
      pastMeetings: [
        {
          _id: "m-prev",
          title: "Weekly Client Sync",
          startTime: "2026-07-01T10:00:00.000Z",
          attendees: [{ name: "Alice Client", email: "alice@client.com" }],
          agenda: [{ id: "pa-1", title: "Renewal timeline", order: 0 }],
        },
      ],
      carryOverTasks: [{ _id: "ct-1", title: "Budget sign-off" }],
    });
    mockedGetDb.mockResolvedValue(fixture.db);

    const response = await GET(requestFor("m-future"));

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.ok).toBe(true);

    expect(payload.meeting).toMatchObject({
      id: "m-future",
      title: "Weekly Client Sync",
      startTime: "2026-07-08T10:00:00.000Z",
      agenda: [
        { id: "a-1", title: "Existing section", notes: "", order: 0 },
      ],
    });
    expect(payload.meeting.attendees).toEqual([
      { name: "Alice Client", email: "alice@client.com" },
      { name: "Bob Internal", email: null },
    ]);

    expect(payload.relatedPeople).toEqual([
      {
        id: "p-alice",
        name: "Alice Client",
        email: "alice@client.com",
        personType: "client",
        company: "Client Co",
      },
    ]);
    expect(payload.client).toEqual({
      personId: "p-alice",
      name: "Alice Client",
      company: "Client Co",
    });

    expect(payload.openTasks).toEqual([
      expect.objectContaining({ id: "t-1", title: "Send proposal" }),
    ]);

    expect(payload.carryOver).toEqual({
      meetingId: "m-prev",
      meetingTitle: "Weekly Client Sync",
      startTime: "2026-07-01T10:00:00.000Z",
    });

    // Deterministic suggestions: attendee open task + carry-over agenda +
    // carry-over open task.
    expect(payload.suggestedTopics.map((topic: any) => topic.title)).toEqual([
      "Review: Send proposal",
      "Carry-over: Renewal timeline",
      "Carry-over: Budget sign-off",
    ]);
    expect(
      payload.suggestedTopics.map((topic: any) => topic.source)
    ).toEqual(["open_task", "carry_over", "carry_over"]);
  });
});
