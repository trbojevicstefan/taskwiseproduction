import { GET, POST } from "@/app/api/workspaces/[workspaceId]/fathom/connections/route";
import { requireWorkspaceRouteAccess } from "@/lib/workspace-route-access";
import {
  findFathomConnectionById,
  findPreferredFathomConnectionForWorkspace,
  listFathomConnectionsForWorkspace,
} from "@/lib/fathom-connections";

jest.mock("@/lib/workspace-route-access", () => ({
  requireWorkspaceRouteAccess: jest.fn(),
}));

jest.mock("@/lib/fathom-connections", () => ({
  findFathomConnectionById: jest.fn(),
  findPreferredFathomConnectionForWorkspace: jest.fn(),
  listFathomConnectionsForWorkspace: jest.fn(),
  serializeFathomConnection: jest.requireActual("@/lib/fathom-connections").serializeFathomConnection,
}));

const mockedRequireWorkspaceRouteAccess =
  requireWorkspaceRouteAccess as jest.MockedFunction<typeof requireWorkspaceRouteAccess>;
const mockedListFathomConnectionsForWorkspace =
  listFathomConnectionsForWorkspace as jest.MockedFunction<
    typeof listFathomConnectionsForWorkspace
  >;
const mockedFindPreferredFathomConnectionForWorkspace =
  findPreferredFathomConnectionForWorkspace as jest.MockedFunction<
    typeof findPreferredFathomConnectionForWorkspace
  >;
const mockedFindFathomConnectionById =
  findFathomConnectionById as jest.MockedFunction<typeof findFathomConnectionById>;

const createConnection = (id: string, label: string, createdByUserId = "user-1") =>
  ({
    _id: id,
    workspaceId: "workspace-1",
    provider: "fathom",
    label,
    status: "active",
    createdByUserId,
    updatedByUserId: createdByUserId,
    legacyUserId: createdByUserId,
    oauth: {
      accessToken: null,
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
      managedWebhooks: [],
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

describe("workspace fathom connections route", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedRequireWorkspaceRouteAccess.mockResolvedValue({
      ok: true,
      db: {} as any,
      userId: "user-1",
      workspace: { _id: "workspace-1", name: "Main Workspace" },
      membership: { role: "owner", status: "active" },
    } as any);
  });

  it("lists workspace connections with preferred metadata", async () => {
    const primary = createConnection("connection-1", "Primary");
    const secondary = createConnection("connection-2", "Secondary", "user-2");
    mockedListFathomConnectionsForWorkspace.mockResolvedValue([primary, secondary] as any);
    mockedFindPreferredFathomConnectionForWorkspace.mockResolvedValue(primary as any);

    const response = await GET(new Request("http://localhost"), {
      params: { workspaceId: "workspace-1" },
    });
    expect(response.status).toBe(200);

    const payload = await response.json();
    expect(payload).toMatchObject({
      ok: true,
      preferredConnectionId: "connection-1",
      activeConnectionCount: 2,
      totalConnectionCount: 2,
      connections: [
        expect.objectContaining({
          id: "connection-1",
          isPreferred: true,
          connectedByCurrentUser: true,
        }),
        expect.objectContaining({
          id: "connection-2",
          isPreferred: false,
          connectedByCurrentUser: false,
        }),
      ],
    });
  });

  it("returns OAuth redirect URL for workspace-scoped creation", async () => {
    mockedFindFathomConnectionById.mockResolvedValue(null);

    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: "Sales Team" }),
      }),
      {
        params: { workspaceId: "workspace-1" },
      }
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({
      ok: true,
      workspaceId: "workspace-1",
      label: "Sales Team",
    });
    expect(String(payload.redirectUrl)).toContain(
      "/api/fathom/oauth/start?workspaceId=workspace-1&label=Sales+Team"
    );
  });
});

