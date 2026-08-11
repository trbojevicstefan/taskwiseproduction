import {
  executeRegisteredMcpTool,
  registerMcpTools,
  resetMcpRegistryForTests,
} from "@/lib/mcp-registry";
import { getMcpKnowledgeToolDefinitions } from "@/lib/mcp-knowledge-tools";
import { searchWorkspaceContext } from "@/lib/workspace-retrieval";
import { listActiveWorkspaceMembershipsForWorkspace } from "@/lib/workspace-memberships";

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

const cursor = (docs: any[]) => {
  const value: any = {
    sort: jest.fn(() => value),
    limit: jest.fn(() => value),
    project: jest.fn(() => value),
    toArray: jest.fn(async () => docs),
  };
  return value;
};

const makeDb = ({
  meetings = [] as any[],
  people = [] as any[],
  companies = [] as any[],
} = {}) => {
  const findByIdentifier = (docs: any[], filter: any) => {
    const clauses = filter?.$and?.find((part: any) => Array.isArray(part?.$or))?.$or;
    const id = clauses?.map((part: any) => part._id ?? part.id).find(Boolean);
    const workspaceId = filter?.$and?.find((part: any) => part?.workspaceId)?.workspaceId;
    return (
      docs.find(
        (doc) =>
          (!id || String(doc._id ?? doc.id) === String(id)) &&
          (!workspaceId || doc.workspaceId === workspaceId)
      ) ?? null
    );
  };
  const collections: Record<string, any> = {
    meetings: {
      findOne: jest.fn(async (filter: any) => findByIdentifier(meetings, filter)),
    },
    people: {
      findOne: jest.fn(async (filter: any) => findByIdentifier(people, filter)),
      find: jest.fn(() => cursor(people)),
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

const emptyResult = {
  meetings: [],
  tasks: [],
  people: [],
  isEmpty: true,
};

describe("search_workspace_knowledge MCP tool", () => {
  beforeEach(() => {
    resetMcpRegistryForTests();
    jest.clearAllMocks();
    membershipsMock.mockResolvedValue([
      { workspaceId: "ws-1", userId: "user-1", status: "active" },
    ] as any);
    searchMock.mockResolvedValue(emptyResult);
  });

  it("advertises a closed read-only schema and strict matching validation", async () => {
    const [definition] = getMcpKnowledgeToolDefinitions();
    expect(definition.name).toBe("search_workspace_knowledge");
    expect(definition.scope).toBe("mcp:read");
    expect(definition.jsonSchema).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["query", "scopeType"],
      properties: {
        query: { type: "string" },
        scopeType: {
          enum: ["workspace", "meeting", "client", "person", "planner"],
        },
      },
    });

    registerMcpTools([definition]);
    await expect(
      executeRegisteredMcpTool(
        { db: makeDb(), workspaceId: "ws-1" },
        definition.name,
        { query: "pricing", scopeType: "workspace", workspaceId: "ws-other" }
      )
    ).rejects.toMatchObject({ code: "invalid_arguments" });
    await expect(
      executeRegisteredMcpTool(
        { db: makeDb(), workspaceId: "ws-1" },
        definition.name,
        { query: "pricing", scopeType: "meeting" }
      )
    ).rejects.toMatchObject({ code: "invalid_arguments" });
  });

  it("uses only the execution-context workspace and passes date, limit, and planner bias", async () => {
    const [definition] = getMcpKnowledgeToolDefinitions();
    registerMcpTools([definition]);
    const db = makeDb();

    await executeRegisteredMcpTool(
      { db, workspaceId: "ws-1" },
      definition.name,
      {
        query: "what needs planning?",
        scopeType: "planner",
        from: "2026-08-01T00:00:00.000Z",
        to: "2026-08-31T23:59:59.999Z",
        limit: 7,
      }
    );

    expect(searchMock).toHaveBeenCalledWith(
      db,
      {
        userId: "user-1",
        workspaceId: "ws-1",
        memberUserIds: ["user-1"],
      },
      "what needs planning?",
      expect.objectContaining({
        maxMeetings: 7,
        maxTasks: 7,
        maxPeople: 7,
        from: "2026-08-01T00:00:00.000Z",
        to: "2026-08-31T23:59:59.999Z",
        plannerBias: true,
      })
    );
  });

  it("preconstrains meeting retrieval and never returns evidence from another meeting", async () => {
    const db = makeDb({
      meetings: [
        {
          _id: "meeting-1",
          workspaceId: "ws-1",
          attendees: [{ id: "person-1", name: "Ana", email: "ana@acme.com" }],
        },
      ],
    });
    searchMock.mockResolvedValue({
      meetings: [
        {
          id: "meeting-1",
          title: "Pricing",
          startTime: null,
          summarySnippet: "Approved the proposal",
          transcriptSnippets: [],
          score: 8,
        },
        {
          id: "meeting-2",
          title: "Private strategy",
          startTime: null,
          summarySnippet: "Must not leak",
          transcriptSnippets: [],
          score: 100,
        },
      ],
      tasks: [
        {
          id: "task-1",
          title: "Send proposal",
          status: "todo",
          dueAt: null,
          assigneeName: "Ana",
          overdue: false,
          sourceSessionId: "meeting-1",
          score: 4,
        },
        {
          id: "task-2",
          title: "Secret follow-up",
          status: "todo",
          dueAt: null,
          assigneeName: null,
          overdue: false,
          sourceSessionId: "meeting-2",
          score: 9,
        },
      ],
      people: [],
      isEmpty: false,
    });
    const [definition] = getMcpKnowledgeToolDefinitions();
    registerMcpTools([definition]);

    const result = await executeRegisteredMcpTool(
      { db, workspaceId: "ws-1" },
      definition.name,
      { query: "proposal", scopeType: "meeting", scopeId: "meeting-1" }
    );

    const options = searchMock.mock.calls[0][3] as any;
    expect(options.constraints.meetings).toEqual({
      $or: [{ _id: "meeting-1" }, { id: "meeting-1" }],
    });
    expect(options.constraints.chunks).toEqual({ meetingId: "meeting-1" });
    expect((result.data.meetings as any[]).map((meeting) => meeting.id)).toEqual([
      "meeting-1",
    ]);
    expect((result.data.tasks as any[]).map((task) => task.id)).toEqual(["task-1"]);
  });

  it("rejects an entity scope that is not visible in the execution workspace", async () => {
    const [definition] = getMcpKnowledgeToolDefinitions();
    registerMcpTools([definition]);

    await expect(
      executeRegisteredMcpTool(
        { db: makeDb(), workspaceId: "ws-1" },
        definition.name,
        { query: "roadmap", scopeType: "person", scopeId: "person-other" }
      )
    ).rejects.toMatchObject({ code: "chat_scope_not_found", status: 404 });
    expect(searchMock).not.toHaveBeenCalled();
  });

  it("returns structured entities and normalized grounding citations", async () => {
    searchMock.mockResolvedValue({
      meetings: [
        {
          id: "meeting-1",
          title: "Pricing review",
          startTime: "2026-08-05T10:00:00.000Z",
          summarySnippet: null,
          transcriptSnippets: [
            { timestamp: "14:05", speaker: "Ana", snippet: "Approved pricing." },
          ],
          score: 8,
          semanticScore: 0.95,
        },
      ],
      tasks: [
        {
          id: "task-1",
          title: "Send proposal",
          status: "todo",
          dueAt: "2026-08-15T00:00:00.000Z",
          assigneeName: "Ana",
          overdue: false,
          sourceSessionId: "meeting-1",
          score: 4,
        },
      ],
      people: [
        {
          id: "person-1",
          name: "Ana",
          email: "ana@acme.com",
          personType: "client",
          score: 3,
        },
      ],
      isEmpty: false,
    });
    const db = makeDb({
      companies: [
        {
          _id: "client-1",
          workspaceId: "ws-1",
          name: "Acme",
          domain: "acme.com",
          peopleIds: ["person-1"],
        },
      ],
    });
    const [definition] = getMcpKnowledgeToolDefinitions();
    registerMcpTools([definition]);

    const result = await executeRegisteredMcpTool(
      { db, workspaceId: "ws-1" },
      definition.name,
      { query: "pricing", scopeType: "workspace", limit: 10 }
    );

    expect(result.data).toMatchObject({
      meetings: [{ id: "meeting-1" }],
      tasks: [{ id: "task-1" }],
      people: [{ id: "person-1" }],
      clients: [{ id: "client-1", name: "Acme", domain: "acme.com" }],
    });
    expect(result.data.citations).toEqual(
      expect.arrayContaining([
        {
          sourceType: "transcript",
          sourceId: "meeting-1",
          title: "Pricing review",
          snippet: "Approved pricing.",
          timestamp: "14:05",
        },
        expect.objectContaining({ sourceType: "task", sourceId: "task-1" }),
        expect.objectContaining({ sourceType: "person", sourceId: "person-1" }),
        expect.objectContaining({ sourceType: "client", sourceId: "client-1" }),
      ])
    );
  });
});
