import { POST } from "@/app/api/ai/chat/route";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { resolveWorkspaceScopeForUser } from "@/lib/workspace-scope";
import { searchWorkspaceContext } from "@/lib/workspace-retrieval";
import { answerWorkspaceQuestion } from "@/ai/flows/general-chat-flow";
import type { WorkspaceRetrievalResult } from "@/lib/workspace-retrieval";

jest.mock("@/lib/db", () => ({
  getDb: jest.fn(),
}));

jest.mock("@/lib/server-auth", () => ({
  getSessionUserId: jest.fn(),
}));

jest.mock("@/lib/workspace-scope", () => ({
  resolveWorkspaceScopeForUser: jest.fn(),
}));

jest.mock("@/lib/workspace-retrieval", () => ({
  searchWorkspaceContext: jest.fn(),
}));

jest.mock("@/ai/flows/general-chat-flow", () => ({
  answerWorkspaceQuestion: jest.fn(),
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
const mockedSearchWorkspaceContext =
  searchWorkspaceContext as jest.MockedFunction<typeof searchWorkspaceContext>;
const mockedAnswerWorkspaceQuestion =
  answerWorkspaceQuestion as jest.MockedFunction<typeof answerWorkspaceQuestion>;

const fakeDb = { collection: jest.fn() } as any;

const buildRequest = (body: unknown) =>
  new Request("http://localhost/api/ai/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const emptyRetrieval: WorkspaceRetrievalResult = {
  meetings: [],
  tasks: [],
  people: [],
  isEmpty: true,
};

const populatedRetrieval: WorkspaceRetrievalResult = {
  meetings: [
    {
      id: "m1",
      title: "Redesign kickoff",
      startTime: "2026-06-28T10:00:00.000Z",
      summarySnippet: "Discussed redesign scope and pricing concerns.",
      transcriptSnippets: [
        {
          timestamp: "12:30",
          snippet: "12:30 - Stefan: The pricing feels too high for phase one.",
        },
      ],
      score: 9,
    },
  ],
  tasks: [
    {
      id: "t1",
      title: "Send updated proposal",
      status: "todo",
      dueAt: "2026-06-30T00:00:00.000Z",
      assigneeName: "Stefan",
      overdue: true,
      sourceSessionId: null,
      score: 4,
    },
  ],
  people: [
    {
      id: "p1",
      name: "Stefan Ionescu",
      email: "stefan@example.com",
      personType: "client",
      score: 5,
    },
  ],
  isEmpty: false,
};

const validFlowResult = {
  answer: "Stefan said the pricing feels too high for phase one.",
  confidence: "high" as const,
  sources: [
    {
      sourceType: "transcript" as const,
      sourceId: "m1",
      title: "Redesign kickoff",
      snippet: "The pricing feels too high for phase one.",
      timestamp: "12:30",
    },
  ],
  suggestedActions: [
    {
      label: "Open the kickoff meeting",
      actionType: "open_meeting" as const,
      targetId: "m1",
    },
  ],
};

describe("POST /api/ai/chat", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetSessionUserId.mockResolvedValue("user-1");
    mockedGetDb.mockResolvedValue(fakeDb);
    mockedResolveScope.mockResolvedValue({
      workspaceId: "workspace-1",
      workspace: { _id: "workspace-1" },
      membership: { role: "member" },
      workspaceMemberUserIds: ["user-1", "user-2"],
    } as any);
    mockedSearchWorkspaceContext.mockResolvedValue(populatedRetrieval);
    mockedAnswerWorkspaceQuestion.mockResolvedValue(validFlowResult);
  });

  it("returns 401 when there is no session", async () => {
    mockedGetSessionUserId.mockResolvedValue(null as any);

    const response = await POST(buildRequest({ question: "anything" }));

    expect(response.status).toBe(401);
    const payload = await response.json();
    expect(payload.ok).toBe(false);
    expect(mockedSearchWorkspaceContext).not.toHaveBeenCalled();
    expect(mockedAnswerWorkspaceQuestion).not.toHaveBeenCalled();
  });

  it("rejects invalid payloads (question too long) with 400", async () => {
    const response = await POST(
      buildRequest({ question: "x".repeat(2001) })
    );

    expect(response.status).toBe(400);
    expect(mockedSearchWorkspaceContext).not.toHaveBeenCalled();
  });

  it("calls retrieval with the resolved workspace scope", async () => {
    const response = await POST(
      buildRequest({ question: "What did Stefan say about pricing?" })
    );

    expect(response.status).toBe(200);
    expect(mockedResolveScope).toHaveBeenCalledWith(
      fakeDb,
      "user-1",
      expect.objectContaining({ includeMemberUserIds: true })
    );
    expect(mockedSearchWorkspaceContext).toHaveBeenCalledWith(
      fakeDb,
      {
        userId: "user-1",
        workspaceId: "workspace-1",
        memberUserIds: ["user-1", "user-2"],
      },
      "What did Stefan say about pricing?"
    );
  });

  it("returns a deterministic no-evidence answer without calling the flow when retrieval is empty", async () => {
    mockedSearchWorkspaceContext.mockResolvedValue(emptyRetrieval);

    const response = await POST(
      buildRequest({ question: "What did we promise nobody?" })
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.ok).toBe(true);
    expect(payload.data.confidence).toBe("low");
    expect(payload.data.sources).toEqual([]);
    expect(payload.data.suggestedActions).toEqual([]);
    expect(payload.data.answer).toMatch(/couldn't find anything/i);
    expect(payload.data.answer).toMatch(/sync/i);
    expect(mockedAnswerWorkspaceQuestion).not.toHaveBeenCalled();
  });

  it("keeps only sources and actions whose ids exist in the retrieved context", async () => {
    mockedAnswerWorkspaceQuestion.mockResolvedValue({
      answer: "Grounded and hallucinated mix.",
      confidence: "high",
      sources: [
        {
          sourceType: "meeting",
          sourceId: "m1",
          title: "Redesign kickoff",
          snippet: "Real snippet",
        },
        {
          sourceType: "meeting",
          sourceId: "made-up-meeting",
          title: "Fake meeting",
          snippet: "Fake snippet",
        },
        {
          sourceType: "task",
          sourceId: "made-up-task",
          title: "Fake task",
          snippet: "Fake snippet",
        },
      ],
      suggestedActions: [
        { label: "Open task", actionType: "open_task", targetId: "t1" },
        { label: "Open fake", actionType: "open_task", targetId: "nope" },
        { label: "Nothing", actionType: "none" },
      ],
    });

    const response = await POST(buildRequest({ question: "pricing?" }));

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.data.sources).toHaveLength(1);
    expect(payload.data.sources[0]).toMatchObject({
      sourceType: "meeting",
      sourceId: "m1",
    });
    expect(payload.data.suggestedActions).toHaveLength(1);
    expect(payload.data.suggestedActions[0]).toMatchObject({
      actionType: "open_task",
      targetId: "t1",
    });
    // Confidence is untouched because at least one source survived.
    expect(payload.data.confidence).toBe("high");
  });

  it("degrades confidence and appends a caveat when every cited source is filtered out", async () => {
    mockedAnswerWorkspaceQuestion.mockResolvedValue({
      answer: "Everything was decided in the imaginary meeting.",
      confidence: "high",
      sources: [
        {
          sourceType: "transcript",
          sourceId: "not-retrieved",
          title: "Imaginary meeting",
          snippet: "Fake quote",
        },
      ],
      suggestedActions: [],
    });

    const response = await POST(buildRequest({ question: "what was decided?" }));

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.data.sources).toEqual([]);
    expect(payload.data.confidence).toBe("low");
    expect(payload.data.answer).toMatch(/could not verify/i);
  });

  it("returns the full contract shape and grounds the flow in rendered context blocks", async () => {
    const response = await POST(
      buildRequest({ question: "What did Stefan say about pricing?" })
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.ok).toBe(true);
    expect(payload.data).toEqual({
      answer: validFlowResult.answer,
      confidence: "high",
      sources: [
        {
          sourceType: "transcript",
          sourceId: "m1",
          title: "Redesign kickoff",
          snippet: "The pricing feels too high for phase one.",
          timestamp: "12:30",
        },
      ],
      suggestedActions: [
        {
          label: "Open the kickoff meeting",
          actionType: "open_meeting",
          targetId: "m1",
        },
      ],
    });

    expect(mockedAnswerWorkspaceQuestion).toHaveBeenCalledTimes(1);
    const [flowInput, flowMeta] = mockedAnswerWorkspaceQuestion.mock.calls[0];
    expect(flowInput.question).toBe("What did Stefan say about pricing?");
    expect(flowInput.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(flowInput.contextBlocks).toContain("MEETING m1 | Redesign kickoff | 2026-06-28");
    expect(flowInput.contextBlocks).toContain("SUMMARY: Discussed redesign scope");
    expect(flowInput.contextBlocks).toContain("[12:30]");
    expect(flowInput.contextBlocks).toContain(
      "TASK t1 | Send updated proposal | status=todo | due=2026-06-30 | assignee=Stefan | OVERDUE"
    );
    expect(flowInput.contextBlocks).toContain(
      "PERSON p1 | Stefan Ionescu | client | stefan@example.com"
    );
    expect(flowMeta).toMatchObject({ userId: "user-1" });
    expect(typeof flowMeta?.correlationId).toBe("string");
  });
});
