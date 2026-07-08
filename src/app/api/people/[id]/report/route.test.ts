import { POST } from "@/app/api/people/[id]/report/route";
import { generateProfileReport } from "@/ai/flows/profile-report-flow";
import { getDb } from "@/lib/db";
import { gatherProfileReportEvidence } from "@/lib/profile-report";
import { getSessionUserId } from "@/lib/server-auth";
import { resolveWorkspaceScopeForUser } from "@/lib/workspace-scope";
import type { ProfileReport } from "@/types/profile-report";

jest.mock("@/lib/db", () => ({
  getDb: jest.fn(),
}));

jest.mock("@/lib/server-auth", () => ({
  getSessionUserId: jest.fn(),
}));

jest.mock("@/lib/workspace-scope", () => ({
  resolveWorkspaceScopeForUser: jest.fn(),
}));

// Keep buildNoEvidenceReport/filterReportSources real — the deterministic
// no-evidence path and source filtering are what this suite verifies.
jest.mock("@/lib/profile-report", () => {
  const actual = jest.requireActual("@/lib/profile-report");
  return { ...actual, gatherProfileReportEvidence: jest.fn() };
});

jest.mock("@/ai/flows/profile-report-flow", () => ({
  generateProfileReport: jest.fn(),
}));

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
const mockedGatherEvidence = gatherProfileReportEvidence as jest.MockedFunction<
  typeof gatherProfileReportEvidence
>;
const mockedGenerateReport = generateProfileReport as jest.MockedFunction<
  typeof generateProfileReport
>;

const personDoc = {
  _id: "p1",
  name: "Jane Client",
  email: "jane@acme.com",
  personType: "client",
};

const peopleFindOne = jest.fn();
const fakeDb = {
  collection: jest.fn((name: string) => {
    if (name === "people") return { findOne: peopleFindOne };
    throw new Error(`Unexpected collection in test: ${name}`);
  }),
} as any;

const evidence = {
  contextBlocks:
    "PERSON p1 | Jane Client | client\nMEETING m1 | Acme sync | 2026-06-29",
  meetingIds: new Set(["m1"]),
  taskIds: new Set<string>(),
  personIds: new Set(["p1"]),
  isEmpty: false,
  counts: { meetings: 1, openTasks: 0, overdueTasks: 0, completedTasks: 0 },
};

const flowReport: ProfileReport = {
  subjectType: "person",
  subjectName: "Jane Client",
  generatedAt: "2026-07-06T00:00:00.000Z",
  executiveSummary: "Jane attended one recent meeting.",
  openCommitments: [],
  overdueOrRisk: [],
  completedWork: [],
  recentMeetings: ["Acme sync (2026-06-29)"],
  keyDecisions: [],
  suggestedNextAction: "Schedule a follow-up.",
  confidence: "medium",
  sources: [
    {
      sourceType: "transcript",
      sourceId: "m1",
      title: "Acme sync",
      snippet: "Jane said hello",
      timestamp: "01:23",
    },
    {
      sourceType: "person",
      sourceId: "someone-else",
      title: "Invented",
      snippet: "not real",
    },
  ],
};

const buildRequest = () =>
  new Request("http://localhost/api/people/p1/report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });

const params = Promise.resolve({ id: "p1" });

describe("POST /api/people/[id]/report", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetSessionUserId.mockResolvedValue("user-1");
    mockedResolveScope.mockResolvedValue({
      workspaceId: "workspace-1",
      workspace: null as any,
      membership: null as any,
      workspaceMemberUserIds: ["user-1"],
    });
    mockedGetDb.mockResolvedValue(fakeDb);
    peopleFindOne.mockResolvedValue(personDoc);
    mockedGatherEvidence.mockResolvedValue(evidence as any);
    mockedGenerateReport.mockResolvedValue(flowReport);
  });

  it("returns 401 when unauthorized", async () => {
    mockedGetSessionUserId.mockResolvedValue(null);
    const response = await POST(buildRequest(), { params });
    expect(response.status).toBe(401);
    expect(mockedGenerateReport).not.toHaveBeenCalled();
  });

  it("returns 404 when the person is not in the workspace", async () => {
    peopleFindOne.mockResolvedValue(null);
    const response = await POST(buildRequest(), { params });
    expect(response.status).toBe(404);
    expect(mockedGenerateReport).not.toHaveBeenCalled();
  });

  it("returns the deterministic no-evidence report without calling the LLM", async () => {
    mockedGatherEvidence.mockResolvedValue({
      ...evidence,
      contextBlocks: "",
      meetingIds: new Set(),
      isEmpty: true,
    } as any);
    const response = await POST(buildRequest(), { params });
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.data.subjectType).toBe("person");
    expect(payload.data.subjectName).toBe("Jane Client");
    expect(payload.data.sources).toEqual([]);
    expect(payload.data.confidence).toBe("low");
    expect(mockedGenerateReport).not.toHaveBeenCalled();
  });

  it("generates a report and filters sources against gathered ids", async () => {
    const response = await POST(buildRequest(), { params });
    expect(response.status).toBe(200);

    expect(mockedGatherEvidence).toHaveBeenCalledWith(
      fakeDb,
      expect.objectContaining({ workspaceId: "workspace-1" }),
      expect.objectContaining({
        type: "person",
        name: "Jane Client",
        people: [personDoc],
      })
    );

    const payload = await response.json();
    // The transcript source referencing the gathered meeting survives; the
    // invented person source is dropped.
    expect(payload.data.sources).toEqual([
      expect.objectContaining({ sourceType: "transcript", sourceId: "m1" }),
    ]);
    expect(payload.data.confidence).toBe("medium");
  });
});
