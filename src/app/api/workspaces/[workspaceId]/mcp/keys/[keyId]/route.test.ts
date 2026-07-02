import { DELETE } from "@/app/api/workspaces/[workspaceId]/mcp/keys/[keyId]/route";
import { findMcpApiKeyById, revokeMcpApiKeyById } from "@/lib/mcp-api-keys";
import { logMcpAuditEvent } from "@/lib/mcp-audit-logs";
import { requireWorkspaceRouteAccess } from "@/lib/workspace-route-access";

jest.mock("@/lib/workspace-route-access", () => ({
  requireWorkspaceRouteAccess: jest.fn(),
}));

jest.mock("@/lib/mcp-api-keys", () => ({
  findMcpApiKeyById: jest.fn(),
  revokeMcpApiKeyById: jest.fn(),
  serializeMcpApiKey: jest.requireActual("@/lib/mcp-api-keys").serializeMcpApiKey,
}));

jest.mock("@/lib/mcp-audit-logs", () => ({
  logMcpAuditEvent: jest.fn(),
}));

const mockedRequireWorkspaceRouteAccess =
  requireWorkspaceRouteAccess as jest.MockedFunction<typeof requireWorkspaceRouteAccess>;
const mockedFindMcpApiKeyById =
  findMcpApiKeyById as jest.MockedFunction<typeof findMcpApiKeyById>;
const mockedRevokeMcpApiKeyById =
  revokeMcpApiKeyById as jest.MockedFunction<typeof revokeMcpApiKeyById>;
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

describe("workspace mcp key revoke route", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedRequireWorkspaceRouteAccess.mockResolvedValue({
      ok: true,
      db: {} as any,
      userId: "user-1",
      workspace: { _id: "workspace-1", name: "Main Workspace" },
      membership: { role: "owner", status: "active" },
    } as any);
    mockedFindMcpApiKeyById.mockResolvedValue(createKeyDoc());
    mockedRevokeMcpApiKeyById.mockResolvedValue(createKeyDoc({ status: "revoked" }));
    mockedLogMcpAuditEvent.mockResolvedValue({} as any);
  });

  it("revokes key and logs audit event", async () => {
    const response = await DELETE(new Request("http://localhost", { method: "DELETE" }), {
      params: { workspaceId: "workspace-1", keyId: "key-1" },
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.revoked).toBe(true);
    expect(payload.key.status).toBe("revoked");
    expect(mockedRevokeMcpApiKeyById).toHaveBeenCalledWith(
      expect.anything(),
      "key-1",
      "user-1"
    );
    expect(mockedLogMcpAuditEvent).toHaveBeenCalled();
  });

  it("returns not found when key belongs to another workspace", async () => {
    mockedFindMcpApiKeyById.mockResolvedValueOnce(
      createKeyDoc({
        workspaceId: "workspace-2",
      })
    );

    const response = await DELETE(new Request("http://localhost", { method: "DELETE" }), {
      params: { workspaceId: "workspace-1", keyId: "key-1" },
    });
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload.errorCode).toBe("not_found");
    expect(mockedRevokeMcpApiKeyById).not.toHaveBeenCalled();
  });
});
