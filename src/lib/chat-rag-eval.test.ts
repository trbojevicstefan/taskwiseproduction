import { CHAT_RAG_EVAL_CASE_IDS } from "../../scripts/eval-chat-rag";
import { runScopedChatAgent } from "@/lib/chat-agent-runtime";
import { loadDurableChatMemory } from "@/lib/chat-memory";
import {
  planChatTaskCommand,
  runChatTaskCommand,
  type ChatTaskCommand,
} from "@/lib/chat-task-commands";
import { executeRegisteredMcpTool, listRegisteredMcpTools } from "@/lib/mcp-registry";
import {
  getOpenAiReadToolsForScope,
  prepareScopedMcpToolCall,
} from "@/lib/openai-responses-tools";
import { searchWorkspaceContext } from "@/lib/workspace-retrieval";
import { listActiveWorkspaceMembershipsForWorkspace } from "@/lib/workspace-memberships";
import type { ChatHistoryEntry, ChatScope, GeneralChatAnswer } from "@/types/general-chat";

jest.mock("@/lib/workspace-retrieval", () => ({
  searchWorkspaceContext: jest.fn(),
}));

jest.mock("@/lib/workspace-memberships", () => ({
  listActiveWorkspaceMembershipsForWorkspace: jest.fn(),
}));

const searchMock = searchWorkspaceContext as jest.MockedFunction<
  typeof searchWorkspaceContext
>;
const membershipsMock =
  listActiveWorkspaceMembershipsForWorkspace as jest.MockedFunction<
    typeof listActiveWorkspaceMembershipsForWorkspace
  >;
const originalFetch = global.fetch;
const originalApiKey = process.env.OPENAI_API_KEY;
type EvalCaseId = (typeof CHAT_RAG_EVAL_CASE_IDS)[number];
const executedEvalCases = new Map<EvalCaseId, number>();

const recordExecutedEvalCases = (...caseIds: EvalCaseId[]) => {
  for (const caseId of caseIds) {
    executedEvalCases.set(caseId, (executedEvalCases.get(caseId) ?? 0) + 1);
  }
};

const emptyKnowledge = {
  meetings: [],
  tasks: [],
  people: [],
  isEmpty: true,
};

const cursor = (documents: any[]) => {
  let rows = [...documents];
  const value: any = {};
  value.sort = jest.fn(() => value);
  value.limit = jest.fn((limit: number) => {
    rows = rows.slice(0, limit);
    return value;
  });
  value.project = jest.fn(() => value);
  value.toArray = jest.fn(async () => rows);
  return value;
};

const collectNestedStrings = (value: unknown, key: string): string[] => {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectNestedStrings(item, key));
  }
  return Object.entries(value as Record<string, unknown>).flatMap(
    ([entryKey, entryValue]) => [
      ...(entryKey === key && typeof entryValue === "string" ? [entryValue] : []),
      ...collectNestedStrings(entryValue, key),
    ]
  );
};

const makeKnowledgeDb = ({
  meetings = [] as any[],
  people = [] as any[],
  relatedPeople = people as any[],
  companies = [] as any[],
} = {}) => {
  const findByIdentifier = (documents: any[], filter: any) => {
    const ids = [
      ...collectNestedStrings(filter, "_id"),
      ...collectNestedStrings(filter, "id"),
    ];
    const workspaceIds = collectNestedStrings(filter, "workspaceId");
    return (
      documents.find((document) => {
        const documentId = String(document?._id ?? document?.id ?? "");
        return (
          (!ids.length || ids.includes(documentId)) &&
          (!workspaceIds.length || workspaceIds.includes(document.workspaceId))
        );
      }) ?? null
    );
  };
  const collections: Record<string, any> = {
    meetings: {
      findOne: jest.fn(async (filter: any) => findByIdentifier(meetings, filter)),
    },
    people: {
      findOne: jest.fn(async (filter: any) => findByIdentifier(people, filter)),
      find: jest.fn((_filter: any, options?: any) =>
        cursor(options?.projection ? people : relatedPeople)
      ),
    },
    companies: {
      findOne: jest.fn(async (filter: any) => findByIdentifier(companies, filter)),
      find: jest.fn(() => cursor(companies)),
    },
  };
  return {
    collection: jest.fn((name: string) => collections[name]),
  } as any;
};

const jsonResponse = (payload: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  );

const answer = (
  answerText: string,
  sources: GeneralChatAnswer["sources"] = [],
  confidence: GeneralChatAnswer["confidence"] = sources.length ? "high" : "low"
): GeneralChatAnswer => ({
  answer: answerText,
  confidence,
  sources,
  suggestedActions: [],
});

const functionCall = (query: string, callId = "call-1") => ({
  type: "function_call",
  call_id: callId,
  name: "search_workspace_knowledge",
  arguments: JSON.stringify({ query }),
});

const setProviderScript = (
  query: string,
  finalAnswer: GeneralChatAnswer
) => {
  const fetchMock = jest
    .fn()
    .mockImplementationOnce(() =>
      jsonResponse({ id: "response-1", output: [functionCall(query)] })
    )
    .mockImplementationOnce(() =>
      jsonResponse({
        id: "response-2",
        output_text: JSON.stringify(finalAnswer),
        output: [],
      })
    );
  global.fetch = fetchMock as any;
  return fetchMock;
};

const runAgent = (input: {
  question: string;
  scope?: ChatScope;
  history?: ChatHistoryEntry[];
  memorySummary?: string | null;
  db?: any;
}) =>
  runScopedChatAgent({
    db: input.db ?? makeKnowledgeDb(),
    workspaceId: "workspace-1",
    userId: "user-1",
    scope: input.scope ?? { type: "workspace" },
    question: input.question,
    history: input.history ?? [],
    memorySummary: input.memorySummary,
    today: "2026-08-11",
  });

const sameNameEvidence = {
  meetings: [
    {
      id: "meeting-allowed",
      title: "Allowed meeting",
      startTime: null,
      summarySnippet: "Allowed evidence",
      transcriptSnippets: [],
      attendeeIds: ["person-allowed"],
      attendeeEmails: ["alex.allowed@example.com"],
      score: 8,
    },
    {
      id: "meeting-collision",
      title: "Collision meeting",
      startTime: null,
      summarySnippet: "Unrelated evidence",
      transcriptSnippets: [],
      attendeeIds: ["person-collision"],
      attendeeEmails: ["alex.collision@example.com"],
      score: 9,
    },
  ],
  tasks: [
    {
      id: "task-allowed",
      title: "Allowed follow-up",
      status: "todo",
      dueAt: "2026-08-14T10:00:00.000Z",
      assigneeName: "Alex Morgan",
      assigneeId: "person-allowed",
      assigneeEmail: "alex.allowed@example.com",
      overdue: false,
      sourceSessionId: "meeting-allowed",
      score: 4,
    },
    {
      id: "task-collision",
      title: "Unrelated follow-up",
      status: "todo",
      dueAt: "2026-08-15T10:00:00.000Z",
      assigneeName: "Alex Morgan",
      assigneeId: "person-collision",
      assigneeEmail: "alex.collision@example.com",
      overdue: false,
      sourceSessionId: "meeting-collision",
      score: 5,
    },
  ],
  people: [
    {
      id: "person-allowed",
      name: "Alex Morgan",
      email: "alex.allowed@example.com",
      personType: "client",
      score: 3,
    },
    {
      id: "person-collision",
      name: "Alex Morgan",
      email: "alex.collision@example.com",
      personType: "client",
      score: 3,
    },
  ],
  isEmpty: false,
} as any;

describe("unified chat deterministic RAG release corpus", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.OPENAI_API_KEY = "offline-eval-key";
    membershipsMock.mockResolvedValue([
      { workspaceId: "workspace-1", userId: "user-1", status: "active" },
    ] as any);
    searchMock.mockResolvedValue(emptyKnowledge);
  });

  afterAll(() => {
    global.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalApiKey;
    expect([...executedEvalCases.keys()].sort()).toEqual(
      [...CHAT_RAG_EVAL_CASE_IDS].sort()
    );
  });

  it("keeps the binding release corpus uniquely named", () => {
    expect(new Set(CHAT_RAG_EVAL_CASE_IDS).size).toBe(
      CHAT_RAG_EVAL_CASE_IDS.length
    );
  });

  it.each([
    {
      language: "English",
      question: "What did we decide about the renewal?",
      query: "renewal decision",
    },
    {
      language: "Serbian",
      question: "Šta smo odlučili o produženju ugovora?",
      query: "odluka o produženju ugovora",
    },
  ])("routes $language through the real scoped knowledge contract", async ({ question, query }) => {
    setProviderScript(query, answer("No grounded decision was found."));

    await expect(runAgent({ question })).resolves.toMatchObject({ confidence: "low" });
    expect(searchMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ workspaceId: "workspace-1" }),
      query,
      expect.objectContaining({ plannerBias: false })
    );
    expect(JSON.stringify((global.fetch as jest.Mock).mock.calls[0][1].body)).toContain(
      question
    );
    recordExecutedEvalCases("serbian-and-english-routing");
  });

  it("compares all meetings and preserves contradictory evidence as separate citations", async () => {
    searchMock.mockResolvedValue({
      meetings: [
        {
          id: "meeting-1",
          title: "Renewal review",
          startTime: "2026-08-01T10:00:00.000Z",
          summarySnippet: "Approved annual renewal.",
          transcriptSnippets: [],
          score: 8,
        },
        {
          id: "meeting-2",
          title: "Budget review",
          startTime: "2026-08-08T10:00:00.000Z",
          summarySnippet: "Deferred renewal pending budget.",
          transcriptSnippets: [],
          score: 8,
        },
      ],
      tasks: [],
      people: [],
      isEmpty: false,
    } as any);
    const sources = [
      {
        sourceType: "meeting" as const,
        sourceId: "meeting-1",
        title: "Renewal review",
        snippet: "Approved annual renewal.",
      },
      {
        sourceType: "meeting" as const,
        sourceId: "meeting-2",
        title: "Budget review",
        snippet: "Deferred renewal pending budget.",
      },
    ];
    setProviderScript(
      "compare renewal decisions across all meetings",
      answer("The meetings conflict: one approved renewal and one deferred it.", sources, "medium")
    );

    const result = await runAgent({
      question: "Compare the renewal decision across every meeting.",
    });

    expect(result?.sources.map((source) => source.sourceId)).toEqual([
      "meeting-1",
      "meeting-2",
    ]);
    expect(result?.answer).toMatch(/conflict/i);
    expect(searchMock.mock.calls[0][3]).toMatchObject({ constraints: undefined });
    recordExecutedEvalCases("all-meeting-comparison", "contradictory-meetings");
  });

  it("confines meeting retrieval even when the model spoofs a broader scope", async () => {
    const prepared = prepareScopedMcpToolCall({
      scope: { type: "meeting", meetingId: "meeting-allowed" },
      name: "search_workspace_knowledge",
      args: {
        query: "decision",
        scopeType: "workspace",
        scopeId: "meeting-other",
      },
    });

    expect(prepared).toEqual({
      ok: true,
      name: "search_workspace_knowledge",
      args: {
        query: "decision",
        scopeType: "meeting",
        scopeId: "meeting-allowed",
      },
    });
    recordExecutedEvalCases("meeting-confinement");
  });

  it("keeps a same-name client and person as distinct cited entities", async () => {
    searchMock.mockResolvedValue({
      meetings: [],
      tasks: [],
      people: [
        {
          id: "person-acme",
          name: "Acme",
          email: "acme.person@example.com",
          personType: "client",
          score: 3,
        },
      ],
      isEmpty: false,
    } as any);
    const result = await executeRegisteredMcpTool(
      {
        db: makeKnowledgeDb({
          companies: [
            {
              _id: "client-acme",
              workspaceId: "workspace-1",
              name: "Acme",
              domain: "example.com",
              peopleIds: ["person-acme"],
            },
          ],
        }),
        workspaceId: "workspace-1",
      },
      "search_workspace_knowledge",
      { query: "Acme", scopeType: "workspace" }
    );

    expect(result.data.citations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceType: "person", sourceId: "person-acme" }),
        expect.objectContaining({ sourceType: "client", sourceId: "client-acme" }),
      ])
    );
    recordExecutedEvalCases("same-name-client-person-collision");
  });

  it("returns only tasks owned by the selected person despite a same-name person", async () => {
    const allowedPerson = {
      _id: "person-allowed",
      workspaceId: "workspace-1",
      name: "Alex Morgan",
      email: "alex.allowed@example.com",
    };
    const collisionPerson = {
      _id: "person-collision",
      workspaceId: "workspace-1",
      name: "Alex Morgan",
      email: "alex.collision@example.com",
    };
    searchMock.mockResolvedValue(sameNameEvidence);

    const result = await executeRegisteredMcpTool(
      {
        db: makeKnowledgeDb({ people: [allowedPerson, collisionPerson] }),
        workspaceId: "workspace-1",
      },
      "search_workspace_knowledge",
      {
        query: "Alex Morgan tasks",
        scopeType: "person",
        scopeId: "person-allowed",
      }
    );

    expect((result.data.people as any[]).map((item) => item.id)).toEqual([
      "person-allowed",
    ]);
    expect((result.data.tasks as any[]).map((item) => item.id)).toEqual([
      "task-allowed",
    ]);
    expect((result.data.citations as any[]).map((item) => item.sourceId)).not.toEqual(
      expect.arrayContaining(["person-collision", "task-collision", "meeting-collision"])
    );
    recordExecutedEvalCases("person-task-ownership");
  });

  it("passes planner deadline bounds and preserves due-task evidence", async () => {
    searchMock.mockResolvedValue({
      meetings: [],
      tasks: [
        {
          id: "task-due",
          title: "Send renewal proposal",
          status: "todo",
          dueAt: "2026-08-14T10:00:00.000Z",
          assigneeName: "Alex Morgan",
          overdue: false,
          score: 5,
        },
      ],
      people: [],
      isEmpty: false,
    } as any);

    const result = await executeRegisteredMcpTool(
      { db: makeKnowledgeDb(), workspaceId: "workspace-1" },
      "search_workspace_knowledge",
      {
        query: "deadlines this week",
        scopeType: "planner",
        from: "2026-08-11T00:00:00.000Z",
        to: "2026-08-17T23:59:59.999Z",
      }
    );

    expect(searchMock.mock.calls[0][3]).toMatchObject({
      from: "2026-08-11T00:00:00.000Z",
      to: "2026-08-17T23:59:59.999Z",
      plannerBias: true,
    });
    expect((result.data.tasks as any[]).map((task) => task.id)).toEqual(["task-due"]);
    recordExecutedEvalCases("planner-deadlines");
  });

  it("fails closed when empty evidence is followed by a confident fabricated answer", async () => {
    setProviderScript(
      "enterprise discount evidence",
      answer(
        "The customer was promised a 35% enterprise discount.",
        [],
        "high"
      )
    );

    const result = await runAgent({
      question: "What enterprise discount did we promise?",
    });

    expect(result).toBeNull();
    expect(searchMock).toHaveBeenCalledTimes(1);
    recordExecutedEvalCases("no-evidence-abstention");
  });

  it("retains the latest 12 turns and rolls an older grounded reference into memory", async () => {
    const messages = Array.from({ length: 24 }, (_, index) => ({
      id: `message-${index + 1}`,
      sender: index % 2 === 0 ? "user" : "ai",
      text:
        index === 0
          ? "Remember the Project Aurora renewal."
          : index === 1
            ? "Project Aurora was approved in the kickoff."
            : `Turn ${index + 1}`,
      ...(index === 1
        ? {
            chatAnswer: {
              sources: [
                {
                  sourceType: "meeting",
                  sourceId: "meeting-aurora",
                  title: "Aurora kickoff",
                  snippet: "Renewal approved.",
                },
              ],
            },
          }
        : {}),
    }));
    const updateOne = jest.fn();
    const db = {
      collection: jest.fn(() => ({
        findOne: jest.fn(async () => ({
          _id: "session-1",
          workspaceId: "workspace-1",
          userId: "user-1",
          messages,
        })),
        updateOne,
      })),
    } as any;

    const memory = await loadDurableChatMemory({
      db,
      userId: "user-1",
      workspaceId: "workspace-1",
      sessionId: "session-1",
    });

    expect(memory.recentHistory).toHaveLength(12);
    expect(memory.recentHistory[0].text).toBe("Turn 13");
    expect(memory.summary).toContain("Project Aurora");
    expect(memory.summary).toContain("meeting:meeting-aurora");
    expect(updateOne).toHaveBeenCalledTimes(1);

    searchMock.mockResolvedValue({
      meetings: [
        {
          id: "meeting-aurora",
          title: "Aurora kickoff",
          startTime: "2026-07-01T10:00:00.000Z",
          summarySnippet: "Project Aurora renewal was approved.",
          transcriptSnippets: [],
          score: 9,
        },
      ],
      tasks: [],
      people: [],
      isEmpty: false,
    } as any);
    setProviderScript(
      "Project Aurora renewal decision",
      answer("Project Aurora's renewal was approved.", [
        {
          sourceType: "meeting",
          sourceId: "meeting-aurora",
          title: "Aurora kickoff",
          snippet: "Project Aurora renewal was approved.",
        },
      ])
    );

    const followUp = await runAgent({
      question: "What was decided about it?",
      history: memory.recentHistory,
      memorySummary: memory.summary,
    });
    const initialModelInput = JSON.stringify(
      JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body).input
    );

    expect(initialModelInput).toContain("Project Aurora");
    expect(searchMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ workspaceId: "workspace-1" }),
      "Project Aurora renewal decision",
      expect.anything()
    );
    expect(followUp).toMatchObject({
      answer: "Project Aurora's renewal was approved.",
      sources: [expect.objectContaining({ sourceId: "meeting-aurora" })],
    });
    recordExecutedEvalCases("long-thread-reference");
  });

  it("stops before executing a repeated identical tool call", async () => {
    global.fetch = jest
      .fn()
      .mockImplementationOnce(() =>
        jsonResponse({ output: [functionCall("renewal", "call-1")] })
      )
      .mockImplementationOnce(() =>
        jsonResponse({ output: [functionCall("renewal", "call-2")] })
      ) as any;

    await expect(runAgent({ question: "What changed?" })).resolves.toBeNull();
    expect(searchMock).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    recordExecutedEvalCases("repeated-tool-call-stop");
  });

  it("denies an entity from another workspace without running retrieval", async () => {
    const crossWorkspacePerson = {
      _id: "person-other",
      workspaceId: "workspace-other",
      name: "Other Workspace Person",
    };

    await expect(
      executeRegisteredMcpTool(
        {
          db: makeKnowledgeDb({ people: [crossWorkspacePerson] }),
          workspaceId: "workspace-1",
        },
        "search_workspace_knowledge",
        {
          query: "private commitments",
          scopeType: "person",
          scopeId: "person-other",
        }
      )
    ).rejects.toMatchObject({ code: "chat_scope_not_found", status: 404 });
    expect(searchMock).not.toHaveBeenCalled();
    recordExecutedEvalCases("cross-workspace-denial");
  });

  it("advertises read-only automatic tools and performs zero writes for ambiguous or multi-task mutations", async () => {
    const advertisedTools = getOpenAiReadToolsForScope({ type: "workspace" });
    const registeredScopes = new Map(
      listRegisteredMcpTools().map((tool) => [tool.name, tool.scope])
    );
    expect(advertisedTools.length).toBeGreaterThan(0);
    expect(advertisedTools.every((tool) => registeredScopes.get(tool.name) === "mcp:read")).toBe(
      true
    );

    const ambiguous = planChatTaskCommand(
      "Mark task Follow up done",
      new Date("2026-08-11T10:00:00.000Z")
    ) as ChatTaskCommand;
    const multi = planChatTaskCommand(
      "Mark task Alpha done and task Beta done",
      new Date("2026-08-11T10:00:00.000Z")
    ) as ChatTaskCommand;
    const taskRows = [
      { _id: "task-1", title: "Follow up", workspaceId: "workspace-1" },
      { _id: "task-2", title: "Follow up", workspaceId: "workspace-1" },
    ];
    const insertOne = jest.fn();
    const updateOne = jest.fn();
    const db = {
      collection: jest.fn(() => ({
        findOne: jest.fn(async () => null),
        find: jest.fn(() => cursor(taskRows)),
        insertOne,
        updateOne,
      })),
    } as any;
    const commandScope = {
      userId: "user-1",
      workspaceId: "workspace-1",
      memberUserIds: ["user-1"],
    };

    const ambiguousResult = await runChatTaskCommand(db, commandScope, ambiguous);
    const multiResult = await runChatTaskCommand(db, commandScope, multi);

    expect(ambiguousResult.answer).toMatch(/multiple matching tasks/i);
    expect(multiResult.confidence).toBe("low");
    expect(insertOne).not.toHaveBeenCalled();
    expect(updateOne).not.toHaveBeenCalled();
    recordExecutedEvalCases("ambiguous-multi-task-zero-write");
  });
});
