import { POST } from "@/app/api/ai/chat/route";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { resolveWorkspaceScopeForUser } from "@/lib/workspace-scope";
import { searchWorkspaceContext } from "@/lib/workspace-retrieval";
import { planWorkspaceChatQuestion } from "@/lib/chat-query-planner";
import { runInternalChatTool } from "@/lib/internal-chat-tools";
import {
  answerMeetingQuestion,
  answerWorkspaceQuestion,
} from "@/ai/flows/general-chat-flow";
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

jest.mock("@/lib/chat-query-planner", () => ({
  planWorkspaceChatQuestion: jest.fn(),
}));

jest.mock("@/lib/internal-chat-tools", () => ({
  runInternalChatTool: jest.fn(),
}));

jest.mock("@/ai/flows/general-chat-flow", () => ({
  answerWorkspaceQuestion: jest.fn(),
  answerMeetingQuestion: jest.fn(),
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
const mockedPlanWorkspaceChatQuestion =
  planWorkspaceChatQuestion as jest.MockedFunction<
    typeof planWorkspaceChatQuestion
  >;
const mockedRunInternalChatTool = runInternalChatTool as jest.MockedFunction<
  typeof runInternalChatTool
>;
const mockedAnswerWorkspaceQuestion =
  answerWorkspaceQuestion as jest.MockedFunction<typeof answerWorkspaceQuestion>;
const mockedAnswerMeetingQuestion =
  answerMeetingQuestion as jest.MockedFunction<typeof answerMeetingQuestion>;

const meetingsFindOne = jest.fn();
const chatSessionsFindOne = jest.fn();
const fakeDb = {
  collection: jest.fn((name: string) => {
    if (name === "meetings") return { findOne: meetingsFindOne };
    if (name === "chatSessions") return { findOne: chatSessionsFindOne };
    return { findOne: jest.fn() };
  }),
} as any;

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

const transcriptMeeting = {
  _id: "m1",
  workspaceId: "workspace-1",
  userId: "user-1",
  title: "Redesign kickoff",
  startTime: "2026-06-28T10:00:00.000Z",
  summary: "Discussed redesign scope and pricing concerns.",
  originalTranscript:
    "12:30 - Stefan: The pricing feels too high for phase one.\n12:45 - Ana: Let's revisit the proposal next week.",
};

const validMeetingFlowResult = {
  answer: "Stefan said the pricing feels too high for phase one.",
  confidence: "high" as const,
  sources: [
    {
      sourceType: "transcript" as const,
      sourceId: "m1",
      title: "Redesign kickoff",
      snippet: "12:30 - Stefan: The pricing feels too high for phase one.",
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
    mockedPlanWorkspaceChatQuestion.mockReturnValue({
      mode: "workspace_retrieval",
    });
    mockedAnswerWorkspaceQuestion.mockResolvedValue(validFlowResult);
    mockedAnswerMeetingQuestion.mockResolvedValue(validMeetingFlowResult);
    meetingsFindOne.mockResolvedValue(null);
    chatSessionsFindOne.mockResolvedValue(null);
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

  it("answers weekly meeting-count questions from internal MCP tool data", async () => {
    mockedPlanWorkspaceChatQuestion.mockReturnValue({
      mode: "workspace_tool",
      toolName: "get_calendar_agenda",
      toolArgs: {
        from: "2026-07-06T00:00:00.000Z",
        to: "2026-07-12T23:59:59.999Z",
      },
      rationale: "meeting_count_this_week",
    });
    mockedRunInternalChatTool.mockResolvedValue({
      summary:
        "Agenda 2026-07-06 -> 2026-07-12: 3 meeting(s), 2 due task(s), 1 reminder(s).",
      contextBlocks: [
        "AGENDA_RANGE 2026-07-06T00:00:00.000Z | 2026-07-12T23:59:59.999Z",
        "MEETING m1 | Kickoff | 2026-07-07 | attendees=3 | clientMeeting=true",
        "MEETING m2 | Retro | 2026-07-08 | attendees=4 | clientMeeting=false",
        "MEETING m3 | Planning | 2026-07-09 | attendees=2 | clientMeeting=false",
      ].join("\n"),
      answerHint:
        "Use the agenda rows to answer operational questions deterministically.",
    });
    mockedAnswerWorkspaceQuestion.mockResolvedValue({
      answer: "You had 3 meetings this week.",
      confidence: "high",
      sources: [],
      suggestedActions: [],
    });

    const response = await POST(
      buildRequest({ question: "How many meetings did we have this week?" })
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.data.answer).toMatch(/3 meeting/i);
    expect(payload.data.confidence).not.toBe("low");
    expect(mockedRunInternalChatTool).toHaveBeenCalledWith({
      db: fakeDb,
      workspaceId: "workspace-1",
      toolName: "get_calendar_agenda",
      toolArgs: {
        from: "2026-07-06T00:00:00.000Z",
        to: "2026-07-12T23:59:59.999Z",
      },
    });
    expect(mockedSearchWorkspaceContext).not.toHaveBeenCalled();
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

  it("rejects an oversized history list with 400", async () => {
    const history = Array.from({ length: 21 }, (_, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      text: `turn ${index}`,
    }));

    const response = await POST(buildRequest({ question: "hello?", history }));

    expect(response.status).toBe(400);
    expect(mockedSearchWorkspaceContext).not.toHaveBeenCalled();
    expect(mockedAnswerWorkspaceQuestion).not.toHaveBeenCalled();
    expect(mockedAnswerMeetingQuestion).not.toHaveBeenCalled();
  });

  it("rejects history entries that are too long with 400", async () => {
    const response = await POST(
      buildRequest({
        question: "hello?",
        history: [{ role: "user", text: "x".repeat(2001) }],
      })
    );

    expect(response.status).toBe(400);
    expect(mockedSearchWorkspaceContext).not.toHaveBeenCalled();
  });

  it("forwards rendered history to the workspace flow", async () => {
    const response = await POST(
      buildRequest({
        question: "Who owns that?",
        history: [
          { role: "user", text: "Which tasks are overdue?" },
          { role: "assistant", text: "Send updated proposal is overdue." },
        ],
      })
    );

    expect(response.status).toBe(200);
    const [flowInput] = mockedAnswerWorkspaceQuestion.mock.calls[0];
    expect(flowInput.history).toContain("User: Which tasks are overdue?");
    expect(flowInput.history).toContain(
      "Assistant: Send updated proposal is overdue."
    );
  });

  describe("meeting-scoped chat", () => {
    it("answers from the meeting transcript, cites its snippets, and skips workspace retrieval", async () => {
      meetingsFindOne.mockResolvedValue(transcriptMeeting);
      mockedAnswerMeetingQuestion.mockResolvedValue({
        ...validMeetingFlowResult,
        sources: [
          ...validMeetingFlowResult.sources,
          {
            sourceType: "transcript",
            sourceId: "other-meeting",
            title: "Hallucinated",
            snippet: "fake",
          },
          {
            sourceType: "task",
            sourceId: "t1",
            title: "Task types are not valid meeting sources",
            snippet: "fake",
          },
        ],
        suggestedActions: [
          ...validMeetingFlowResult.suggestedActions,
          { label: "Open other", actionType: "open_meeting", targetId: "nope" },
          { label: "Open task", actionType: "open_task", targetId: "t1" },
        ],
      });

      const response = await POST(
        buildRequest({
          question: "What did Stefan say about pricing?",
          meetingId: "m1",
          history: [
            { role: "user", text: "Summarize this meeting." },
            { role: "assistant", text: "The team discussed the redesign." },
          ],
        })
      );

      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.ok).toBe(true);
      expect(payload.data.answer).toBe(validMeetingFlowResult.answer);
      expect(payload.data.confidence).toBe("high");
      expect(payload.data.sources).toEqual([
        {
          sourceType: "transcript",
          sourceId: "m1",
          title: "Redesign kickoff",
          snippet: "12:30 - Stefan: The pricing feels too high for phase one.",
          timestamp: "12:30",
        },
      ]);
      expect(payload.data.suggestedActions).toEqual([
        {
          label: "Open the kickoff meeting",
          actionType: "open_meeting",
          targetId: "m1",
        },
      ]);

      // Meeting mode never runs workspace retrieval or the workspace flow.
      expect(mockedSearchWorkspaceContext).not.toHaveBeenCalled();
      expect(mockedAnswerWorkspaceQuestion).not.toHaveBeenCalled();

      expect(mockedAnswerMeetingQuestion).toHaveBeenCalledTimes(1);
      const [flowInput, flowMeta] = mockedAnswerMeetingQuestion.mock.calls[0];
      expect(flowInput.meetingId).toBe("m1");
      expect(flowInput.meetingTitle).toBe("Redesign kickoff");
      expect(flowInput.meetingDate).toBe("2026-06-28");
      expect(flowInput.transcript).toContain(
        "12:30 - Stefan: The pricing feels too high for phase one."
      );
      expect(flowInput.summary).toContain("Discussed redesign scope");
      expect(flowInput.history).toContain("User: Summarize this meeting.");
      expect(flowMeta).toMatchObject({ userId: "user-1" });
    });

    it("uses a transcript artifact when originalTranscript is missing", async () => {
      meetingsFindOne.mockResolvedValue({
        ...transcriptMeeting,
        originalTranscript: undefined,
        artifacts: [
          { type: "notes", processedText: "not a transcript" },
          {
            type: "transcript",
            processedText: "05:00 - Ana: We approved the budget.",
          },
        ],
      });

      const response = await POST(
        buildRequest({ question: "What was approved?", meetingId: "m1" })
      );

      expect(response.status).toBe(200);
      const [flowInput] = mockedAnswerMeetingQuestion.mock.calls[0];
      expect(flowInput.transcript).toContain(
        "05:00 - Ana: We approved the budget."
      );
    });

    it("returns a deterministic graceful answer when the meeting has no transcript or summary", async () => {
      meetingsFindOne.mockResolvedValue({
        _id: "m1",
        workspaceId: "workspace-1",
        userId: "user-1",
        title: "Silent meeting",
      });

      const response = await POST(
        buildRequest({ question: "What was decided?", meetingId: "m1" })
      );

      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.data.confidence).toBe("low");
      expect(payload.data.answer).toMatch(/transcript/i);
      expect(payload.data.sources).toEqual([]);
      expect(payload.data.suggestedActions).toEqual([
        { label: "Open meeting", actionType: "open_meeting", targetId: "m1" },
      ]);
      expect(mockedAnswerMeetingQuestion).not.toHaveBeenCalled();
      expect(mockedSearchWorkspaceContext).not.toHaveBeenCalled();
    });

    it("rejects a meeting from another workspace with 404 and no flow call", async () => {
      meetingsFindOne.mockResolvedValue({
        ...transcriptMeeting,
        workspaceId: "other-workspace",
      });

      const response = await POST(
        buildRequest({ question: "What did Stefan say?", meetingId: "m1" })
      );

      expect(response.status).toBe(404);
      expect(mockedAnswerMeetingQuestion).not.toHaveBeenCalled();
      expect(mockedAnswerWorkspaceQuestion).not.toHaveBeenCalled();
      expect(mockedSearchWorkspaceContext).not.toHaveBeenCalled();
    });

    it("rejects a legacy meeting owned by a non-member with 404", async () => {
      meetingsFindOne.mockResolvedValue({
        ...transcriptMeeting,
        workspaceId: undefined,
        userId: "stranger",
      });

      const response = await POST(
        buildRequest({ question: "What did Stefan say?", meetingId: "m1" })
      );

      expect(response.status).toBe(404);
      expect(mockedAnswerMeetingQuestion).not.toHaveBeenCalled();
    });

    it("returns 404 for hidden or missing meetings", async () => {
      meetingsFindOne.mockResolvedValue({
        ...transcriptMeeting,
        isHidden: true,
      });

      const response = await POST(
        buildRequest({ question: "anything?", meetingId: "m1" })
      );

      expect(response.status).toBe(404);
      expect(mockedAnswerMeetingQuestion).not.toHaveBeenCalled();
    });

    it("keeps a session with sourceMeetingId in meeting mode even when meetingId is omitted", async () => {
      chatSessionsFindOne.mockResolvedValue({
        _id: "s1",
        sourceMeetingId: "m1",
      });
      meetingsFindOne.mockResolvedValue(transcriptMeeting);

      const response = await POST(
        buildRequest({ question: "Who said that?", sessionId: "s1" })
      );

      expect(response.status).toBe(200);
      expect(chatSessionsFindOne).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user-1",
          $or: [{ _id: "s1" }, { id: "s1" }],
        }),
        expect.anything()
      );
      expect(mockedAnswerMeetingQuestion).toHaveBeenCalledTimes(1);
      expect(mockedSearchWorkspaceContext).not.toHaveBeenCalled();
      const [flowInput] = mockedAnswerMeetingQuestion.mock.calls[0];
      expect(flowInput.meetingId).toBe("m1");
    });

    it("degrades confidence and caveats when the model cites sources outside the meeting", async () => {
      meetingsFindOne.mockResolvedValue(transcriptMeeting);
      mockedAnswerMeetingQuestion.mockResolvedValue({
        answer: "Something from another meeting entirely.",
        confidence: "high",
        sources: [
          {
            sourceType: "transcript",
            sourceId: "not-this-meeting",
            title: "Elsewhere",
            snippet: "fake",
          },
        ],
        suggestedActions: [],
      });

      const response = await POST(
        buildRequest({ question: "what was decided?", meetingId: "m1" })
      );

      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.data.sources).toEqual([]);
      expect(payload.data.confidence).toBe("low");
      expect(payload.data.answer).toMatch(/could not verify/i);
    });
  });
});
