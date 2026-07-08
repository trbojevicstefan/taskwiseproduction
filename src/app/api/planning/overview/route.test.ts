import { GET } from "@/app/api/planning/overview/route";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { TASK_LIST_PROJECTION } from "@/lib/task-projections";
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

const SECTION_KEYS = [
  "today",
  "thisWeek",
  "blocked",
  "waitingOnClient",
  "needsOwner",
  "needsDueDate",
] as const;

// Frozen 'now': Wednesday of the ISO week Mon 2026-06-29 .. Sun 2026-07-05.
const NOW = new Date("2026-07-01T12:00:00.000Z");

type DbFixture = {
  tasks?: any[];
  clientPeople?: any[];
};

const buildDb = ({ tasks = [], clientPeople = [] }: DbFixture) => {
  const toArray = jest.fn().mockResolvedValue(tasks);
  const limit = jest.fn().mockReturnValue({ toArray });
  const sort = jest.fn().mockReturnValue({ limit });
  const tasksFind = jest.fn().mockReturnValue({ sort });
  const peopleFind = jest.fn().mockReturnValue({
    toArray: jest.fn().mockResolvedValue(clientPeople),
  });

  const db = {
    collection: jest.fn((name: string) => {
      if (name === "tasks") return { find: tasksFind };
      if (name === "people") return { find: peopleFind };
      throw new Error(`Unexpected collection in test: ${name}`);
    }),
  } as any;

  return { db, tasksFind, peopleFind, sort, limit };
};

const requestFor = () =>
  new Request("http://localhost/api/planning/overview");

const sectionIds = (section: any[]) => section.map((task: any) => task.id);

describe("GET /api/planning/overview", () => {
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
  });

  it("returns 401 when there is no session user", async () => {
    mockedGetSessionUserId.mockResolvedValue(null as any);

    const response = await GET(requestFor());

    expect(response.status).toBe(401);
    expect(mockedGetDb).not.toHaveBeenCalled();
  });

  it("buckets every task into exactly one section per contract", async () => {
    const fixture = buildDb({
      tasks: [
        // Overdue AND blocked AND unowned -> precedence puts it in `today`
        // only, with all three planningFlags true.
        {
          _id: "t-overdue-blocked-unowned",
          title: "Blocked on API keys",
          description: "",
          dueAt: "2026-06-25T12:00:00.000Z",
          status: "todo",
          priorityScore: 80,
          priorityLabel: "urgent",
          priorityReason: "Overdue by 6 days",
          createdAt: new Date("2026-06-20T00:00:00.000Z"),
          lastUpdated: new Date("2026-06-21T00:00:00.000Z"),
        },
        // Due later today (not overdue), owned -> today.
        {
          _id: "t-due-today",
          title: "Send status update",
          dueAt: "2026-07-01T12:30:00.000Z",
          status: "todo",
          priorityScore: 30,
          assigneeName: "Team Member",
        },
        // Overdue yesterday, no priorityScore -> today, sorted last.
        {
          _id: "t-today-no-score",
          title: "Ship fix",
          dueAt: "2026-06-30T12:00:00.000Z",
          status: "todo",
          assigneeName: "Team Member",
        },
        // Due Sunday of the current ISO week (Date-typed dueAt) -> thisWeek.
        {
          _id: "t-sunday",
          title: "Prep demo",
          dueAt: new Date("2026-07-05T12:00:00.000Z"),
          status: "todo",
          assigneeName: "Team Member",
        },
        // Due next Monday, owned, no other signal -> matches NO section
        // and is omitted entirely.
        {
          _id: "t-next-monday",
          title: "Plan sprint",
          dueAt: "2026-07-06T12:00:00.000Z",
          status: "todo",
          assigneeName: "Team Member",
        },
        // Blocker signal, due beyond this week -> blocked.
        {
          _id: "t-blocked-future",
          title: "Contract draft",
          description: "waiting on legal review",
          dueAt: "2026-08-20T12:00:00.000Z",
          status: "todo",
          assigneeName: "Team Member",
        },
        // Assigned to a client via email (case-insensitive), no dueAt ->
        // waitingOnClient wins over needsDueDate; both flags true.
        {
          _id: "t-client",
          title: "Approve mockups",
          status: "todo",
          assignee: { email: "alice@client.com" },
          assigneeName: "Alice Client",
        },
        // No assignee at all, due beyond this week -> needsOwner.
        {
          _id: "t-needs-owner",
          title: "Write docs",
          dueAt: "2026-08-15T12:00:00.000Z",
          status: "todo",
        },
        // Owned (non-client), no dueAt -> needsDueDate.
        {
          _id: "t-needs-due",
          title: "Refactor auth",
          status: "todo",
          assigneeName: "Bob Internal",
        },
      ],
      clientPeople: [
        {
          _id: "p-1",
          name: "Alice Client",
          email: "Alice@Client.com",
          aliases: [],
        },
      ],
    });
    mockedGetDb.mockResolvedValue(fixture.db);

    const response = await GET(requestFor());

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.ok).toBe(true);
    const { sections, counts } = payload;

    // Section membership (today also asserts priorityScore-desc sorting
    // with missing scores last).
    expect(sectionIds(sections.today)).toEqual([
      "t-overdue-blocked-unowned",
      "t-due-today",
      "t-today-no-score",
    ]);
    expect(sectionIds(sections.thisWeek)).toEqual(["t-sunday"]);
    expect(sectionIds(sections.blocked)).toEqual(["t-blocked-future"]);
    expect(sectionIds(sections.waitingOnClient)).toEqual(["t-client"]);
    expect(sectionIds(sections.needsOwner)).toEqual(["t-needs-owner"]);
    expect(sectionIds(sections.needsDueDate)).toEqual(["t-needs-due"]);

    // The no-section task is omitted everywhere.
    for (const key of SECTION_KEYS) {
      expect(sectionIds(sections[key])).not.toContain("t-next-monday");
    }

    // planningFlags carry ALL applicable flags even though the task lives
    // in a single section.
    expect(sections.today[0].planningFlags).toEqual({
      overdue: true,
      blocked: true,
      waitingOnClient: false,
      needsOwner: true,
      needsDueDate: false,
    });
    expect(sections.today[1].planningFlags).toEqual({
      overdue: false,
      blocked: false,
      waitingOnClient: false,
      needsOwner: false,
      needsDueDate: false,
    });
    expect(sections.waitingOnClient[0].planningFlags).toEqual({
      overdue: false,
      blocked: false,
      waitingOnClient: true,
      needsOwner: false,
      needsDueDate: true,
    });
    expect(sections.needsOwner[0].planningFlags).toMatchObject({
      needsOwner: true,
      needsDueDate: false,
    });
    expect(sections.needsDueDate[0].planningFlags).toMatchObject({
      needsOwner: false,
      needsDueDate: true,
    });

    // serializeTask shape: id set, _id dropped, dates ISO, projection
    // fields passed through, plus planningFlags.
    expect(sections.today[0]).toMatchObject({
      id: "t-overdue-blocked-unowned",
      title: "Blocked on API keys",
      priorityScore: 80,
      priorityLabel: "urgent",
      priorityReason: "Overdue by 6 days",
      createdAt: "2026-06-20T00:00:00.000Z",
      lastUpdated: "2026-06-21T00:00:00.000Z",
    });
    expect(sections.today[0]._id).toBeUndefined();

    // Counts are the uncapped totals; with fixtures below the per-section
    // cap of 50 they equal the section lengths.
    expect(counts).toEqual({
      today: 3,
      thisWeek: 1,
      blocked: 1,
      waitingOnClient: 1,
      needsOwner: 1,
      needsDueDate: 1,
    });
    for (const key of SECTION_KEYS) {
      expect(counts[key]).toBe(sections[key].length);
    }

    // Open-task query: workspace fallback scope, open-window filter, task
    // list projection, newest-first, capped at 500.
    expect(fixture.tasksFind).toHaveBeenCalledWith(
      {
        $or: EXPECTED_SCOPE_OR,
        status: { $ne: "done" },
        taskState: { $ne: "archived" },
        cleanupStatus: { $ne: "expired" },
      },
      { projection: TASK_LIST_PROJECTION }
    );
    expect(fixture.sort).toHaveBeenCalledWith({ createdAt: -1, _id: -1 });
    expect(fixture.limit).toHaveBeenCalledWith(500);

    // Client people loaded once, scoped, minimal projection.
    expect(fixture.peopleFind).toHaveBeenCalledTimes(1);
    expect(fixture.peopleFind).toHaveBeenCalledWith(
      {
        $or: EXPECTED_SCOPE_OR,
        personType: "client",
      },
      { projection: { _id: 1, name: 1, email: 1, aliases: 1 } }
    );

    expect(mockedResolveWorkspaceScopeForUser).toHaveBeenCalledWith(
      fixture.db,
      "user-1",
      expect.objectContaining({
        minimumRole: "member",
        includeMemberUserIds: true,
      })
    );
  });

  it("draws the thisWeek boundary at Sunday of the current Mon-start week", async () => {
    const { db } = buildDb({
      tasks: [
        {
          _id: "t-sunday-edge",
          title: "In this week",
          dueAt: "2026-07-05T12:00:00.000Z",
          status: "todo",
          assigneeName: "Team Member",
        },
        {
          _id: "t-monday-next",
          title: "Next week",
          dueAt: "2026-07-06T12:00:00.000Z",
          status: "todo",
          assigneeName: "Team Member",
        },
      ],
    });
    mockedGetDb.mockResolvedValue(db);

    const response = await GET(requestFor());

    expect(response.status).toBe(200);
    const { sections, counts } = await response.json();
    expect(sectionIds(sections.thisWeek)).toEqual(["t-sunday-edge"]);
    expect(counts.thisWeek).toBe(1);
    // The next-Monday task matches no section at all.
    const total = SECTION_KEYS.reduce(
      (sum, key) => sum + sections[key].length,
      0
    );
    expect(total).toBe(1);
  });

  it("matches waitingOnClient by assignee uid with precedence over email", async () => {
    const { db } = buildDb({
      tasks: [
        // uid points at a client person -> waitingOnClient.
        {
          _id: "t-uid-client",
          title: "Review invoice",
          status: "todo",
          assignee: { uid: "p-client" },
          assigneeName: "Carla Client",
        },
        // uid points at a NON-client id: uid precedence means the client
        // email is never consulted -> not waitingOnClient (needsDueDate).
        {
          _id: "t-uid-internal",
          title: "Internal follow-up",
          status: "todo",
          assignee: { uid: "p-internal", email: "carla@client.com" },
          assigneeName: "Carla Client",
        },
      ],
      clientPeople: [
        {
          _id: "p-client",
          name: "Carla Client",
          email: "carla@client.com",
          aliases: [],
        },
      ],
    });
    mockedGetDb.mockResolvedValue(db);

    const response = await GET(requestFor());

    expect(response.status).toBe(200);
    const { sections } = await response.json();
    expect(sectionIds(sections.waitingOnClient)).toEqual(["t-uid-client"]);
    expect(sectionIds(sections.needsDueDate)).toEqual(["t-uid-internal"]);
    expect(sections.needsDueDate[0].planningFlags.waitingOnClient).toBe(false);
  });

  it("breaks equal priorityScore ties by dueAt ascending", async () => {
    const { db } = buildDb({
      tasks: [
        {
          _id: "t-later",
          title: "Due later today",
          dueAt: "2026-07-01T18:00:00.000Z",
          status: "todo",
          priorityScore: 40,
          assigneeName: "Team Member",
        },
        {
          _id: "t-earlier",
          title: "Overdue",
          dueAt: "2026-06-28T12:00:00.000Z",
          status: "todo",
          priorityScore: 40,
          assigneeName: "Team Member",
        },
      ],
    });
    mockedGetDb.mockResolvedValue(db);

    const response = await GET(requestFor());

    expect(response.status).toBe(200);
    const { sections } = await response.json();
    expect(sectionIds(sections.today)).toEqual(["t-earlier", "t-later"]);
  });
});
