import { GET, POST } from "@/app/api/workspaces/[workspaceId]/mcp/keys/route";
import {
  createMcpApiKey,
  listMcpApiKeysForWorkspace,
  serializeMcpApiKey,
} from "@/lib/mcp-api-keys";
import { logMcpAuditEvent } from "@/lib/mcp-audit-logs";
import { requireWorkspaceRouteAccess } from "@/lib/workspace-route-access";

jest.mock("@/lib/workspace-route-access", () => ({
  requireWorkspaceRouteAccess: jest.fn(),
}));

jest.mock("@/lib/mcp-api-keys", () => ({
  createMcpApiKey: jest.fn(),
  listMcpApiKeysForWorkspace: jest.fn(),
  serializeMcpApiKey: jest.requireActual("@/lib/mcp-api-keys").serializeMcpApiKey,
}));

jest.mock("@/lib/mcp-audit-logs", () => ({
  logMcpAuditEvent: jest.fn(),
}));

const mockedRequireWorkspaceRouteAccess =
  requireWorkspaceRouteAccess as jest.MockedFunction<typeof requireWorkspaceRouteAccess>;
const mockedCreateMcpApiKey =
  createMcpApiKey as jest.MockedFunction<typeof createMcpApiKey>;
const mockedListMcpApiKeysForWorkspace =
  listMcpApiKeysForWorkspace as jest.MockedFunction<typeof listMcpApiKeysForWorkspace>;
const mockedLogMcpAuditEvent =
  logMcpAuditEvent as jest.MockedFunction<typeof logMcpAuditEvent>;

const createKeyDoc = (overrides: Record<string, unknown> = {}) =>
  ({
    _id: "key-1",
    workspaceId: "workspace-1",
    name: "Read Key",
    description: null,
    keyPrefix: "twmcp_test",
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

describe("workspace mcp keys route", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedRequireWorkspaceRouteAccess.mockResolvedValue({
      ok: true,
      db: {} as any,
      userId: "user-1",
      workspace: { _id: "workspace-1", name: "Main Workspace" },
      membership: { role: "owner", status: "active" },
    } as any);
    mockedListMcpApiKeysForWorkspace.mockResolvedValue([createKeyDoc()]);
    mockedCreateMcpApiKey.mockResolvedValue({
      apiKey: "twmcp_secret_123",
      record: createKeyDoc(),
    } as any);
    mockedLogMcpAuditEvent.mockResolvedValue({} as any);
  });

  it("lists MCP keys for workspace", async () => {
    const response = await GET(new Request("http://localhost"), {
      params: { workspaceId: "workspace-1" },
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.totalCount).toBe(1);
    expect(payload.keys[0]).toMatchObject({
      id: "key-1",
      name: "Read Key",
      scopes: ["mcp:read"],
    });
  });

  it("creates key and returns one-time apiKey secret", async () => {
    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Write Key",
          description: "Used by automation",
          scopes: ["mcp:read", "mcp:write"],
        }),
      }),
      {
        params: { workspaceId: "workspace-1" },
      }
    );
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.ok).toBe(true);
    expect(payload.apiKey).toBe("twmcp_secret_123");
    expect(mockedCreateMcpApiKey).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        workspaceId: "workspace-1",
        scopes: ["mcp:read", "mcp:write"],
      })
    );
    expect(mockedLogMcpAuditEvent).toHaveBeenCalled();
  });

  it("blocks key creation for non-admin members", async () => {
    mockedRequireWorkspaceRouteAccess.mockResolvedValueOnce({
      ok: true,
      db: {} as any,
      userId: "user-1",
      workspace: { _id: "workspace-1", name: "Main Workspace" },
      membership: { role: "member", status: "active" },
    } as any);

    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Member Key",
          scopes: ["mcp:read"],
        }),
      }),
      {
        params: { workspaceId: "workspace-1" },
      }
    );
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.errorCode).toBe("forbidden");
    expect(mockedCreateMcpApiKey).not.toHaveBeenCalled();
  });

  it("rejects invalid expiresAt payload", async () => {
    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Expiring Key",
          scopes: ["mcp:read"],
          expiresAt: "bad-date",
        }),
      }),
      {
        params: { workspaceId: "workspace-1" },
      }
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.errorCode).toBe("invalid_payload");
    expect(mockedCreateMcpApiKey).not.toHaveBeenCalled();
  });
});
