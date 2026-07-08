import { POST } from "@/app/api/companies/[id]/report/route";
import { generateProfileReport } from "@/ai/flows/profile-report-flow";
import { findCompanyById } from "@/lib/companies";
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

jest.mock("@/lib/companies", () => {
  const actual = jest.requireActual("@/lib/companies");
  return { ...actual, findCompanyById: jest.fn() };
});

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
const mockedFindCompanyById = findCompanyById as jest.MockedFunction<
  typeof findCompanyById
>;
const mockedGatherEvidence = gatherProfileReportEvidence as jest.MockedFunction<
  typeof gatherProfileReportEvidence
>;
const mockedGenerateReport = generateProfileReport as jest.MockedFunction<
  typeof generateProfileReport
>;

const companyDoc = {
  _id: "c1",
  workspaceId: "workspace-1",
  userId: "user-1",
  name: "Acme",
  nameKey: "acme",
  domain: "acme.com",
  aliases: [],
  peopleIds: ["p1"],
  createdAt: new Date(),
  updatedAt: new Date(),
};

const peopleFind = jest.fn();
const fakeDb = {
  collection: jest.fn((name: string) => {
    if (name === "people") return { find: peopleFind };
    throw new Error(`Unexpected collection in test: ${name}`);
  }),
} as any;

const evidence = {
  contextBlocks: "MEETING m1 | Acme sync | 2026-06-29\nTASK t1 | Send proposal | status=todo | due=none",
  meetingIds: new Set(["m1"]),
  taskIds: new Set(["t1"]),
  personIds: new Set(["p1"]),
  isEmpty: false,
  counts: { meetings: 1, openTasks: 1, overdueTasks: 0, completedTasks: 0 },
};

const flowReport: ProfileReport = {
  subjectType: "company",
  subjectName: "Acme",
  generatedAt: "2026-07-06T00:00:00.000Z",
  executiveSummary: "Acme has one open commitment.",
  openCommitments: ["Send proposal"],
  overdueOrRisk: [],
  completedWork: [],
  recentMeetings: ["Acme sync (2026-06-29)"],
  keyDecisions: [],
  suggestedNextAction: "Send the proposal.",
  confidence: "medium",
  sources: [
    {
      sourceType: "task",
      sourceId: "t1",
      title: "Send proposal",
      snippet: "Send proposal | status=todo",
    },
    {
      sourceType: "meeting",
      sourceId: "hallucinated-meeting",
      title: "Invented",
      snippet: "not real",
    },
  ],
};

const buildRequest = (body?: string) =>
  new Request("http://localhost/api/companies/c1/report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ?? JSON.stringify({}),
  });

const params = Promise.resolve({ id: "c1" });

describe("POST /api/companies/[id]/report", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetSessionUserId.mockResolvedValue("user-1");
    mockedResolveScope.mockResolvedValue({
      workspaceId: "workspace-1",
      workspace: null as any,
      membership: null as any,
      workspaceMemberUserIds: ["user-1"],
    });
    mockedFindCompanyById.mockResolvedValue(companyDoc as any);
    mockedGetDb.mockResolvedValue(fakeDb);
    peopleFind.mockReturnValue({
      toArray: jest
        .fn()
        .mockResolvedValue([{ _id: "p1", name: "Jane", email: "jane@acme.com" }]),
    });
    mockedGatherEvidence.mockResolvedValue(evidence as any);
    mockedGenerateReport.mockResolvedValue(flowReport);
  });

  it("returns 401 when unauthorized", async () => {
    mockedGetSessionUserId.mockResolvedValue(null);
    const response = await POST(buildRequest(), { params });
    expect(response.status).toBe(401);
    expect(mockedGenerateReport).not.toHaveBeenCalled();
  });

  it("returns 404 for a company outside the workspace", async () => {
    mockedFindCompanyById.mockResolvedValue(null);
    const response = await POST(buildRequest(), { params });
    expect(response.status).toBe(404);
    expect(mockedGenerateReport).not.toHaveBeenCalled();
  });

  it("rejects non-empty payloads with 400", async () => {
    const response = await POST(buildRequest(JSON.stringify({ nope: 1 })), {
      params,
    });
    expect(response.status).toBe(400);
    expect(mockedGenerateReport).not.toHaveBeenCalled();
  });

  it("returns the deterministic no-evidence report without calling the LLM", async () => {
    mockedGatherEvidence.mockResolvedValue({
      ...evidence,
      contextBlocks: "",
      meetingIds: new Set(),
      taskIds: new Set(),
      isEmpty: true,
    } as any);
    const response = await POST(buildRequest(), { params });
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.ok).toBe(true);
    expect(payload.data.confidence).toBe("low");
    expect(payload.data.sources).toEqual([]);
    expect(payload.data.executiveSummary).toContain("no recorded activity");
    expect(mockedGenerateReport).not.toHaveBeenCalled();
  });

  it("generates a report and filters sources against gathered ids", async () => {
    const response = await POST(buildRequest(), { params });
    expect(response.status).toBe(200);

    expect(mockedGenerateReport).toHaveBeenCalledWith(
      expect.objectContaining({
        subjectType: "company",
        subjectName: "Acme",
        contextBlocks: evidence.contextBlocks,
      }),
      expect.objectContaining({ userId: "user-1" })
    );

    const payload = await response.json();
    expect(payload.ok).toBe(true);
    // The hallucinated meeting source is dropped; the real task source stays.
    expect(payload.data.sources).toEqual([
      expect.objectContaining({ sourceType: "task", sourceId: "t1" }),
    ]);
    expect(payload.data.executiveSummary).toBe("Acme has one open commitment.");
  });

  it("degrades confidence with a caveat when every cited source is unverifiable", async () => {
    mockedGenerateReport.mockResolvedValue({
      ...flowReport,
      sources: [
        {
          sourceType: "meeting",
          sourceId: "hallucinated-meeting",
          title: "Invented",
          snippet: "not real",
        },
      ],
    });
    const response = await POST(buildRequest(), { params });
    const payload = await response.json();
    expect(payload.data.sources).toEqual([]);
    expect(payload.data.confidence).toBe("low");
    expect(payload.data.executiveSummary).toContain(
      "could not verify the cited sources"
    );
  });
});
