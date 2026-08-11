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
  relatedPeople = people as any[],
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
      find: jest.fn((filter: any, options?: any) => {
        if (options?.projection) return cursor(people);
        const namePattern = filter?.$and
          ?.flatMap((part: any) => part?.$or || [])
          .map((part: any) => part?.name ?? part?.aliases)
          .find((value: any) => value instanceof RegExp);
        if (!namePattern) return cursor(relatedPeople);
        return cursor(
          relatedPeople.filter((person) =>
            [person?.name, ...(person?.aliases || [])].some(
              (name) => typeof name === "string" && namePattern.test(name)
            )
          )
        );
      }),
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

const sameNameCollisionResult = () =>
  ({
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
        title: "Same-name collision meeting",
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
        title: "Allowed task",
        status: "todo",
        dueAt: null,
        assigneeName: "Alex Morgan",
        assigneeId: "person-allowed",
        assigneeEmail: "alex.allowed@example.com",
        overdue: false,
        sourceSessionId: "meeting-allowed",
        score: 4,
      },
      {
        id: "task-collision",
        title: "Same-name collision task",
        status: "todo",
        dueAt: null,
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
  }) as any;

const uniqueNameOnlyResult = () =>
  ({
    meetings: [
      {
        id: "meeting-name-only",
        title: "Unique name meeting",
        startTime: null,
        summarySnippet: "Name-only attendee evidence",
        transcriptSnippets: [],
        attendeeIdentities: [
          { ids: [], emails: [], nameKey: "unique alex" },
        ],
        score: 7,
      },
    ],
    tasks: [
      {
        id: "task-name-only",
        title: "Unique name task",
        status: "todo",
        dueAt: null,
        assigneeName: "Unique Alex",
        assigneeId: null,
        assigneeEmail: null,
        overdue: false,
        sourceSessionId: "meeting-name-only",
        score: 5,
      },
    ],
    people: [
      {
        id: "person-unique",
        name: "Unique Alex",
        email: "unique@example.com",
        personType: "client",
        score: 3,
      },
    ],
    isEmpty: false,
  }) as any;

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

  it("returns and cites unique name-only meeting and task evidence in person scope", async () => {
    const uniquePerson = {
      _id: "person-unique",
      workspaceId: "ws-1",
      name: "Unique Alex",
      email: "unique@example.com",
    };
    const db = makeDb({ people: [uniquePerson], relatedPeople: [uniquePerson] });
    searchMock.mockResolvedValue(uniqueNameOnlyResult());
    const [definition] = getMcpKnowledgeToolDefinitions();
    registerMcpTools([definition]);

    const result = await executeRegisteredMcpTool(
      { db, workspaceId: "ws-1" },
      definition.name,
      {
        query: "Unique Alex commitments",
        scopeType: "person",
        scopeId: "person-unique",
      }
    );

    expect((result.data.meetings as any[]).map((item) => item.id)).toEqual([
      "meeting-name-only",
    ]);
    expect((result.data.tasks as any[]).map((item) => item.id)).toEqual([
      "task-name-only",
    ]);
    const citationIds = (result.data.citations as any[]).map(
      (citation) => citation.sourceId
    );
    expect(citationIds).toEqual(
      expect.arrayContaining(["meeting-name-only", "task-name-only"])
    );
  });

  it("returns and cites unique name-only meeting and task evidence in client scope", async () => {
    const uniquePerson = {
      _id: "person-unique",
      workspaceId: "ws-1",
      name: "Unique Alex",
      email: "unique@example.com",
      company: "Acme",
    };
    const db = makeDb({
      people: [uniquePerson],
      relatedPeople: [uniquePerson],
      companies: [
        {
          _id: "client-unique",
          workspaceId: "ws-1",
          name: "Acme",
          domain: "acme.com",
          peopleIds: ["person-unique"],
        },
      ],
    });
    searchMock.mockResolvedValue(uniqueNameOnlyResult());
    const [definition] = getMcpKnowledgeToolDefinitions();
    registerMcpTools([definition]);

    const result = await executeRegisteredMcpTool(
      { db, workspaceId: "ws-1" },
      definition.name,
      {
        query: "Unique Alex commitments",
        scopeType: "client",
        scopeId: "client-unique",
      }
    );

    expect((result.data.meetings as any[]).map((item) => item.id)).toEqual([
      "meeting-name-only",
    ]);
    expect((result.data.tasks as any[]).map((item) => item.id)).toEqual([
      "task-name-only",
    ]);
    const citationIds = (result.data.citations as any[]).map(
      (citation) => citation.sourceId
    );
    expect(citationIds).toEqual(
      expect.arrayContaining(["meeting-name-only", "task-name-only"])
    );
  });

  it("rejects name-only evidence when a punctuation variant collides after normalization", async () => {
    const allowedPerson = {
      _id: "person-allowed",
      workspaceId: "ws-1",
      name: "Alex Morgan",
      email: "alex.allowed@example.com",
    };
    const collision = {
      _id: "person-collision",
      workspaceId: "ws-1",
      name: "Alex-Morgan",
      email: "alex.collision@example.com",
    };
    const db = makeDb({
      people: [allowedPerson, collision],
      relatedPeople: [allowedPerson, collision],
    });
    const retrieved = uniqueNameOnlyResult();
    retrieved.meetings[0].attendeeIdentities[0].nameKey = "alex morgan";
    retrieved.tasks[0].assigneeName = "Alex Morgan";
    searchMock.mockResolvedValue(retrieved);
    const [definition] = getMcpKnowledgeToolDefinitions();
    registerMcpTools([definition]);

    const result = await executeRegisteredMcpTool(
      { db, workspaceId: "ws-1" },
      definition.name,
      {
        query: "Alex Morgan commitments",
        scopeType: "person",
        scopeId: "person-allowed",
      }
    );

    expect(result.data.meetings).toEqual([]);
    expect(result.data.tasks).toEqual([]);
    expect(
      (result.data.citations as any[]).map((citation) => citation.sourceId)
    ).not.toEqual(
      expect.arrayContaining(["meeting-name-only", "task-name-only"])
    );
  });

  it("excludes same-name meeting, task, person, and citation collisions in person scope", async () => {
    const allowedPerson = {
      _id: "person-allowed",
      workspaceId: "ws-1",
      name: "Alex Morgan",
      email: "alex.allowed@example.com",
    };
    const db = makeDb({
      people: [
        allowedPerson,
        {
          _id: "person-collision",
          workspaceId: "ws-1",
          name: "Alex Morgan",
          email: "alex.collision@example.com",
        },
      ],
      relatedPeople: [allowedPerson],
    });
    searchMock.mockResolvedValue(sameNameCollisionResult());
    const [definition] = getMcpKnowledgeToolDefinitions();
    registerMcpTools([definition]);

    const result = await executeRegisteredMcpTool(
      { db, workspaceId: "ws-1" },
      definition.name,
      {
        query: "Alex Morgan commitments",
        scopeType: "person",
        scopeId: "person-allowed",
      }
    );

    expect((result.data.meetings as any[]).map((item) => item.id)).toEqual([
      "meeting-allowed",
    ]);
    expect((result.data.tasks as any[]).map((item) => item.id)).toEqual([
      "task-allowed",
    ]);
    expect((result.data.people as any[]).map((item) => item.id)).toEqual([
      "person-allowed",
    ]);
    const citationIds = (result.data.citations as any[]).map(
      (citation) => citation.sourceId
    );
    expect(citationIds).not.toContain("meeting-collision");
    expect(citationIds).not.toContain("task-collision");
    expect(citationIds).not.toContain("person-collision");
  });

  it("excludes same-name relationship and citation collisions in client scope", async () => {
    const allowedPerson = {
      _id: "person-allowed",
      workspaceId: "ws-1",
      name: "Alex Morgan",
      email: "alex.allowed@example.com",
      company: "Acme",
    };
    const db = makeDb({
      people: [
        allowedPerson,
        {
          _id: "person-collision",
          workspaceId: "ws-1",
          name: "Alex Morgan",
          email: "alex.collision@example.com",
        },
      ],
      relatedPeople: [allowedPerson],
      companies: [
        {
          _id: "client-allowed",
          workspaceId: "ws-1",
          name: "Acme",
          domain: "acme.com",
          peopleIds: ["person-allowed"],
        },
      ],
    });
    searchMock.mockResolvedValue(sameNameCollisionResult());
    const [definition] = getMcpKnowledgeToolDefinitions();
    registerMcpTools([definition]);

    const result = await executeRegisteredMcpTool(
      { db, workspaceId: "ws-1" },
      definition.name,
      {
        query: "Alex Morgan commitments",
        scopeType: "client",
        scopeId: "client-allowed",
      }
    );

    expect((result.data.meetings as any[]).map((item) => item.id)).toEqual([
      "meeting-allowed",
    ]);
    expect((result.data.tasks as any[]).map((item) => item.id)).toEqual([
      "task-allowed",
    ]);
    expect((result.data.people as any[]).map((item) => item.id)).toEqual([
      "person-allowed",
    ]);
    const citationIds = (result.data.citations as any[]).map(
      (citation) => citation.sourceId
    );
    expect(citationIds).not.toContain("meeting-collision");
    expect(citationIds).not.toContain("task-collision");
    expect(citationIds).not.toContain("person-collision");
  });

  it("returns resolved meeting attendee people/client citations and excludes unrelated people", async () => {
    const attendee = {
      _id: "person-allowed",
      workspaceId: "ws-1",
      name: "Alex Morgan",
      email: "alex.allowed@example.com",
      personType: "client",
    };
    const db = makeDb({
      meetings: [
        {
          _id: "meeting-allowed",
          workspaceId: "ws-1",
          attendees: [
            { name: "Alex Morgan", email: "alex.allowed@example.com" },
          ],
        },
      ],
      people: [
        attendee,
        {
          _id: "person-collision",
          workspaceId: "ws-1",
          name: "Alex Morgan",
          email: "alex.collision@example.com",
          personType: "client",
        },
      ],
      relatedPeople: [attendee],
      companies: [
        {
          _id: "client-allowed",
          workspaceId: "ws-1",
          name: "Acme",
          domain: "example.com",
          peopleIds: ["person-allowed"],
        },
      ],
    });
    const retrieved = sameNameCollisionResult();
    retrieved.meetings = retrieved.meetings.map((meeting: any) => ({
      ...meeting,
      id: "meeting-allowed",
    })).slice(0, 1);
    retrieved.tasks = [];
    searchMock.mockResolvedValue(retrieved);
    const [definition] = getMcpKnowledgeToolDefinitions();
    registerMcpTools([definition]);

    const result = await executeRegisteredMcpTool(
      { db, workspaceId: "ws-1" },
      definition.name,
      {
        query: "attendees",
        scopeType: "meeting",
        scopeId: "meeting-allowed",
      }
    );

    const options = searchMock.mock.calls[0][3] as any;
    expect(options.constraints.people).toEqual({
      $or: [
        { _id: "person-allowed" },
        { id: "person-allowed" },
        { email: "alex.allowed@example.com" },
      ],
    });
    expect((result.data.people as any[]).map((item) => item.id)).toEqual([
      "person-allowed",
    ]);
    expect(result.data.clients).toEqual([
      expect.objectContaining({ id: "client-allowed" }),
    ]);
    expect(result.data.citations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceType: "person",
          sourceId: "person-allowed",
        }),
        expect.objectContaining({
          sourceType: "client",
          sourceId: "client-allowed",
        }),
      ])
    );
    expect(
      (result.data.citations as any[]).map((citation) => citation.sourceId)
    ).not.toContain("person-collision");
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
