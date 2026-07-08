/**
 * End-to-end MCP route tests through the REAL registry (src/lib/mcp-tools is
 * deliberately NOT mocked here, unlike route.test.ts): proves the
 * attendees.list alias dispatches to people.list, and that resources/list,
 * resources/read, prompts/list, and prompts/get serve the populated
 * registries.
 */
import { POST } from "@/app/api/workspaces/[workspaceId]/mcp/route";
import { getDb } from "@/lib/db";
import { findActiveMcpApiKeyByToken, touchMcpApiKeyUsage } from "@/lib/mcp-api-keys";
import { enforceMcpApiKeyRateLimit } from "@/lib/mcp-rate-limit";
import { listActiveWorkspaceMembershipsForWorkspace } from "@/lib/workspace-memberships";

jest.mock("@/lib/db", () => ({
  getDb: jest.fn(),
}));

jest.mock("@/lib/mcp-api-keys", () => ({
  findActiveMcpApiKeyByToken: jest.fn(),
  touchMcpApiKeyUsage: jest.fn(),
}));

jest.mock("@/lib/mcp-audit-logs", () => ({
  logMcpAuditEvent: jest.fn(),
}));

jest.mock("@/lib/mcp-rate-limit", () => ({
  enforceMcpApiKeyRateLimit: jest.fn(),
}));

jest.mock("@/lib/workspace-memberships", () => ({
  listActiveWorkspaceMembershipsForWorkspace: jest.fn(),
}));

const mockedGetDb = getDb as jest.MockedFunction<typeof getDb>;
const mockedFindActiveMcpApiKeyByToken =
  findActiveMcpApiKeyByToken as jest.MockedFunction<typeof findActiveMcpApiKeyByToken>;
const mockedTouchMcpApiKeyUsage =
  touchMcpApiKeyUsage as jest.MockedFunction<typeof touchMcpApiKeyUsage>;
const mockedEnforceMcpApiKeyRateLimit =
  enforceMcpApiKeyRateLimit as jest.MockedFunction<typeof enforceMcpApiKeyRateLimit>;
const mockedMemberships =
  listActiveWorkspaceMembershipsForWorkspace as jest.MockedFunction<
    typeof listActiveWorkspaceMembershipsForWorkspace
  >;

const createCursor = (rows: any[]) => {
  let workingRows = [...rows];
  const cursor: any = {};
  cursor.project = jest.fn(() => cursor);
  cursor.sort = jest.fn(() => cursor);
  cursor.limit = jest.fn((limit: number) => {
    workingRows = workingRows.slice(0, limit);
    return cursor;
  });
  cursor.toArray = jest.fn(async () => workingRows);
  return cursor;
};

const createKeyDoc = (overrides: Record<string, unknown> = {}) =>
  ({
    _id: "mcp-key-1",
    workspaceId: "workspace-1",
    name: "Workspace MCP Key",
    keyPrefix: "twmcp_abc",
    scopes: ["mcp:read"],
    status: "active",
    ...overrides,
  }) as any;

const createJsonRpcRequest = (body: Record<string, unknown>) =>
  new Request("http://localhost/api/workspaces/workspace-1/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer twmcp_test_key",
    },
    body: JSON.stringify(body),
  });

const post = async (body: Record<string, unknown>) => {
  const response = await POST(createJsonRpcRequest(body), {
    params: { workspaceId: "workspace-1" },
  });
  return { response, payload: await response.json() };
};

describe("workspace mcp route (real registry)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetDb.mockResolvedValue({ collection: jest.fn() } as any);
    mockedFindActiveMcpApiKeyByToken.mockResolvedValue(createKeyDoc());
    mockedTouchMcpApiKeyUsage.mockResolvedValue(createKeyDoc());
    mockedMemberships.mockResolvedValue([
      { userId: "user-1", status: "active" },
    ] as any);
    mockedEnforceMcpApiKeyRateLimit.mockResolvedValue({
      allowed: true,
      request: {
        category: "requests",
        allowed: true,
        limit: 120,
        count: 1,
        remaining: 119,
        resetAt: new Date("2026-07-06T12:01:00.000Z"),
        retryAfterSeconds: 60,
      },
      write: null,
      blocked: null,
    } as any);
  });

  it("lists legacy tools and the new pack tools, without aliases", async () => {
    const { response, payload } = await post({
      jsonrpc: "2.0",
      id: "tools-1",
      method: "tools/list",
    });

    expect(response.status).toBe(200);
    const names = payload.result.tools.map((tool: any) => tool.name);
    // Legacy dotted tools stay listed.
    expect(names).toEqual(
      expect.arrayContaining([
        "meetings.latest",
        "meetings.list",
        "meetings.get",
        "action_items.list",
        "people.list",
        "people.get",
        "action_items.update_status",
      ])
    );
    // Phase 8 pack tools.
    expect(names).toEqual(
      expect.arrayContaining([
        "search_meetings",
        "get_meeting",
        "get_transcript_snippets",
        "list_tasks",
        "update_task_status",
        "assign_task",
        "set_task_due_date",
        "prioritize_tasks",
        "create_task_from_meeting",
        "schedule_slack_reminder",
        "list_clients",
        "get_client_commitments",
        "get_board_snapshot",
        "get_calendar_agenda",
      ])
    );
    // Aliases resolve on tools/call but are never listed.
    expect(names).not.toContain("attendees.list");
    expect(names).not.toContain("attendees.get");
  });

  it("executes the attendees.list alias end-to-end via people.list", async () => {
    const peopleCursor = createCursor([
      {
        _id: "person-1",
        workspaceId: "workspace-1",
        name: "Alex Parker",
        email: "alex@example.com",
        lastSeenAt: new Date("2026-07-01T10:00:00.000Z"),
      },
    ]);
    const db = {
      collection: jest.fn((name: string) => {
        if (name === "people") return { find: jest.fn(() => peopleCursor) };
        throw new Error(`Unexpected collection: ${name}`);
      }),
    } as any;
    mockedGetDb.mockResolvedValue(db);

    const { response, payload } = await post({
      jsonrpc: "2.0",
      id: "alias-1",
      method: "tools/call",
      params: { name: "attendees.list", arguments: { limit: 10 } },
    });

    expect(response.status).toBe(200);
    expect(payload.error).toBeUndefined();
    expect(payload.result.structuredContent.people).toEqual([
      expect.objectContaining({ id: "person-1", name: "Alex Parker" }),
    ]);
    expect(payload.result.content[0].text).toContain("1 people");
  });

  it("lists the eight registered resources", async () => {
    const { response, payload } = await post({
      jsonrpc: "2.0",
      id: "res-list-1",
      method: "resources/list",
    });

    expect(response.status).toBe(200);
    const uris = payload.result.resources.map((resource: any) => resource.uri);
    expect(uris).toEqual([
      "taskwise://workspace/summary",
      "taskwise://meetings",
      "taskwise://meetings/{meetingId}/transcript",
      "taskwise://tasks",
      "taskwise://board",
      "taskwise://people",
      "taskwise://clients",
      "taskwise://calendar",
    ]);
    expect(payload.result.resources[0]).toMatchObject({
      name: expect.any(String),
      description: expect.any(String),
      mimeType: "application/json",
    });
  });

  it("reads the workspace summary resource end-to-end", async () => {
    const meetingsCursor = createCursor([
      {
        _id: "meeting-1",
        title: "Roadmap planning",
        startTime: new Date("2026-07-01T10:00:00.000Z"),
        attendees: [],
        summary: "Milestones",
      },
    ]);
    const db = {
      collection: jest.fn((name: string) => {
        if (name === "meetings") {
          return {
            countDocuments: jest.fn(async () => 3),
            find: jest.fn(() => meetingsCursor),
          };
        }
        if (name === "tasks") return { countDocuments: jest.fn(async () => 4) };
        if (name === "people") return { countDocuments: jest.fn(async () => 2) };
        if (name === "taskReminders")
          return { countDocuments: jest.fn(async () => 1) };
        throw new Error(`Unexpected collection: ${name}`);
      }),
    } as any;
    mockedGetDb.mockResolvedValue(db);

    const { response, payload } = await post({
      jsonrpc: "2.0",
      id: "res-read-1",
      method: "resources/read",
      params: { uri: "taskwise://workspace/summary" },
    });

    expect(response.status).toBe(200);
    expect(payload.result.contents).toHaveLength(1);
    expect(payload.result.contents[0]).toMatchObject({
      uri: "taskwise://workspace/summary",
      mimeType: "application/json",
    });
    const summary = JSON.parse(payload.result.contents[0].text);
    expect(summary.counts).toMatchObject({ meetings: 3, people: 2 });
    expect(summary.recentMeetings[0]).toMatchObject({ id: "meeting-1" });
  });

  it("returns -32002 for unknown resource URIs", async () => {
    const { response, payload } = await post({
      jsonrpc: "2.0",
      id: "res-read-2",
      method: "resources/read",
      params: { uri: "taskwise://does-not-exist" },
    });

    expect(response.status).toBe(200);
    expect(payload.error).toMatchObject({ code: -32002 });
  });

  it("lists the five registered prompts with argument metadata", async () => {
    const { response, payload } = await post({
      jsonrpc: "2.0",
      id: "prompts-1",
      method: "prompts/list",
    });

    expect(response.status).toBe(200);
    const names = payload.result.prompts.map((prompt: any) => prompt.name);
    expect(names).toEqual([
      "summarize_client_commitments",
      "prioritize_open_tasks",
      "prepare_status_update",
      "find_broken_promises",
      "generate_implementation_plan_from_meetings",
    ]);
    const planPrompt = payload.result.prompts.find(
      (prompt: any) => prompt.name === "generate_implementation_plan_from_meetings"
    );
    expect(planPrompt.arguments).toEqual([
      expect.objectContaining({ name: "topic", required: true }),
    ]);
  });

  it("serves prompts/get and enforces required arguments", async () => {
    const missing = await post({
      jsonrpc: "2.0",
      id: "prompt-get-1",
      method: "prompts/get",
      params: { name: "generate_implementation_plan_from_meetings" },
    });
    expect(missing.payload.error).toMatchObject({ code: -32602 });
    expect(missing.payload.error.message).toContain("topic");

    const ok = await post({
      jsonrpc: "2.0",
      id: "prompt-get-2",
      method: "prompts/get",
      params: {
        name: "generate_implementation_plan_from_meetings",
        arguments: { topic: "billing revamp" },
      },
    });
    expect(ok.response.status).toBe(200);
    expect(ok.payload.result.messages).toHaveLength(1);
    expect(ok.payload.result.messages[0].content.text).toContain("billing revamp");
    expect(ok.payload.result.messages[0].content.text).toContain("search_meetings");
  });

  it("returns -32602 for unknown prompts", async () => {
    const { payload } = await post({
      jsonrpc: "2.0",
      id: "prompt-get-3",
      method: "prompts/get",
      params: { name: "ghost_prompt" },
    });
    expect(payload.error).toMatchObject({ code: -32602 });
    expect(payload.error.message).toContain("Prompt not found");
  });
});
