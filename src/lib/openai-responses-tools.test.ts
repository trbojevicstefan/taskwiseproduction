import { executeRegisteredMcpTool } from "@/lib/mcp-registry";
import {
  executeScopedMcpTool,
  getOpenAiReadToolsForScope,
  prepareScopedMcpToolCall,
} from "@/lib/openai-responses-tools";

jest.mock("@/lib/mcp-registry", () => {
  const actual = jest.requireActual("@/lib/mcp-registry");
  return {
    ...actual,
    executeRegisteredMcpTool: jest.fn(),
  };
});

const mockedExecuteRegisteredMcpTool =
  executeRegisteredMcpTool as jest.MockedFunction<
    typeof executeRegisteredMcpTool
  >;

describe("OpenAI Responses MCP tools", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedExecuteRegisteredMcpTool.mockResolvedValue({
      toolName: "search_workspace_knowledge",
      summary: "Found evidence.",
      data: { meetings: [{ id: "meeting-1" }] },
    });
  });

  it("exposes only relevant registered read tools and never write tools", () => {
    const tools = getOpenAiReadToolsForScope({ type: "workspace" });
    const names = tools.map((tool) => tool.name);

    expect(names).toEqual(
      expect.arrayContaining([
        "search_workspace_knowledge",
        "search_meetings",
        "get_meeting",
        "get_transcript_snippets",
        "list_clients",
        "get_client_commitments",
        "list_tasks",
        "get_calendar_agenda",
        "get_board_snapshot",
      ])
    );
    expect(names).not.toEqual(
      expect.arrayContaining([
        "update_task_status",
        "assign_task",
        "set_task_due_date",
        "create_task_from_meeting",
      ])
    );
    expect(tools.every((tool) => tool.type === "function")).toBe(true);
    expect(tools.every((tool) => tool.strict === false)).toBe(true);
    expect(tools.every((tool) => tool.parameters.additionalProperties === false)).toBe(
      true
    );
  });

  it("overwrites model-provided knowledge scope with the authorized meeting scope", async () => {
    const knowledgeTool = getOpenAiReadToolsForScope({
      type: "meeting",
      meetingId: "meeting-1",
    }).find((tool) => tool.name === "search_workspace_knowledge");
    expect(knowledgeTool?.parameters).toMatchObject({ required: ["query"] });
    expect((knowledgeTool?.parameters.properties as any)?.scopeType).toBeUndefined();
    expect((knowledgeTool?.parameters.properties as any)?.scopeId).toBeUndefined();

    await executeScopedMcpTool({
      db: {} as any,
      workspaceId: "workspace-1",
      scope: { type: "meeting", meetingId: "meeting-1" },
      name: "search_workspace_knowledge",
      args: {
        query: "pricing",
        scopeType: "workspace",
        scopeId: "other-meeting",
      },
    });

    expect(mockedExecuteRegisteredMcpTool).toHaveBeenCalledWith(
      expect.anything(),
      "search_workspace_knowledge",
      {
        query: "pricing",
        scopeType: "meeting",
        scopeId: "meeting-1",
      }
    );
  });

  it("forces meeting detail and transcript calls to the authorized meeting", async () => {
    await executeScopedMcpTool({
      db: {} as any,
      workspaceId: "workspace-1",
      scope: { type: "meeting", meetingId: "meeting-1" },
      name: "get_transcript_snippets",
      args: { meetingId: "other-meeting", query: "decision" },
    });

    expect(mockedExecuteRegisteredMcpTool).toHaveBeenCalledWith(
      expect.anything(),
      "get_transcript_snippets",
      { meetingId: "meeting-1", query: "decision" }
    );
  });

  it("omits broad tools that cannot be safely constrained in client scope", () => {
    const names = getOpenAiReadToolsForScope({
      type: "client",
      clientId: "client-1",
    }).map((tool) => tool.name);

    expect(names).toEqual(["search_workspace_knowledge"]);
    expect(names).not.toEqual(
      expect.arrayContaining([
        "search_meetings",
        "list_tasks",
        "get_client_commitments",
      ])
    );
  });

  it("forces person commitment calls to the authorized person", async () => {
    await executeScopedMcpTool({
      db: {} as any,
      workspaceId: "workspace-1",
      scope: { type: "person", personId: "person-1" },
      name: "get_client_commitments",
      args: { personId: "other-person", includeDone: true },
    });

    expect(mockedExecuteRegisteredMcpTool).toHaveBeenCalledWith(
      expect.anything(),
      "get_client_commitments",
      { personId: "person-1", includeDone: true }
    );
  });

  it.each([
    {
      scope: { type: "meeting", meetingId: "meeting-1" } as const,
      name: "search_workspace_knowledge",
      firstArgs: {
        query: "pricing",
        scopeType: "workspace",
        scopeId: "other-meeting-1",
      },
      secondArgs: {
        query: "pricing",
        scopeType: "client",
        scopeId: "other-meeting-2",
      },
      expectedArgs: {
        query: "pricing",
        scopeType: "meeting",
        scopeId: "meeting-1",
      },
    },
    {
      scope: { type: "meeting", meetingId: "meeting-1" } as const,
      name: "get_meeting",
      firstArgs: { meetingId: "other-meeting-1" },
      secondArgs: { meetingId: "other-meeting-2" },
      expectedArgs: { meetingId: "meeting-1" },
    },
    {
      scope: { type: "person", personId: "person-1" } as const,
      name: "get_client_commitments",
      firstArgs: { personId: "other-person-1", includeDone: true },
      secondArgs: { personId: "other-person-2", includeDone: true },
      expectedArgs: { personId: "person-1", includeDone: true },
    },
  ])(
    "prepares identical effective arguments for spoofed $name authority fields",
    ({ scope, name, firstArgs, secondArgs, expectedArgs }) => {
      const first = prepareScopedMcpToolCall({ scope, name, args: firstArgs });
      const second = prepareScopedMcpToolCall({ scope, name, args: secondArgs });

      expect(first).toEqual({ ok: true, name, args: expectedArgs });
      expect(second).toEqual(first);
      expect(mockedExecuteRegisteredMcpTool).not.toHaveBeenCalled();
    }
  );

  it("rejects unavailable and unknown tools without executing the registry", async () => {
    const unavailable = await executeScopedMcpTool({
      db: {} as any,
      workspaceId: "workspace-1",
      scope: { type: "meeting", meetingId: "meeting-1" },
      name: "list_tasks",
      args: {},
    });
    const unknown = await executeScopedMcpTool({
      db: {} as any,
      workspaceId: "workspace-1",
      scope: { type: "workspace" },
      name: "delete_everything",
      args: {},
    });

    expect(unavailable).toMatchObject({
      ok: false,
      error: { code: "tool_not_available" },
    });
    expect(unknown).toMatchObject({
      ok: false,
      error: { code: "tool_not_available" },
    });
    expect(mockedExecuteRegisteredMcpTool).not.toHaveBeenCalled();
  });
});
