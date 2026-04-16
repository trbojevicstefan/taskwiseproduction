import { OPTIONS, POST } from "@/app/api/workspaces/[workspaceId]/mcp/route";
import { getDb } from "@/lib/db";
import { findActiveMcpApiKeyByToken, touchMcpApiKeyUsage } from "@/lib/mcp-api-keys";
import {
  executeMcpTool,
  listMcpTools,
  resolveMcpToolScopeRequirement,
} from "@/lib/mcp-tools";
import { logMcpAuditEvent } from "@/lib/mcp-audit-logs";

jest.mock("@/lib/db", () => ({
  getDb: jest.fn(),
}));

jest.mock("@/lib/mcp-api-keys", () => ({
  findActiveMcpApiKeyByToken: jest.fn(),
  touchMcpApiKeyUsage: jest.fn(),
}));

jest.mock("@/lib/mcp-tools", () => ({
  executeMcpTool: jest.fn(),
  listMcpTools: jest.fn(),
  resolveMcpToolScopeRequirement: jest.fn(),
}));

jest.mock("@/lib/mcp-audit-logs", () => ({
  logMcpAuditEvent: jest.fn(),
}));

const mockedGetDb = getDb as jest.MockedFunction<typeof getDb>;
const mockedFindActiveMcpApiKeyByToken =
  findActiveMcpApiKeyByToken as jest.MockedFunction<typeof findActiveMcpApiKeyByToken>;
const mockedTouchMcpApiKeyUsage =
  touchMcpApiKeyUsage as jest.MockedFunction<typeof touchMcpApiKeyUsage>;
const mockedExecuteMcpTool =
  executeMcpTool as jest.MockedFunction<typeof executeMcpTool>;
const mockedListMcpTools =
  listMcpTools as jest.MockedFunction<typeof listMcpTools>;
const mockedResolveMcpToolScopeRequirement =
  resolveMcpToolScopeRequirement as jest.MockedFunction<
    typeof resolveMcpToolScopeRequirement
  >;
const mockedLogMcpAuditEvent =
  logMcpAuditEvent as jest.MockedFunction<typeof logMcpAuditEvent>;

const createKeyDoc = (overrides: Record<string, unknown> = {}) =>
  ({
    _id: "mcp-key-1",
    workspaceId: "workspace-1",
    name: "Workspace MCP Key",
    description: null,
    keyPrefix: "twmcp_abc",
    keyHash: "hashed",
    scopes: ["mcp:read"],
    status: "active",
    expiresAt: null,
    lastUsedAt: null,
    createdByUserId: "user-1",
    revokedByUserId: null,
    revokedAt: null,
    createdAt: new Date("2026-04-16T12:00:00.000Z"),
    updatedAt: new Date("2026-04-16T12:00:00.000Z"),
    ...overrides,
  }) as any;

const createJsonRpcRequest = (
  body: Record<string, unknown>,
  options?: {
    headers?: Record<string, string>;
  }
) =>
  new Request("http://localhost/api/workspaces/workspace-1/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer twmcp_test_key",
      ...(options?.headers || {}),
    },
    body: JSON.stringify(body),
  });

describe("workspace mcp route", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetDb.mockResolvedValue({} as any);
    mockedFindActiveMcpApiKeyByToken.mockResolvedValue(createKeyDoc());
    mockedTouchMcpApiKeyUsage.mockResolvedValue(createKeyDoc());
    mockedListMcpTools.mockReturnValue([
      {
        name: "meetings.latest",
        description: "Get the most recent meeting",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "people.list",
        description: "List people",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "action_items.update_status",
        description: "Update status",
        inputSchema: { type: "object", properties: {} },
      },
    ]);
    mockedResolveMcpToolScopeRequirement.mockImplementation((toolName) =>
      toolName.startsWith("action_items.update_") ? "mcp:write" : "mcp:read"
    );
    mockedExecuteMcpTool.mockResolvedValue({
      toolName: "meetings.latest",
      summary: "Latest meeting: Demo",
      data: {
        meeting: {
          id: "meeting-1",
          title: "Demo",
        },
      },
    } as any);
    mockedLogMcpAuditEvent.mockResolvedValue({} as any);
  });

  it("returns unauthorized when key is missing", async () => {
    const response = await POST(
      new Request("http://localhost/api/workspaces/workspace-1/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {},
        }),
      }),
      {
        params: { workspaceId: "workspace-1" },
      }
    );
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.errorCode).toBe("request_error");
    expect(mockedFindActiveMcpApiKeyByToken).not.toHaveBeenCalled();
  });

  it("returns unauthorized when key is invalid", async () => {
    mockedFindActiveMcpApiKeyByToken.mockResolvedValueOnce(null as any);

    const response = await POST(
      createJsonRpcRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {},
      }),
      {
        params: { workspaceId: "workspace-1" },
      }
    );
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toContain("Invalid or expired");
    expect(mockedTouchMcpApiKeyUsage).not.toHaveBeenCalled();
  });

  it("returns forbidden when key belongs to another workspace", async () => {
    mockedFindActiveMcpApiKeyByToken.mockResolvedValueOnce(
      createKeyDoc({ workspaceId: "workspace-2" })
    );

    const response = await POST(
      createJsonRpcRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {},
      }),
      {
        params: { workspaceId: "workspace-1" },
      }
    );
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.errorCode).toBe("forbidden");
    expect(mockedTouchMcpApiKeyUsage).not.toHaveBeenCalled();
  });

  it("returns scope error for read methods when key scopes do not permit mcp read", async () => {
    mockedFindActiveMcpApiKeyByToken.mockResolvedValueOnce(
      createKeyDoc({
        scopes: ["meetings:read"],
      })
    );

    const response = await POST(
      createJsonRpcRequest({
        jsonrpc: "2.0",
        id: "req-1",
        method: "tools/list",
      }),
      {
        params: { workspaceId: "workspace-1" },
      }
    );
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.errorCode).toBe("forbidden");
    expect(payload.details).toMatchObject({
      requiredScope: "mcp:read",
      method: "tools/list",
    });
    expect(mockedTouchMcpApiKeyUsage).not.toHaveBeenCalled();
  });

  it("responds to initialize and records key usage", async () => {
    const db = { tag: "db" } as any;
    mockedGetDb.mockResolvedValueOnce(db);

    const response = await POST(
      createJsonRpcRequest({
        jsonrpc: "2.0",
        id: 7,
        method: "initialize",
        params: {
          clientInfo: { name: "test-client", version: "0.0.1" },
        },
      }),
      {
        params: { workspaceId: "workspace-1" },
      }
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      jsonrpc: "2.0",
      id: 7,
      result: {
        protocolVersion: "2025-03-26",
        serverInfo: {
          name: "taskwise-mcp",
        },
        context: {
          workspaceId: "workspace-1",
          keyId: "mcp-key-1",
        },
      },
    });
    expect(response.headers.get("x-taskwise-workspace-id")).toBe("workspace-1");
    expect(response.headers.get("x-taskwise-mcp-key-id")).toBe("mcp-key-1");
    expect(mockedTouchMcpApiKeyUsage).toHaveBeenCalledWith(db, "mcp-key-1");
  });

  it("returns method-not-found JSON-RPC error payload for unknown methods", async () => {
    const response = await POST(
      createJsonRpcRequest({
        jsonrpc: "2.0",
        id: "req-404",
        method: "tasks/list",
      }),
      {
        params: { workspaceId: "workspace-1" },
      }
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.error).toMatchObject({
      code: -32601,
    });
  });

  it("returns listed MCP tools including people and write tools", async () => {
    const response = await POST(
      createJsonRpcRequest({
        jsonrpc: "2.0",
        id: "tools-1",
        method: "tools/list",
      }),
      {
        params: { workspaceId: "workspace-1" },
      }
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.result.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "meetings.latest" }),
        expect.objectContaining({ name: "people.list" }),
        expect.objectContaining({ name: "action_items.update_status" }),
      ])
    );
    expect(mockedListMcpTools).toHaveBeenCalled();
  });

  it("executes tools/call and returns structured content", async () => {
    const response = await POST(
      createJsonRpcRequest({
        jsonrpc: "2.0",
        id: "call-1",
        method: "tools/call",
        params: {
          name: "meetings.latest",
          arguments: {},
        },
      }),
      {
        params: { workspaceId: "workspace-1" },
      }
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.result).toMatchObject({
      content: [{ type: "text", text: "Latest meeting: Demo" }],
      structuredContent: {
        meeting: {
          id: "meeting-1",
          title: "Demo",
        },
      },
    });
    expect(mockedExecuteMcpTool).toHaveBeenCalledWith(
      expect.anything(),
      "workspace-1",
      "meetings.latest",
      {}
    );
  });

  it("returns forbidden when tools/call is requested without read scope", async () => {
    mockedFindActiveMcpApiKeyByToken.mockResolvedValueOnce(
      createKeyDoc({
        scopes: ["meetings:read"],
      })
    );

    const response = await POST(
      createJsonRpcRequest({
        jsonrpc: "2.0",
        id: "call-2",
        method: "tools/call",
        params: {
          name: "meetings.latest",
          arguments: {},
        },
      }),
      {
        params: { workspaceId: "workspace-1" },
      }
    );
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.errorCode).toBe("forbidden");
    expect(mockedExecuteMcpTool).not.toHaveBeenCalled();
  });

  it("returns forbidden when write tool is requested without write scope", async () => {
    mockedFindActiveMcpApiKeyByToken.mockResolvedValueOnce(
      createKeyDoc({
        scopes: ["mcp:read"],
      })
    );

    const response = await POST(
      createJsonRpcRequest({
        jsonrpc: "2.0",
        id: "call-write-1",
        method: "tools/call",
        params: {
          name: "action_items.update_status",
          arguments: {
            taskId: "task-1",
            status: "done",
          },
        },
      }),
      {
        params: { workspaceId: "workspace-1" },
      }
    );
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.errorCode).toBe("forbidden");
    expect(payload.details).toMatchObject({
      requiredScope: "mcp:write",
      method: "tools/call",
    });
    expect(mockedExecuteMcpTool).not.toHaveBeenCalled();
  });

  it("records audit event when write tool call succeeds", async () => {
    mockedFindActiveMcpApiKeyByToken.mockResolvedValueOnce(
      createKeyDoc({
        scopes: ["mcp:write"],
      })
    );
    mockedExecuteMcpTool.mockResolvedValueOnce({
      toolName: "action_items.update_status",
      summary: "Updated status to done.",
      data: {
        task: { id: "task-1", status: "done" },
      },
    } as any);

    const response = await POST(
      createJsonRpcRequest({
        jsonrpc: "2.0",
        id: "call-write-2",
        method: "tools/call",
        params: {
          name: "action_items.update_status",
          arguments: {
            taskId: "task-1",
            status: "done",
          },
        },
      }),
      {
        params: { workspaceId: "workspace-1" },
      }
    );

    expect(response.status).toBe(200);
    expect(mockedLogMcpAuditEvent).toHaveBeenCalled();
  });

  it("supports streamable responses when event-stream is requested", async () => {
    const response = await POST(
      createJsonRpcRequest(
        {
          jsonrpc: "2.0",
          id: "stream-1",
          method: "ping",
        },
        {
          headers: {
            Accept: "text/event-stream",
          },
        }
      ),
      {
        params: { workspaceId: "workspace-1" },
      }
    );
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(text).toContain("event: message");
    expect(text).toContain("\"jsonrpc\":\"2.0\"");
    expect(text).toContain("\"id\":\"stream-1\"");
  });

  it("accepts notifications (requests without id) with no body response", async () => {
    const response = await POST(
      createJsonRpcRequest({
        jsonrpc: "2.0",
        method: "ping",
      }),
      {
        params: { workspaceId: "workspace-1" },
      }
    );

    expect(response.status).toBe(202);
    expect(await response.text()).toBe("");
    expect(mockedTouchMcpApiKeyUsage).toHaveBeenCalled();
  });

  it("responds to preflight options", async () => {
    const response = await OPTIONS();

    expect(response.status).toBe(204);
    expect(response.headers.get("allow")).toContain("POST");
  });
});
