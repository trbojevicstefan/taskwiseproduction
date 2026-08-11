import { POST } from "@/app/api/ai/chat/route";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { resolveWorkspaceScopeForUser } from "@/lib/workspace-scope";
import { searchWorkspaceContext } from "@/lib/workspace-retrieval";
import { planWorkspaceChatQuestion } from "@/lib/chat-query-planner";
import { runInternalChatTool } from "@/lib/internal-chat-tools";
import { loadDurableChatMemory } from "@/lib/chat-memory";
import { assertChatScopeAccess } from "@/lib/chat-scope";
import { executeRegisteredMcpTool } from "@/lib/mcp-registry";
import { ApiRouteError } from "@/lib/api-route";
import { McpToolCallError } from "@/lib/mcp-read-tools";
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

jest.mock(
  "@/lib/chat-agent-runtime",
  () => ({ runScopedChatAgent: jest.fn() })
);

jest.mock("@/lib/chat-memory", () => ({
  loadDurableChatMemory: jest.fn(),
}));

jest.mock("@/lib/mcp-registry", () => {
  const actual = jest.requireActual("@/lib/mcp-registry");
  return {
    ...actual,
    executeRegisteredMcpTool: jest.fn(),
  };
});

jest.mock("@/lib/chat-scope", () => {
  const actual = jest.requireActual("@/lib/chat-scope");
  return {
    ...actual,
    assertChatScopeAccess: jest.fn(),
  };
});

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
const mockedRunScopedChatAgent = jest.requireMock(
  "@/lib/chat-agent-runtime"
).runScopedChatAgent as jest.Mock;
const mockedLoadDurableChatMemory =
  loadDurableChatMemory as jest.MockedFunction<typeof loadDurableChatMemory>;
const mockedAssertChatScopeAccess =
  assertChatScopeAccess as jest.MockedFunction<typeof assertChatScopeAccess>;
const mockedExecuteRegisteredMcpTool =
  executeRegisteredMcpTool as jest.MockedFunction<
    typeof executeRegisteredMcpTool
  >;
const mockedAnswerWorkspaceQuestion =
  answerWorkspaceQuestion as jest.MockedFunction<typeof answerWorkspaceQuestion>;
const mockedAnswerMeetingQuestion =
  answerMeetingQuestion as jest.MockedFunction<typeof answerMeetingQuestion>;

const meetingsFindOne = jest.fn();
const chatSessionsFindOne = jest.fn();
const tasksFindToArray = jest.fn();
const tasksFindLimit = jest.fn(() => ({ toArray: tasksFindToArray }));
const tasksFindSort = jest.fn(() => ({ limit: tasksFindLimit }));
const tasksFind = jest.fn(() => ({ sort: tasksFindSort }));
const tasksFindOne = jest.fn();
const tasksInsertOne = jest.fn();
const tasksUpdateOne = jest.fn();
const fakeDb = {
  collection: jest.fn((name: string) => {
    if (name === "meetings") return { findOne: meetingsFindOne };
    if (name === "chatSessions") return { findOne: chatSessionsFindOne };
    if (name === "tasks") {
      return {
        find: tasksFind,
        findOne: tasksFindOne,
        insertOne: tasksInsertOne,
        updateOne: tasksUpdateOne,
      };
    }
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
      sourceSessionId: "m1",
      score: 4,
    },
  ],
  people: [
    {
      id: "p1",
      name: "Stefan Ionescu",
      email: "stefan@example.com",
      personType: "client",
      openTaskCount: 2,
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
    mockedRunScopedChatAgent.mockResolvedValue(null);
    mockedLoadDurableChatMemory.mockResolvedValue({
      recentHistory: [],
      summary: null,
    });
    mockedAssertChatScopeAccess.mockImplementation(
      async ({ scope }) => scope as any
    );
    meetingsFindOne.mockResolvedValue(null);
    chatSessionsFindOne.mockResolvedValue(null);
    tasksFindToArray.mockResolvedValue([]);
    tasksFindOne.mockResolvedValue(null);
    tasksInsertOne.mockResolvedValue({ insertedId: "task-new" });
    tasksUpdateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    mockedExecuteRegisteredMcpTool.mockImplementation(
      async (_context, toolName, args) => ({
        toolName,
        summary: "Task command completed.",
        data: {
          task: {
            id: String(args?.taskId ?? "task-new"),
            title: String(args?.title ?? "Follow up with Casey"),
            status: String(args?.status ?? "todo"),
          },
        },
      })
    );
  });

  describe("scoped read agent", () => {
    it("returns a validated agent answer before workspace retrieval", async () => {
      mockedRunScopedChatAgent.mockResolvedValue(validFlowResult);

      const response = await POST(
        buildRequest({ question: "What did we decide about pricing?" })
      );

      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.data).toEqual(validFlowResult);
      expect(mockedRunScopedChatAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          db: fakeDb,
          workspaceId: "workspace-1",
          userId: "user-1",
          scope: { type: "workspace" },
          question: "What did we decide about pricing?",
        })
      );
      expect(mockedSearchWorkspaceContext).not.toHaveBeenCalled();
      expect(mockedAnswerWorkspaceQuestion).not.toHaveBeenCalled();
    });

    it("loads a workspace-visible teammate session and lets sourceMeetingId override payload scope", async () => {
      chatSessionsFindOne.mockResolvedValue({
        _id: "session-1",
        workspaceId: "workspace-1",
        userId: "user-2",
        sourceMeetingId: "m1",
      });
      mockedLoadDurableChatMemory.mockResolvedValue({
        recentHistory: [
          { role: "user", text: "Summarize the kickoff." },
          { role: "assistant", text: "The team discussed pricing." },
        ],
        summary: "Older grounded kickoff context.",
      });
      mockedRunScopedChatAgent.mockResolvedValue(validMeetingFlowResult);

      const response = await POST(
        buildRequest({
          question: "Who raised that concern?",
          sessionId: "session-1",
          scope: { type: "client", clientId: "client-1" },
          history: [{ role: "user", text: "The latest browser-only turn." }],
        })
      );

      expect(response.status).toBe(200);
      expect(mockedLoadDurableChatMemory).toHaveBeenCalledWith({
        db: fakeDb,
        userId: "user-1",
        workspaceId: "workspace-1",
        sessionId: "session-1",
        memberUserIds: ["user-1", "user-2"],
      });
      expect(chatSessionsFindOne).toHaveBeenCalledWith(
        {
          $and: [
            { $or: [{ _id: "session-1" }, { id: "session-1" }] },
            {
              $or: [
                { workspaceId: "workspace-1" },
                {
                  workspaceId: { $exists: false },
                  userId: { $in: ["user-1", "user-2"] },
                },
              ],
            },
          ],
        },
        { projection: { sourceMeetingId: 1, scope: 1 } }
      );
      expect(mockedRunScopedChatAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          scope: { type: "meeting", meetingId: "m1" },
          memorySummary: "Older grounded kickoff context.",
          history: [
            { role: "user", text: "Summarize the kickoff." },
            { role: "assistant", text: "The team discussed pricing." },
            { role: "user", text: "The latest browser-only turn." },
          ],
        })
      );
      expect(mockedAnswerMeetingQuestion).not.toHaveBeenCalled();
      expect(mockedSearchWorkspaceContext).not.toHaveBeenCalled();
    });

    it("rejects a cross-workspace session before reading scope or invoking the agent", async () => {
      mockedLoadDurableChatMemory.mockRejectedValue(
        new ApiRouteError(
          404,
          "chat_session_not_found",
          "Chat session was not found."
        )
      );

      const response = await POST(
        buildRequest({
          question: "What happened?",
          sessionId: "other-workspace-session",
        })
      );

      expect(response.status).toBe(404);
      expect(chatSessionsFindOne).not.toHaveBeenCalled();
      expect(mockedRunScopedChatAgent).not.toHaveBeenCalled();
    });

    it("rejects a non-member before loading any persisted session", async () => {
      mockedResolveScope.mockRejectedValue(
        new ApiRouteError(403, "workspace_forbidden", "Workspace access denied.")
      );

      const response = await POST(
        buildRequest({ question: "What happened?", sessionId: "session-1" })
      );

      expect(response.status).toBe(403);
      expect(mockedLoadDurableChatMemory).not.toHaveBeenCalled();
      expect(chatSessionsFindOne).not.toHaveBeenCalled();
    });

    it.each([
      [
        "workspace",
        { type: "workspace" } as const,
        { type: "client", clientId: "client-request" } as const,
      ],
      [
        "client",
        { type: "client", clientId: "client-persisted" } as const,
        { type: "person", personId: "person-request" } as const,
      ],
      [
        "person",
        { type: "person", personId: "person-persisted" } as const,
        { type: "planner" } as const,
      ],
      [
        "planner",
        { type: "planner" } as const,
        { type: "workspace" } as const,
      ],
    ])(
      "uses persisted %s session scope instead of a swapped request scope",
      async (_label, persistedScope, requestScope) => {
        chatSessionsFindOne.mockResolvedValue({
          _id: "session-1",
          workspaceId: "workspace-1",
          userId: "user-1",
          sourceMeetingId: null,
          scope: persistedScope,
        });
        mockedRunScopedChatAgent.mockResolvedValue(validFlowResult);

        const response = await POST(
          buildRequest({
            question: "What is in scope?",
            sessionId: "session-1",
            scope: requestScope,
          })
        );

        expect(response.status).toBe(200);
        expect(mockedAssertChatScopeAccess).toHaveBeenCalledWith(
          expect.objectContaining({ scope: persistedScope })
        );
        expect(mockedRunScopedChatAgent).toHaveBeenCalledWith(
          expect.objectContaining({ scope: persistedScope })
        );
      }
    );

    it("fails closed to the persisted legacy workspace scope instead of adopting a request entity", async () => {
      chatSessionsFindOne.mockResolvedValue({
        _id: "session-legacy",
        workspaceId: "workspace-1",
        userId: "user-1",
      });
      mockedRunScopedChatAgent.mockResolvedValue(validFlowResult);

      const response = await POST(
        buildRequest({
          question: "What is in scope?",
          sessionId: "session-legacy",
          scope: { type: "person", personId: "person-request" },
        })
      );

      expect(response.status).toBe(200);
      expect(mockedRunScopedChatAgent).toHaveBeenCalledWith(
        expect.objectContaining({ scope: { type: "workspace" } })
      );
    });

    it("preserves repeated ordered turns while merging the latest twelve history entries", async () => {
      chatSessionsFindOne.mockResolvedValue({
        _id: "session-1",
        workspaceId: "workspace-1",
        userId: "user-1",
      });
      const repeatedTurns = [
        { role: "user" as const, text: "Please repeat that." },
        { role: "assistant" as const, text: "First acknowledgement." },
        { role: "user" as const, text: "Please repeat that." },
      ];
      mockedLoadDurableChatMemory.mockResolvedValue({
        recentHistory: repeatedTurns,
        summary: null,
      });
      mockedRunScopedChatAgent.mockResolvedValue(validFlowResult);

      const response = await POST(
        buildRequest({
          question: "What happened next?",
          sessionId: "session-1",
          history: [
            { role: "assistant", text: "Second acknowledgement." },
          ],
        })
      );

      expect(response.status).toBe(200);
      expect(mockedRunScopedChatAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          history: [
            ...repeatedTurns,
            { role: "assistant", text: "Second acknowledgement." },
          ],
        })
      );
    });

    it("applies meeting source and action filters to the agent result", async () => {
      mockedRunScopedChatAgent.mockResolvedValue({
        ...validMeetingFlowResult,
        sources: [
          ...validMeetingFlowResult.sources,
          {
            sourceType: "transcript",
            sourceId: "other-meeting",
            title: "Other meeting",
            snippet: "Not in scope",
          },
        ],
        suggestedActions: [
          ...validMeetingFlowResult.suggestedActions,
          {
            label: "Open other",
            actionType: "open_meeting",
            targetId: "other-meeting",
          },
        ],
      });

      const response = await POST(
        buildRequest({
          question: "What did Stefan say?",
          scope: { type: "meeting", meetingId: "m1" },
        })
      );

      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.data.sources).toEqual(validMeetingFlowResult.sources);
      expect(payload.data.suggestedActions).toEqual(
        validMeetingFlowResult.suggestedActions
      );
      expect(mockedAnswerMeetingQuestion).not.toHaveBeenCalled();
    });

    it("retains canonical meeting evidence when the request used a legacy meeting id", async () => {
      meetingsFindOne.mockResolvedValue({
        ...transcriptMeeting,
        _id: "canonical-meeting-id",
        id: "legacy-meeting-id",
      });
      const canonicalAnswer = {
        ...validMeetingFlowResult,
        sources: validMeetingFlowResult.sources.map((source) => ({
          ...source,
          sourceId: "canonical-meeting-id",
        })),
        suggestedActions: validMeetingFlowResult.suggestedActions.map((action) => ({
          ...action,
          targetId: "canonical-meeting-id",
        })),
      };
      mockedRunScopedChatAgent.mockResolvedValue(canonicalAnswer);

      const response = await POST(
        buildRequest({
          question: "What did Stefan say?",
          scope: { type: "meeting", meetingId: "legacy-meeting-id" },
        })
      );

      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.data).toEqual(canonicalAnswer);
      expect(meetingsFindOne).toHaveBeenCalled();
    });

    it("validates entity scope before invoking the agent", async () => {
      mockedAssertChatScopeAccess.mockRejectedValue(
        new ApiRouteError(
          404,
          "chat_scope_not_found",
          "Chat scope was not found."
        )
      );

      const response = await POST(
        buildRequest({
          question: "What are the client commitments?",
          scope: { type: "client", clientId: "other-client" },
        })
      );

      expect(response.status).toBe(404);
      expect(mockedRunScopedChatAgent).not.toHaveBeenCalled();
      expect(mockedSearchWorkspaceContext).not.toHaveBeenCalled();
    });

    it("does not let a history follow-up escape an explicit entity scope", async () => {
      mockedRunScopedChatAgent.mockResolvedValue({
        answer: "The scoped client evidence is not conclusive.",
        confidence: "low",
        sources: [],
        suggestedActions: [],
      });

      const response = await POST(
        buildRequest({
          question: "Who attended the first one?",
          scope: { type: "client", clientId: "client-1" },
          history: [
            {
              role: "assistant",
              text: "You had two meetings.",
              sources: [
                {
                  sourceType: "meeting",
                  sourceId: "m1",
                  title: "Kickoff",
                  snippet: "Kickoff",
                },
                {
                  sourceType: "meeting",
                  sourceId: "m2",
                  title: "Planning",
                  snippet: "Planning",
                },
              ],
            },
          ],
        })
      );

      expect(response.status).toBe(200);
      expect(mockedRunScopedChatAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          scope: { type: "client", clientId: "client-1" },
        })
      );
    });

    it("keeps the existing retrieval path when the agent returns null", async () => {
      mockedRunScopedChatAgent.mockResolvedValue(null);

      const response = await POST(
        buildRequest({ question: "What did we decide about pricing?" })
      );

      expect(response.status).toBe(200);
      expect(mockedRunScopedChatAgent).toHaveBeenCalledTimes(1);
      expect(mockedSearchWorkspaceContext).toHaveBeenCalledTimes(1);
      expect(mockedAnswerWorkspaceQuestion).toHaveBeenCalledTimes(1);
    });
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
      expect.objectContaining({
        adminVisibilityKey: "chatSessions",
        includeMemberUserIds: true,
      })
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

  it("returns a deterministic count answer when tool context exists but the model gives no grounded answer", async () => {
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
      answer: "I am not sure.",
      confidence: "low",
      sources: [],
      suggestedActions: [],
    });

    const response = await POST(
      buildRequest({ question: "How many meetings did we have this week?" })
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.data.answer).toMatch(/3 meetings?/i);
    expect(payload.data.confidence).toBe("high");
  });

  it("prefers deterministic meeting counts over confident source-less model misses", async () => {
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
      summary: "Agenda 2026-07-06 -> 2026-07-12: 3 meeting(s).",
      contextBlocks: [
        "AGENDA_RANGE 2026-07-06T00:00:00.000Z | 2026-07-12T23:59:59.999Z",
        "MEETING m1 | Discovery A | 2026-07-06 | attendees=3 | clientMeeting=false",
        "MEETING m2 | Discovery B | 2026-07-06 | attendees=3 | clientMeeting=false",
        "MEETING m3 | Discovery C | 2026-07-06 | attendees=3 | clientMeeting=false",
      ].join("\n"),
    });
    mockedAnswerWorkspaceQuestion.mockResolvedValue({
      answer: "There are no meetings recorded for this week.",
      confidence: "high",
      sources: [],
      suggestedActions: [],
    });

    const response = await POST(
      buildRequest({ question: "How many meetings did we have this week?" })
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.data.answer).toMatch(/3 meetings?/i);
    expect(payload.data.confidence).toBe("high");
  });

  it("answers weekly meeting overviews with titles, links, and attendees", async () => {
    mockedPlanWorkspaceChatQuestion.mockReturnValue({
      mode: "workspace_tool",
      toolName: "get_calendar_agenda",
      toolArgs: {
        from: "2026-07-06T00:00:00.000Z",
        to: "2026-07-12T23:59:59.999Z",
      },
      rationale: "weekly_meetings_overview",
    });
    mockedRunInternalChatTool.mockResolvedValue({
      summary: "Agenda 2026-07-06 -> 2026-07-12: 2 meeting(s).",
      contextBlocks: [
        "AGENDA_RANGE 2026-07-06T00:00:00.000Z | 2026-07-12T23:59:59.999Z",
        "MEETING m1 | Discovery A | 2026-07-06 | link=/meetings/m1 | attendees=Casey Client <casey@client.com>, Ana Admin | attendeeCount=2 | clientMeeting=true",
        "MEETING m2 | Planning B | 2026-07-07 | link=/meetings/m2 | attendees=Stefan Ionescu | attendeeCount=1 | clientMeeting=false",
      ].join("\n"),
      answerHint:
        "Use the agenda rows to answer operational questions deterministically.",
    });
    mockedAnswerWorkspaceQuestion.mockResolvedValue({
      answer: "You had some meetings this week.",
      confidence: "high",
      sources: [],
      suggestedActions: [],
    });

    const response = await POST(
      buildRequest({ question: "What meetings did we have this week?" })
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.data.answer).toContain("You had 2 meetings this week");
    expect(payload.data.answer).toContain("Discovery A");
    expect(payload.data.answer).toContain("/meetings/m1");
    expect(payload.data.answer).toContain("Casey Client <casey@client.com>");
    expect(payload.data.answer).toContain("Planning B");
    expect(payload.data.answer).toContain("/meetings/m2");
    expect(payload.data.sources).toEqual([
      expect.objectContaining({
        sourceType: "meeting",
        sourceId: "m1",
        title: "Discovery A",
      }),
      expect.objectContaining({
        sourceType: "meeting",
        sourceId: "m2",
        title: "Planning B",
      }),
    ]);
    expect(payload.data.suggestedActions).toEqual([
      { label: "Open Discovery A", actionType: "open_meeting", targetId: "m1" },
      { label: "Open Planning B", actionType: "open_meeting", targetId: "m2" },
    ]);
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
    expect(flowInput.contextBlocks).toContain(
      "MEETING m1 | Redesign kickoff | 2026-06-28 | link=/meetings/m1"
    );
    expect(flowInput.contextBlocks).toContain("SUMMARY: Discussed redesign scope");
    expect(flowInput.contextBlocks).toContain("[12:30]");
    expect(flowInput.contextBlocks).toContain(
      "TASK t1 | Send updated proposal | status=todo | due=2026-06-30 | assignee=Stefan | sourceMeeting=/meetings/m1 | OVERDUE"
    );
    expect(flowInput.contextBlocks).toContain(
      "PERSON p1 | Stefan Ionescu | client | stefan@example.com | openTasks=2"
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

  it("routes a grounded 'first one' follow-up into meeting mode", async () => {
    meetingsFindOne.mockResolvedValue(transcriptMeeting);

    const response = await POST(
      buildRequest({
        question: "Who attended the first one?",
        history: [
          {
            role: "assistant",
            text: "You had 2 meetings this week.",
            sources: [
              {
                sourceType: "meeting",
                sourceId: "m1",
                title: "Redesign kickoff",
                snippet: "Kickoff",
              },
              {
                sourceType: "meeting",
                sourceId: "m2",
                title: "Planning B",
                snippet: "Planning",
              },
            ],
          },
        ],
      })
    );

    expect(response.status).toBe(200);
    expect(mockedAnswerMeetingQuestion).toHaveBeenCalledTimes(1);
    expect(mockedSearchWorkspaceContext).not.toHaveBeenCalled();
    const [flowInput] = mockedAnswerMeetingQuestion.mock.calls[0];
    expect(flowInput.meetingId).toBe("m1");
  });

  it("enriches retrieval for person follow-ups using the last grounded person", async () => {
    const response = await POST(
      buildRequest({
        question: "What tasks does he own?",
        history: [
          {
            role: "assistant",
            text: "Stefan raised pricing concerns.",
            sources: [
              {
                sourceType: "person",
                sourceId: "p1",
                title: "Stefan Ionescu",
                snippet: "Stefan Ionescu",
              },
            ],
          },
        ],
      })
    );

    expect(response.status).toBe(200);
    expect(mockedSearchWorkspaceContext).toHaveBeenCalledTimes(1);
    const retrievalQuery = mockedSearchWorkspaceContext.mock.calls[0][2];
    expect(retrievalQuery).toContain("Stefan Ionescu");
    expect(retrievalQuery).toContain("What tasks does he own?");
  });

  it("refuses ambiguous grounded meeting follow-ups instead of guessing", async () => {
    const response = await POST(
      buildRequest({
        question: "What happened in that meeting?",
        history: [
          {
            role: "assistant",
            text: "You had 2 meetings this week.",
            sources: [
              {
                sourceType: "meeting",
                sourceId: "m1",
                title: "Redesign kickoff",
                snippet: "Kickoff",
              },
              {
                sourceType: "meeting",
                sourceId: "m2",
                title: "Planning B",
                snippet: "Planning",
              },
            ],
          },
        ],
      })
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.data.confidence).toBe("low");
    expect(payload.data.answer).toMatch(/which meeting/i);
    expect(mockedAnswerMeetingQuestion).not.toHaveBeenCalled();
  });

  it("expands workspace retrieval with recent history for follow-up questions", async () => {
    const response = await POST(
      buildRequest({
        question: "Who attended the first one?",
        history: [
          { role: "user", text: "What meetings did we have this week?" },
          {
            role: "assistant",
            text:
              "You had 2 meetings this week:\n- Redesign kickoff (2026-07-07) - /meetings/m1 - attendees: Ana Admin, Casey Client\n- Planning B (2026-07-08) - /meetings/m2 - attendees: Stefan",
          },
        ],
      })
    );

    expect(response.status).toBe(200);
    const retrievalQuery = mockedSearchWorkspaceContext.mock.calls[0][2];
    expect(retrievalQuery).toContain("Who attended the first one?");
    expect(retrievalQuery).toContain("Redesign kickoff");
    expect(retrievalQuery).toContain("Ana Admin");
    const [flowInput] = mockedAnswerWorkspaceQuestion.mock.calls[0];
    expect(flowInput.question).toBe("Who attended the first one?");
  });

  it("creates a workspace task from an explicit chat command without calling the LLM", async () => {
    const response = await POST(
      buildRequest({ question: "Create a task to follow up with Casey" })
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.data.answer).toContain('Created task "Follow up with Casey"');
    expect(payload.data.sources).toEqual([
      expect.objectContaining({
        sourceType: "task",
        sourceId: expect.any(String),
        title: "Follow up with Casey",
      }),
    ]);
    expect(payload.data.suggestedActions).toEqual([
      expect.objectContaining({
        actionType: "open_task",
        targetId: expect.any(String),
      }),
    ]);
    expect(mockedExecuteRegisteredMcpTool).toHaveBeenCalledWith(
      { db: fakeDb, workspaceId: "workspace-1" },
      "create_task",
      {
        ownerUserId: "user-1",
        title: "Follow up with Casey",
        description: undefined,
        dueAt: null,
      }
    );
    expect(tasksInsertOne).not.toHaveBeenCalled();
    expect(mockedSearchWorkspaceContext).not.toHaveBeenCalled();
    expect(mockedAnswerWorkspaceQuestion).not.toHaveBeenCalled();
  });

  it("creates a contextual task from a typo-heavy follow-up instead of retrieving unrelated meetings", async () => {
    const response = await POST(
      buildRequest({
        question: "createt me thtat task step by step",
        history: [
          { role: "user", text: "how can i make pancakes" },
          {
            role: "assistant",
            text:
              "I don't have information on how to make pancakes. You might want to check a cooking resource or recipe website.",
          },
        ],
      })
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.data.answer).toContain('Created task "Make pancakes"');
    expect(mockedExecuteRegisteredMcpTool).toHaveBeenCalledWith(
      { db: fakeDb, workspaceId: "workspace-1" },
      "create_task",
      {
        ownerUserId: "user-1",
        title: "Make pancakes",
        description: expect.stringContaining("how can i make pancakes"),
        dueAt: null,
      }
    );
    expect(tasksInsertOne).not.toHaveBeenCalled();
    expect(mockedSearchWorkspaceContext).not.toHaveBeenCalled();
    expect(mockedAnswerWorkspaceQuestion).not.toHaveBeenCalled();
  });

  it("edits a single matched workspace task from an explicit chat command", async () => {
    tasksFindToArray.mockResolvedValue([
      {
        _id: "task-1",
        title: "Follow up with Casey",
        status: "todo",
        workspaceId: "workspace-1",
        userId: "user-1",
      },
    ]);
    mockedExecuteRegisteredMcpTool.mockResolvedValue({
      toolName: "update_task_status",
      summary: "Updated status to done.",
      data: {
        task: {
          id: "task-1",
          title: "Follow up with Casey",
          status: "done",
          workspaceId: "workspace-1",
          userId: "user-1",
          lastUpdated: "2026-07-08T12:00:00.000Z",
        },
      },
    });

    const response = await POST(
      buildRequest({ question: "Set task Follow up with Casey to done" })
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.data.answer).toContain(
      'Updated task "Follow up with Casey"'
    );
    expect(mockedExecuteRegisteredMcpTool).toHaveBeenCalledWith(
      { db: fakeDb, workspaceId: "workspace-1" },
      "update_task_status",
      { taskId: "task-1", status: "done" }
    );
    expect(tasksUpdateOne).not.toHaveBeenCalled();
    expect(mockedSearchWorkspaceContext).not.toHaveBeenCalled();
    expect(mockedAnswerWorkspaceQuestion).not.toHaveBeenCalled();
  });

  it("maps a typed task-tool rejection to a safe chat clarification", async () => {
    tasksFindToArray.mockResolvedValue([
      {
        _id: "task-1",
        title: "Follow up with Casey",
        status: "todo",
        workspaceId: "workspace-1",
        userId: "user-1",
      },
    ]);
    mockedExecuteRegisteredMcpTool.mockRejectedValue(
      new McpToolCallError("invalid_arguments", "Task not found.")
    );

    const response = await POST(
      buildRequest({ question: "Set task Follow up with Casey to done" })
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.data.confidence).toBe("low");
    expect(payload.data.answer).toMatch(/couldn't confirm|didn't change/i);
    expect(mockedRunScopedChatAgent).not.toHaveBeenCalled();
    expect(mockedSearchWorkspaceContext).not.toHaveBeenCalled();
  });

  it("refuses ambiguous chat task edits instead of mutating multiple matches", async () => {
    tasksFindToArray.mockResolvedValue([
      { _id: "task-1", title: "Follow up with Casey", status: "todo" },
      { _id: "task-2", title: "Follow up with Casey at Acme", status: "todo" },
    ]);

    const response = await POST(
      buildRequest({ question: "Mark task Casey done" })
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.data.confidence).toBe("low");
    expect(payload.data.answer).toMatch(/I found multiple matching tasks/i);
    expect(tasksUpdateOne).not.toHaveBeenCalled();
    expect(mockedExecuteRegisteredMcpTool).not.toHaveBeenCalled();
    expect(mockedSearchWorkspaceContext).not.toHaveBeenCalled();
  });

  it("resolves a selected source task id and edits the canonical task before the agent", async () => {
    tasksFindToArray.mockResolvedValue([
      {
        _id: "task-canonical",
        sourceTaskId: "task-source",
        title: "Follow up with Casey",
        status: "todo",
        workspaceId: "workspace-1",
        userId: "user-1",
      },
    ]);
    mockedExecuteRegisteredMcpTool.mockResolvedValue({
      toolName: "update_task_status",
      summary: "Updated status to done.",
      data: {
        task: {
          id: "task-canonical",
          title: "Follow up with Casey",
          status: "done",
        },
      },
    });

    const response = await POST(
      buildRequest({
        question: "Mark the selected task done",
        selectedTaskIds: ["task-source"],
      })
    );

    expect(response.status).toBe(200);
    expect(mockedExecuteRegisteredMcpTool).toHaveBeenCalledWith(
      { db: fakeDb, workspaceId: "workspace-1" },
      "update_task_status",
      { taskId: "task-canonical", status: "done" }
    );
    expect(mockedRunScopedChatAgent).not.toHaveBeenCalled();
    expect(mockedSearchWorkspaceContext).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "multiple selected tasks",
      body: {
        question: "Mark the selected task done",
        selectedTaskIds: ["task-1", "task-2"],
      },
    },
    {
      label: "an out-of-scope selected id",
      body: {
        question: "Mark the selected task done",
        selectedTaskIds: ["other-workspace-task"],
      },
    },
    {
      label: "destructive language",
      body: {
        question: "Delete the selected task",
        selectedTaskIds: ["task-1"],
      },
    },
    {
      label: "bulk language",
      body: { question: "Mark all tasks done" },
    },
  ])("clarifies $label with zero writes and no agent call", async ({ body }) => {
    tasksFindOne.mockResolvedValue(null);

    const response = await POST(buildRequest(body));

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.data.confidence).toBe("low");
    expect(mockedExecuteRegisteredMcpTool).not.toHaveBeenCalled();
    expect(tasksInsertOne).not.toHaveBeenCalled();
    expect(tasksUpdateOne).not.toHaveBeenCalled();
    expect(mockedRunScopedChatAgent).not.toHaveBeenCalled();
    expect(mockedSearchWorkspaceContext).not.toHaveBeenCalled();
  });

  it("creates a meeting-scoped task through create_task_from_meeting", async () => {
    mockedAssertChatScopeAccess.mockResolvedValue({
      type: "meeting",
      meetingId: "meeting-canonical",
    });
    mockedExecuteRegisteredMcpTool.mockResolvedValue({
      toolName: "create_task_from_meeting",
      summary: "Created meeting task.",
      data: {
        task: {
          id: "task-meeting",
          title: "Send meeting notes",
          status: "todo",
        },
      },
    });

    const response = await POST(
      buildRequest({
        question: "Create a task to send meeting notes",
        meetingId: "meeting-alias",
      })
    );

    expect(response.status).toBe(200);
    expect(mockedExecuteRegisteredMcpTool).toHaveBeenCalledWith(
      { db: fakeDb, workspaceId: "workspace-1" },
      "create_task_from_meeting",
      {
        meetingId: "meeting-canonical",
        title: "Send meeting notes",
        description: undefined,
        dueAt: undefined,
      }
    );
    expect(mockedRunScopedChatAgent).not.toHaveBeenCalled();
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

    it("uses the grounded meeting fallback path for decision questions when the scoped agent is unavailable", async () => {
      meetingsFindOne.mockResolvedValue({
        ...transcriptMeeting,
        title: "Launch decisions",
        summary:
          "The team selected a staged rollout and agreed Ana would prepare the launch checklist.",
        originalTranscript:
          "00:01 - Speaker: Yeah.\n00:03 - Speaker: I had to restart.",
      });
      mockedRunScopedChatAgent.mockResolvedValue(null);
      mockedAnswerMeetingQuestion.mockResolvedValue({
        answer:
          "The meeting summary says the team selected a staged rollout and agreed Ana would prepare the launch checklist.",
        confidence: "low",
        sources: [
          {
            sourceType: "meeting",
            sourceId: "m1",
            title: "Launch decisions",
            snippet:
              "The team selected a staged rollout and agreed Ana would prepare the launch checklist.",
          },
        ],
        suggestedActions: [],
      });

      const response = await POST(
        buildRequest({
          question: "What were the key decisions made in this meeting?",
          meetingId: "m1",
        })
      );

      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.data.answer).toContain("selected a staged rollout");
      expect(payload.data.answer).not.toMatch(/Yeah|restart/i);
      expect(payload.data.sources).toEqual([
        expect.objectContaining({
          sourceType: "meeting",
          sourceId: "m1",
          title: "Launch decisions",
        }),
      ]);
      expect(mockedRunScopedChatAgent).toHaveBeenCalledTimes(1);
      expect(mockedAnswerMeetingQuestion).toHaveBeenCalledWith(
        expect.objectContaining({
          question: "What were the key decisions made in this meeting?",
          meetingId: "m1",
          summary: expect.stringContaining("selected a staged rollout"),
        }),
        expect.objectContaining({ userId: "user-1" })
      );
      expect(mockedSearchWorkspaceContext).not.toHaveBeenCalled();
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
        {
          $and: [
            { $or: [{ _id: "s1" }, { id: "s1" }] },
            {
              $or: [
                { workspaceId: "workspace-1" },
                {
                  workspaceId: { $exists: false },
                  userId: { $in: ["user-1", "user-2"] },
                },
              ],
            },
          ],
        },
        { projection: { sourceMeetingId: 1, scope: 1 } }
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
