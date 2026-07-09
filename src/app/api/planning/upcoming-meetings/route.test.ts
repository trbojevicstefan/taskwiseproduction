import { GET } from "@/app/api/planning/upcoming-meetings/route";
import { getDb } from "@/lib/db";
import { fetchGoogleUpcomingEvents } from "@/lib/google-calendar-upcoming";
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

jest.mock("@/lib/google-calendar-upcoming", () => ({
  fetchGoogleUpcomingEvents: jest.fn(),
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
const mockedFetchGoogleUpcomingEvents =
  fetchGoogleUpcomingEvents as jest.MockedFunction<
    typeof fetchGoogleUpcomingEvents
  >;

const NOW = new Date("2026-07-06T12:00:00.000Z");

const EXPECTED_SCOPE_OR = [
  { workspaceId: "workspace-1" },
  {
    workspaceId: { $exists: false },
    userId: { $in: ["user-1", "user-2"] },
  },
];

type DbFixture = {
  tasks?: any[];
  meetings?: any[];
};

const buildDb = ({ tasks = [], meetings = [] }: DbFixture) => {
  const taskToArray = jest.fn().mockResolvedValue(tasks);
  const taskLimit = jest.fn().mockReturnValue({ toArray: taskToArray });
  const taskSort = jest.fn().mockReturnValue({ limit: taskLimit });
  const tasksFind = jest.fn().mockReturnValue({ sort: taskSort });

  const meetingToArray = jest.fn().mockResolvedValue(meetings);
  const meetingLimit = jest.fn().mockReturnValue({ toArray: meetingToArray });
  const meetingSort = jest.fn().mockReturnValue({ limit: meetingLimit });
  const meetingsFind = jest.fn().mockReturnValue({ sort: meetingSort });

  const db = {
    collection: jest.fn((name: string) => {
      if (name === "tasks") return { find: tasksFind };
      if (name === "meetings") return { find: meetingsFind };
      throw new Error(`Unexpected collection in test: ${name}`);
    }),
  } as any;

  return { db, tasksFind, meetingsFind };
};

const requestFor = (query = "") =>
  new Request(`http://localhost/api/planning/upcoming-meetings${query}`);

describe("GET /api/planning/upcoming-meetings", () => {
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
    mockedResolveWorkspaceScopeForUser.mockResolvedValue({
      workspaceId: "workspace-1",
      workspace: null as any,
      membership: null as any,
      workspaceMemberUserIds: ["user-1", "user-2"],
    } as any);
    mockedFetchGoogleUpcomingEvents.mockResolvedValue({
      connected: true,
      events: [],
    });
  });

  it("returns 401 when there is no session user", async () => {
    mockedGetSessionUserId.mockResolvedValue(null as any);

    const response = await GET(requestFor());

    expect(response.status).toBe(401);
    expect(mockedGetDb).not.toHaveBeenCalled();
  });

  it("rejects invalid query parameters", async () => {
    const response = await GET(requestFor("?days=99"));
    expect(response.status).toBe(400);
    expect(mockedGetDb).not.toHaveBeenCalled();
  });

  it("merges taskwise meetings with google events, flags agendas, counts open tasks", async () => {
    const fixture = buildDb({
      tasks: [
        { _id: "t-1", assignee: { email: "alice@client.com" } },
        { _id: "t-2", assigneeName: "Bob Internal" },
      ],
      meetings: [
        {
          _id: "m-linked",
          title: "Weekly Sync",
          startTime: "2026-07-07T10:00:00.000Z",
          calendarEventId: "gev-1",
          attendees: [{ name: "Alice Client", email: "alice@client.com" }],
          agenda: [{ id: "a", title: "Intro", order: 0 }],
        },
        {
          _id: "m-solo",
          title: "Internal Prep",
          startTime: new Date("2026-07-08T09:00:00.000Z"),
          attendees: ["Bob Internal"],
        },
      ],
    });
    mockedGetDb.mockResolvedValue(fixture.db);
    mockedFetchGoogleUpcomingEvents.mockResolvedValue({
      connected: true,
      events: [
        {
          id: "gev-1",
          title: "Weekly Sync",
          startTime: "2026-07-07T10:00:00.000Z",
          endTime: "2026-07-07T10:30:00.000Z",
          hangoutLink: "https://meet.google.com/abc",
          location: null,
          organizer: null,
          description: null,
          attendees: [],
        },
        {
          id: "gev-2",
          title: "Client Kickoff",
          startTime: "2026-07-09T14:00:00.000Z",
          endTime: null,
          hangoutLink: null,
          location: null,
          organizer: null,
          description: null,
          attendees: [
            { email: "alice@client.com", name: "Alice Client", responseStatus: null },
          ],
        },
      ],
    });

    const response = await GET(requestFor());

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.ok).toBe(true);
    expect(payload.googleConnected).toBe(true);
    expect(payload.googleError).toBeNull();

    expect(payload.meetings.map((m: any) => m.id)).toEqual([
      "tw:m-linked",
      "tw:m-solo",
      "g:gev-2",
    ]);
    const [linked, solo, google] = payload.meetings;
    expect(linked).toMatchObject({
      source: "linked",
      meetingId: "m-linked",
      googleEventId: "gev-1",
      needsAgenda: false,
      agendaSectionCount: 1,
      openTaskCount: 1,
      hangoutLink: "https://meet.google.com/abc",
    });
    expect(solo).toMatchObject({
      source: "taskwise",
      needsAgenda: true,
      openTaskCount: 1,
    });
    expect(google).toMatchObject({
      source: "google",
      meetingId: null,
      needsAgenda: true,
      openTaskCount: 1,
    });

    expect(payload.counts).toEqual({ total: 3, needsAgenda: 2 });

    // Google fetch: meeting-only default, window from now.
    expect(mockedFetchGoogleUpcomingEvents).toHaveBeenCalledWith("user-1", {
      start: NOW,
      end: new Date("2026-07-20T12:00:00.000Z"),
    });

    // Open-task query mirrors the planning overview scope.
    expect(fixture.tasksFind).toHaveBeenCalledWith(
      expect.objectContaining({
        $or: EXPECTED_SCOPE_OR,
        status: { $ne: "done" },
        taskState: { $ne: "archived" },
        cleanupStatus: { $ne: "expired" },
      }),
      expect.anything()
    );

    // Upcoming meetings query: scoped, not hidden, startTime range covers
    // Date and ISO-string storage.
    expect(fixture.meetingsFind).toHaveBeenCalledWith(
      expect.objectContaining({
        $or: EXPECTED_SCOPE_OR,
        isHidden: { $ne: true },
        $and: [
          {
            $or: [
              {
                startTime: {
                  $gte: NOW,
                  $lte: new Date("2026-07-20T12:00:00.000Z"),
                },
              },
              {
                startTime: {
                  $gte: "2026-07-06T12:00:00.000Z",
                  $lte: "2026-07-20T12:00:00.000Z",
                },
              },
            ],
          },
        ],
      }),
      expect.anything()
    );
  });

  it("reports googleConnected=false without failing when Google is not connected", async () => {
    const fixture = buildDb({
      meetings: [
        {
          _id: "m-solo",
          title: "Internal Prep",
          startTime: "2026-07-08T09:00:00.000Z",
          attendees: [],
        },
      ],
    });
    mockedGetDb.mockResolvedValue(fixture.db);
    mockedFetchGoogleUpcomingEvents.mockResolvedValue({
      connected: false,
      events: [],
    });

    const response = await GET(requestFor());
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.googleConnected).toBe(false);
    expect(payload.meetings).toHaveLength(1);
  });

  it("degrades gracefully when the Google fetch throws", async () => {
    const fixture = buildDb({
      meetings: [
        {
          _id: "m-solo",
          title: "Internal Prep",
          startTime: "2026-07-08T09:00:00.000Z",
          attendees: [],
        },
      ],
    });
    mockedGetDb.mockResolvedValue(fixture.db);
    mockedFetchGoogleUpcomingEvents.mockRejectedValue(
      new Error("Google Calendar API error.")
    );

    const response = await GET(requestFor());
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.googleConnected).toBe(false);
    expect(payload.googleError).toBe("Google Calendar API error.");
    expect(payload.meetings.map((m: any) => m.id)).toEqual(["tw:m-solo"]);
  });

  it("returns empty meetings when there are no sources", async () => {
    const fixture = buildDb({});
    mockedGetDb.mockResolvedValue(fixture.db);

    const response = await GET(requestFor());
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.meetings).toEqual([]);
    expect(payload.counts).toEqual({ total: 0, needsAgenda: 0 });
  });
});
