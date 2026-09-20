import { GET } from "@/app/api/dashboard/adaptive/route";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { resolveWorkspaceScopeForUser } from "@/lib/workspace-scope";
import { evaluateAdaptiveDashboard } from "@/lib/jev-dashboard";

jest.mock("@/lib/db", () => ({ getDb: jest.fn() }));
jest.mock("@/lib/server-auth", () => ({ getSessionUserId: jest.fn() }));
jest.mock("@/lib/workspace-scope", () => ({
  resolveWorkspaceScopeForUser: jest.fn(),
}));
jest.mock("@/lib/jev-dashboard", () => ({
  evaluateAdaptiveDashboard: jest.fn(),
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
const mockedEvaluateAdaptiveDashboard =
  evaluateAdaptiveDashboard as jest.MockedFunction<typeof evaluateAdaptiveDashboard>;

const requestFor = () =>
  new Request("http://localhost/api/dashboard/adaptive");

const buildDb = () => {
  const meetings = [
    {
      _id: "m-1",
      title: "Acme onboarding",
      summary:
        "We agreed on the onboarding checklist, technical handoff and billing review.",
      originalTranscript: "THIS MUST NEVER LEAVE TASKWISE",
      startTime: new Date("2026-09-20T10:00:00.000Z"),
      lastActivityAt: new Date("2026-09-20T11:00:00.000Z"),
      attendees: [
        { name: "Maya Client", email: "maya@acme.example" },
        { name: "Jon Internal", email: "jon@taskwise.example" },
      ],
      extractedTasks: [
        {
          id: "embedded-1",
          title: "Send checklist",
          reviewStatus: "suggested",
        },
      ],
    },
  ];

  const tasks = [
    {
      _id: "t-1",
      title: "Send onboarding checklist",
      description: "Sensitive task description that should not be sent",
      status: "todo",
      priorityScore: 75,
      priorityLabel: "urgent",
      priorityReason: "Due today; Client-facing",
      dueAt: new Date("2026-09-20T18:00:00.000Z"),
      assignee: { name: "Jon Internal", email: "jon@taskwise.example" },
      assigneeName: "Jon Internal",
      reviewStatus: "confirmed",
      lastUpdated: new Date("2026-09-20T12:00:00.000Z"),
    },
  ];

  const people = [
    {
      _id: "p-client",
      name: "Maya Client",
      email: "maya@acme.example",
      aliases: ["Maya"],
      personType: "client",
    },
    {
      _id: "p-internal",
      name: "Jon Internal",
      email: "jon@taskwise.example",
      aliases: [],
      personType: "teammate",
    },
  ];

  const meetingsToArray = jest.fn().mockResolvedValue(meetings);
  const meetingsLimit = jest.fn().mockReturnValue({ toArray: meetingsToArray });
  const meetingsSort = jest.fn().mockReturnValue({ limit: meetingsLimit });
  const meetingsFind = jest.fn().mockReturnValue({ sort: meetingsSort });

  const tasksToArray = jest.fn().mockResolvedValue(tasks);
  const tasksLimit = jest.fn().mockReturnValue({ toArray: tasksToArray });
  const tasksSort = jest.fn().mockReturnValue({ limit: tasksLimit });
  const tasksFind = jest.fn().mockReturnValue({ sort: tasksSort });

  const peopleToArray = jest.fn().mockResolvedValue(people);
  const peopleLimit = jest.fn().mockReturnValue({ toArray: peopleToArray });
  const peopleFind = jest.fn().mockReturnValue({ limit: peopleLimit });

  const collection = jest.fn((name: string) => {
    if (name === "meetings") return { find: meetingsFind };
    if (name === "tasks") return { find: tasksFind };
    if (name === "people") return { find: peopleFind };
    throw new Error(`Unexpected collection: ${name}`);
  });

  return {
    db: { collection } as any,
    meetingsFind,
    meetingsSort,
    meetingsLimit,
    tasksFind,
    tasksSort,
    tasksLimit,
    peopleFind,
    peopleLimit,
  };
};

describe("GET /api/dashboard/adaptive", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date("2026-09-20T20:00:00.000Z"));
    mockedGetSessionUserId.mockResolvedValue("user-1");
    mockedResolveWorkspaceScopeForUser.mockResolvedValue({
      workspaceId: "workspace-1",
      workspace: {} as any,
      membership: {} as any,
      workspaceMemberUserIds: ["user-1", "user-2"],
    });
    mockedEvaluateAdaptiveDashboard.mockResolvedValue({
      source: "jev",
      focus: "review_meeting",
      surface: "popover",
      confidence: 0.88,
      decisionKey: "review:1",
      eyebrow: "New commitments detected",
      title: "Review what came out of your latest meetings",
      description: "Review the commitments.",
      primaryAction: { label: "Review tasks", href: "/review" },
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("returns 401 before touching the database when unauthenticated", async () => {
    mockedGetSessionUserId.mockResolvedValue(null);

    const response = await GET(requestFor());

    expect(response.status).toBe(401);
    expect(mockedGetDb).not.toHaveBeenCalled();
  });

  it("builds a minimized workspace-scoped snapshot for Jev", async () => {
    const fixture = buildDb();
    mockedGetDb.mockResolvedValue(fixture.db);

    const response = await GET(requestFor());

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.ok).toBe(true);
    expect(payload.decision.focus).toBe("review_meeting");
    expect(payload.context).toMatchObject({
      recentMeetingCount: 1,
      meetingsNeedingReview: 1,
      urgentTaskCount: 1,
      openTaskCount: 1,
    });

    expect(mockedResolveWorkspaceScopeForUser).toHaveBeenCalledWith(
      fixture.db,
      "user-1",
      expect.objectContaining({
        minimumRole: "member",
        includeMemberUserIds: true,
      })
    );

    expect(mockedEvaluateAdaptiveDashboard).toHaveBeenCalledTimes(1);
    const snapshot = mockedEvaluateAdaptiveDashboard.mock.calls[0][0];

    expect(snapshot.recentMeetings).toEqual([
      expect.objectContaining({
        id: "m-1",
        title: "Acme onboarding",
        attendeeNames: ["Maya Client", "Jon Internal"],
        extractedTaskCount: 1,
        suggestedTaskCount: 1,
      }),
    ]);
    expect(snapshot.topTasks).toEqual([
      expect.objectContaining({
        id: "t-1",
        title: "Send onboarding checklist",
        priorityScore: 75,
        assigneeName: "Jon Internal",
      }),
    ]);
    expect(snapshot.peopleSignals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "p-client",
          name: "Maya Client",
          client: true,
          recentMeetingCount: 1,
        }),
      ])
    );

    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain("THIS MUST NEVER LEAVE TASKWISE");
    expect(serialized).not.toContain("maya@acme.example");
    expect(serialized).not.toContain("jon@taskwise.example");
    expect(serialized).not.toContain("Sensitive task description");

    expect(fixture.meetingsLimit).toHaveBeenCalledWith(12);
    expect(fixture.tasksLimit).toHaveBeenCalledWith(100);
    expect(fixture.peopleLimit).toHaveBeenCalledWith(100);
  });
});
