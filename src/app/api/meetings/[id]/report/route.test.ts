import { POST } from "@/app/api/meetings/[id]/report/route";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { resolveWorkspaceScopeForUser } from "@/lib/workspace-scope";
import { generateMeetingReport } from "@/ai/flows/meeting-report-flow";

jest.mock("@/lib/db", () => ({
  getDb: jest.fn(),
}));

jest.mock("@/lib/server-auth", () => ({
  getSessionUserId: jest.fn(),
}));

jest.mock("@/lib/workspace-scope", () => ({
  resolveWorkspaceScopeForUser: jest.fn(),
}));

jest.mock("@/ai/flows/meeting-report-flow", () => {
  const actual = jest.requireActual("@/ai/flows/meeting-report-flow");
  return {
    ...actual,
    generateMeetingReport: jest.fn(),
  };
});

jest.mock("@/lib/observability-metrics", () => ({
  recordRouteMetric: jest.fn(),
}));

const mockedGetDb = getDb as jest.MockedFunction<typeof getDb>;
const mockedGetSessionUserId = getSessionUserId as jest.MockedFunction<
  typeof getSessionUserId
>;
const mockedResolveScope = resolveWorkspaceScopeForUser as jest.MockedFunction<
  typeof resolveWorkspaceScopeForUser
>;
const mockedGenerateMeetingReport =
  generateMeetingReport as jest.MockedFunction<typeof generateMeetingReport>;

const meetingsFindOne = jest.fn();
const tasksToArray = jest.fn();
const tasksFind = jest.fn(() => ({
  limit: jest.fn(() => ({ toArray: tasksToArray })),
}));

const fakeDb = {
  collection: jest.fn((name: string) => {
    if (name === "meetings") return { findOne: meetingsFindOne };
    if (name === "tasks") return { find: tasksFind };
    return { findOne: jest.fn() };
  }),
} as any;

const buildRequest = (body: unknown = {}) =>
  new Request("http://localhost/api/meetings/meeting-1/report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const callRoute = (id = "meeting-1", body: unknown = {}) =>
  POST(buildRequest(body), { params: Promise.resolve({ id }) });

const baseMeeting = {
  _id: "meeting-1",
  userId: "owner-1",
  workspaceId: "workspace-1",
  title: "Redesign kickoff",
  summary: "Discussed redesign scope and pricing concerns.",
  originalTranscript:
    "[01:30] Stefan: The pricing feels too high for phase one.\n[02:05] Ana: I already sent the proposal.",
  attendees: [{ name: "Stefan", role: "attendee", email: "stefan@acme.com" }],
  keyMoments: [{ timestamp: "01:30", description: "Pricing pushback" }],
  startTime: "2026-06-28T10:00:00.000Z",
};

describe("POST /api/meetings/[id]/report", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetDb.mockResolvedValue(fakeDb);
    mockedGetSessionUserId.mockResolvedValue("user-1");
    mockedResolveScope.mockResolvedValue({
      workspaceId: "workspace-1",
      workspaceMemberUserIds: ["user-1", "owner-1"],
    } as any);
    meetingsFindOne.mockResolvedValue({ ...baseMeeting });
    tasksToArray.mockResolvedValue([]);
  });

  it("returns 401 when unauthenticated", async () => {
    mockedGetSessionUserId.mockResolvedValue(null as any);

    const response = await callRoute();

    expect(response.status).toBe(401);
    expect(mockedGenerateMeetingReport).not.toHaveBeenCalled();
    expect(meetingsFindOne).not.toHaveBeenCalled();
  });

  it("returns 404 for a meeting stamped with another workspace", async () => {
    meetingsFindOne.mockResolvedValue({
      ...baseMeeting,
      workspaceId: "workspace-other",
    });

    const response = await callRoute();

    expect(response.status).toBe(404);
    expect(mockedGenerateMeetingReport).not.toHaveBeenCalled();
  });

  it("returns 404 for hidden meetings", async () => {
    meetingsFindOne.mockResolvedValue({ ...baseMeeting, isHidden: true });

    const response = await callRoute();

    expect(response.status).toBe(404);
    expect(mockedGenerateMeetingReport).not.toHaveBeenCalled();
  });

  it("returns a deterministic report without calling the LLM when there is no transcript or summary", async () => {
    meetingsFindOne.mockResolvedValue({
      ...baseMeeting,
      summary: "",
      originalTranscript: "",
      artifacts: [],
    });
    tasksToArray.mockResolvedValue([
      {
        _id: "task-1",
        title: "Send updated proposal",
        status: "todo",
        assigneeName: "Ana",
      },
    ]);

    const response = await callRoute();

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.ok).toBe(true);
    expect(payload.data.grounded).toBe(false);
    expect(payload.data.sources).toEqual([]);
    expect(payload.data.report).toContain("Redesign kickoff");
    expect(payload.data.report).toContain("Send updated proposal");
    expect(payload.data.report).toContain("no transcript or summary");
    expect(mockedGenerateMeetingReport).not.toHaveBeenCalled();
  });

  it("filters LLM sources down to real meeting and task ids", async () => {
    tasksToArray.mockResolvedValue([
      {
        _id: "task-1",
        sourceTaskId: "embedded-task-1",
        title: "Send updated proposal",
        status: "inprogress",
        assigneeName: "Ana",
      },
    ]);
    mockedGenerateMeetingReport.mockResolvedValue({
      report: "## Overview\nPricing pushback was the main topic.",
      sources: [
        {
          sourceType: "transcript",
          sourceId: "meeting-1",
          title: "Redesign kickoff",
          snippet: "The pricing feels too high for phase one.",
          timestamp: "01:30",
        },
        {
          sourceType: "task",
          sourceId: "task-1",
          title: "Send updated proposal",
          snippet: "status=inprogress",
        },
        {
          sourceType: "transcript",
          sourceId: "meeting-hallucinated",
          title: "Made up",
          snippet: "Never happened.",
        },
        {
          sourceType: "task",
          sourceId: "task-hallucinated",
          title: "Made up task",
          snippet: "Never extracted.",
        },
      ],
    });

    const response = await callRoute();

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.ok).toBe(true);
    expect(payload.data.grounded).toBe(true);
    expect(payload.data.report).toContain("Pricing pushback");
    expect(payload.data.sources).toHaveLength(2);
    expect(
      payload.data.sources.map((source: any) => source.sourceId)
    ).toEqual(["meeting-1", "task-1"]);

    const flowInput = mockedGenerateMeetingReport.mock.calls[0][0];
    expect(flowInput.meetingId).toBe("meeting-1");
    expect(flowInput.tasksBlock).toContain("TASK task-1");
    expect(flowInput.attendeesBlock).toContain("Stefan");
    expect(flowInput.decisionsBlock).toContain("Pricing pushback");
    expect(flowInput.transcript).toContain("pricing feels too high");
  });

  it("accepts an empty body and rejects an invalid focus payload", async () => {
    mockedGenerateMeetingReport.mockResolvedValue({
      report: "## Overview\nOk.",
      sources: [],
    });

    const emptyBodyResponse = await POST(
      new Request("http://localhost/api/meetings/meeting-1/report", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: "meeting-1" }) }
    );
    expect(emptyBodyResponse.status).toBe(200);

    const invalidResponse = await callRoute("meeting-1", { focus: 42 });
    expect(invalidResponse.status).toBe(400);
  });

  it("scopes legacy meetings without workspaceId to workspace members", async () => {
    meetingsFindOne.mockResolvedValue({
      ...baseMeeting,
      workspaceId: undefined,
      userId: "stranger-1",
    });

    const response = await callRoute();

    expect(response.status).toBe(404);
    expect(mockedGenerateMeetingReport).not.toHaveBeenCalled();
  });
});
