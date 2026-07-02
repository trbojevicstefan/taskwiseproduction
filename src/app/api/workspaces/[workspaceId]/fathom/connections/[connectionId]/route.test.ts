import {
  DELETE,
  PATCH,
} from "@/app/api/workspaces/[workspaceId]/fathom/connections/[connectionId]/route";
import { getValidFathomAccessTokenForConnection } from "@/lib/fathom-auth";
import { deleteFathomWebhook } from "@/lib/fathom-webhooks";
import {
  findFathomConnectionById,
  listFathomConnectionsForWorkspace,
  updateFathomConnectionById,
} from "@/lib/fathom-connections";
import { findWorkspaceById, updateWorkspaceById } from "@/lib/workspaces";
import { requireWorkspaceRouteAccess } from "@/lib/workspace-route-access";

jest.mock("@/lib/workspace-route-access", () => ({
  requireWorkspaceRouteAccess: jest.fn(),
}));

jest.mock("@/lib/fathom-connections", () => ({
  findFathomConnectionById: jest.fn(),
  listFathomConnectionsForWorkspace: jest.fn(),
  serializeFathomConnection: jest.requireActual("@/lib/fathom-connections").serializeFathomConnection,
  updateFathomConnectionById: jest.fn(),
}));

jest.mock("@/lib/fathom-auth", () => ({
  getValidFathomAccessTokenForConnection: jest.fn(),
}));

jest.mock("@/lib/fathom-webhooks", () => ({
  deleteFathomWebhook: jest.fn(),
}));

jest.mock("@/lib/workspaces", () => ({
  findWorkspaceById: jest.fn(),
  updateWorkspaceById: jest.fn(),
}));

const mockedRequireWorkspaceRouteAccess =
  requireWorkspaceRouteAccess as jest.MockedFunction<typeof requireWorkspaceRouteAccess>;
const mockedFindFathomConnectionById =
  findFathomConnectionById as jest.MockedFunction<typeof findFathomConnectionById>;
const mockedListFathomConnectionsForWorkspace =
  listFathomConnectionsForWorkspace as jest.MockedFunction<
    typeof listFathomConnectionsForWorkspace
  >;
const mockedUpdateFathomConnectionById =
  updateFathomConnectionById as jest.MockedFunction<typeof updateFathomConnectionById>;
const mockedGetValidFathomAccessTokenForConnection =
  getValidFathomAccessTokenForConnection as jest.MockedFunction<
    typeof getValidFathomAccessTokenForConnection
  >;
const mockedDeleteFathomWebhook =
  deleteFathomWebhook as jest.MockedFunction<typeof deleteFathomWebhook>;
const mockedFindWorkspaceById = findWorkspaceById as jest.MockedFunction<typeof findWorkspaceById>;
const mockedUpdateWorkspaceById =
  updateWorkspaceById as jest.MockedFunction<typeof updateWorkspaceById>;

const createConnection = () =>
  ({
    _id: "connection-1",
    workspaceId: "workspace-1",
    provider: "fathom",
    label: "Primary",
    status: "active",
    createdByUserId: "user-1",
    updatedByUserId: "user-1",
    legacyUserId: "user-1",
    oauth: {
      accessToken: "access-token",
      refreshToken: null,
      expiresAt: null,
      scope: null,
      stateId: null,
      connectedAt: null,
      lastRefreshedAt: null,
      lastError: null,
    },
    webhook: {
      token: "token-1",
      secret: null,
      status: "active",
      webhookId: "webhook-1",
      webhookUrl: "https://example.com/webhook",
      webhookEvent: "new-meeting-content-ready",
      managedWebhooks: [{ id: "webhook-1", url: "https://example.com/webhook" }],
      lastSyncedAt: null,
      lastError: null,
    },
    source: {
      providerUserId: null,
      providerAccountId: null,
      providerSourceIds: [],
    },
    sync: {
      lastAttemptedAt: null,
      lastSucceededAt: null,
      lastError: null,
    },
    migration: null,
    createdAt: new Date("2026-04-15T10:00:00.000Z"),
    updatedAt: new Date("2026-04-15T10:00:00.000Z"),
    revokedAt: null,
  }) as any;

describe("workspace fathom connection detail route", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedRequireWorkspaceRouteAccess.mockResolvedValue({
      ok: true,
      db: {} as any,
      userId: "user-1",
      workspace: { _id: "workspace-1", name: "Main Workspace" },
      membership: { role: "owner", status: "active" },
    } as any);
    mockedFindFathomConnectionById.mockResolvedValue(createConnection());
    mockedFindWorkspaceById.mockResolvedValue({
      _id: "workspace-1",
      name: "Main Workspace",
      createdByUserId: "user-1",
      createdAt: new Date("2026-04-15T10:00:00.000Z"),
      updatedAt: new Date("2026-04-15T10:00:00.000Z"),
      status: "active",
      settings: {},
    } as any);
    mockedUpdateWorkspaceById.mockResolvedValue(undefined as never);
  });

  it("renames a workspace connection", async () => {
    mockedListFathomConnectionsForWorkspace.mockResolvedValue([createConnection()] as any);
    mockedUpdateFathomConnectionById.mockResolvedValue({
      ...createConnection(),
      label: "Sales Team",
    } as any);

    const response = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: "Sales Team" }),
      }),
      {
        params: { workspaceId: "workspace-1", connectionId: "connection-1" },
      }
    );

    expect(response.status).toBe(200);
    expect(mockedUpdateFathomConnectionById).toHaveBeenCalledWith(
      expect.anything(),
      "connection-1",
      expect.objectContaining({
        label: "Sales Team",
        updatedByUserId: "user-1",
      })
    );
  });

  it("sets a connection as preferred for the workspace", async () => {
    const response = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ setPreferred: true }),
      }),
      {
        params: { workspaceId: "workspace-1", connectionId: "connection-1" },
      }
    );

    expect(response.status).toBe(200);
    expect(mockedUpdateWorkspaceById).toHaveBeenCalledWith(
      expect.anything(),
      "workspace-1",
      expect.objectContaining({
        settings: expect.objectContaining({
          integrations: expect.objectContaining({
            preferredFathomConnectionId: "connection-1",
          }),
        }),
      })
    );
  });

  it("revokes a workspace connection and clears managed webhook state", async () => {
    mockedGetValidFathomAccessTokenForConnection.mockResolvedValue("access-token");
    mockedDeleteFathomWebhook.mockResolvedValue(undefined as never);
    mockedUpdateFathomConnectionById.mockResolvedValue({
      ...createConnection(),
      status: "revoked",
      revokedAt: new Date("2026-04-15T12:00:00.000Z"),
    } as any);

    const response = await DELETE(new Request("http://localhost"), {
      params: { workspaceId: "workspace-1", connectionId: "connection-1" },
    });

    expect(response.status).toBe(200);
    expect(mockedDeleteFathomWebhook).toHaveBeenCalledTimes(1);
  });
});
