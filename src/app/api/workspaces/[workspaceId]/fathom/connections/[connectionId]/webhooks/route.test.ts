import {
  DELETE,
  GET,
  POST,
} from "@/app/api/workspaces/[workspaceId]/fathom/connections/[connectionId]/webhooks/route";
import {
  ensureFathomConnectionWebhook,
  getFathomWebhookUrl,
} from "@/lib/fathom";
import { getValidFathomAccessTokenForConnection } from "@/lib/fathom-auth";
import { deleteFathomWebhook, pruneFathomManagedWebhooks } from "@/lib/fathom-webhooks";
import {
  findFathomConnectionById,
  updateFathomConnectionById,
} from "@/lib/fathom-connections";
import { requireWorkspaceRouteAccess } from "@/lib/workspace-route-access";

jest.mock("@/lib/workspace-route-access", () => ({
  requireWorkspaceRouteAccess: jest.fn(),
}));

jest.mock("@/lib/fathom-connections", () => ({
  findFathomConnectionById: jest.fn(),
  serializeFathomConnection: jest.requireActual("@/lib/fathom-connections").serializeFathomConnection,
  updateFathomConnectionById: jest.fn(),
}));

jest.mock("@/lib/fathom", () => ({
  FATHOM_WEBHOOK_EVENT: "new-meeting-content-ready",
  ensureFathomConnectionWebhook: jest.fn(),
  getFathomWebhookUrl: jest.fn((token: string) => `https://public.example/webhook?token=${token}`),
}));

jest.mock("@/lib/fathom-auth", () => ({
  getValidFathomAccessTokenForConnection: jest.fn(),
}));

jest.mock("@/lib/fathom-webhooks", () => ({
  deleteFathomWebhook: jest.fn(),
  pruneFathomManagedWebhooks: jest.fn(async (_accessToken: string, input: any) => ({
    managedWebhooks: input.managedWebhooks || [],
    deletedCount: 0,
    cleanupErrors: [],
  })),
}));

const mockedRequireWorkspaceRouteAccess =
  requireWorkspaceRouteAccess as jest.MockedFunction<typeof requireWorkspaceRouteAccess>;
const mockedFindFathomConnectionById =
  findFathomConnectionById as jest.MockedFunction<typeof findFathomConnectionById>;
const mockedUpdateFathomConnectionById =
  updateFathomConnectionById as jest.MockedFunction<typeof updateFathomConnectionById>;
const mockedGetValidFathomAccessTokenForConnection =
  getValidFathomAccessTokenForConnection as jest.MockedFunction<
    typeof getValidFathomAccessTokenForConnection
  >;
const mockedEnsureFathomConnectionWebhook =
  ensureFathomConnectionWebhook as jest.MockedFunction<typeof ensureFathomConnectionWebhook>;
const mockedDeleteFathomWebhook =
  deleteFathomWebhook as jest.MockedFunction<typeof deleteFathomWebhook>;
const mockedPruneFathomManagedWebhooks =
  pruneFathomManagedWebhooks as jest.MockedFunction<typeof pruneFathomManagedWebhooks>;
const mockedGetFathomWebhookUrl =
  getFathomWebhookUrl as jest.MockedFunction<typeof getFathomWebhookUrl>;

const createConnection = (overrides: Record<string, any> = {}) =>
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
      webhookId: null,
      webhookUrl: null,
      webhookEvent: "new-meeting-content-ready",
      managedWebhooks: [],
      lastSyncedAt: null,
      lastError: null,
    },
    source: {
      providerUserId: "provider-user-1",
      providerAccountId: null,
      providerSourceIds: [],
    },
    sync: {
      lastAttemptedAt: null,
      lastSucceededAt: null,
      lastError: null,
    },
    migration: null,
    createdAt: new Date("2026-04-16T10:00:00.000Z"),
    updatedAt: new Date("2026-04-16T10:00:00.000Z"),
    revokedAt: null,
    ...overrides,
  }) as any;

describe("workspace fathom connection webhook route", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedPruneFathomManagedWebhooks.mockResolvedValue({
      managedWebhooks: [],
      deletedCount: 0,
      cleanupErrors: [],
    });
    mockedRequireWorkspaceRouteAccess.mockResolvedValue({
      ok: true,
      db: {} as any,
      userId: "user-1",
      workspace: { _id: "workspace-1", name: "Main Workspace" },
      membership: { role: "owner", status: "active" },
    } as any);
    mockedFindFathomConnectionById.mockResolvedValue(createConnection());
    mockedUpdateFathomConnectionById.mockImplementation(async (_db, _id, update) => {
      const current = createConnection();
      return {
        ...current,
        ...update,
        webhook: {
          ...current.webhook,
          ...((update as any).webhook || {}),
        },
        oauth: {
          ...current.oauth,
          ...((update as any).oauth || {}),
        },
      } as any;
    });
  });

  it("lists webhooks for a specific workspace connection", async () => {
    const response = await GET(new Request("http://localhost"), {
      params: { workspaceId: "workspace-1", connectionId: "connection-1" },
    });

    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.connectionId).toBe("connection-1");
    expect(payload.webhookUrl).toBe("https://public.example/webhook?token=token-1");
    expect(mockedGetFathomWebhookUrl).toHaveBeenCalledWith("token-1");
  });

  it("creates a webhook for a specific workspace connection", async () => {
    mockedGetValidFathomAccessTokenForConnection.mockResolvedValue("access-token");
    mockedEnsureFathomConnectionWebhook.mockResolvedValue({
      status: "created",
      webhookId: "webhook-1",
      webhookUrl: "https://public.example/fathom-webhook",
      webhookSecret: "whsec_123",
      managedWebhooks: [
        {
          id: "webhook-1",
          url: "https://public.example/fathom-webhook",
          createdAt: "2026-04-16T10:00:00.000Z",
        },
      ],
    } as any);

    const response = await POST(new Request("http://localhost", { method: "POST" }), {
      params: { workspaceId: "workspace-1", connectionId: "connection-1" },
    });

    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.status).toBe("created");
    expect(payload.webhookId).toBe("webhook-1");
    expect(mockedEnsureFathomConnectionWebhook).toHaveBeenCalledWith(
      "connection-1",
      "access-token",
      expect.any(String),
      { updatedByUserId: "user-1" }
    );
  });

  it("deletes selected webhooks for a specific workspace connection", async () => {
    mockedFindFathomConnectionById.mockResolvedValue(
      createConnection({
        webhook: {
          token: "token-1",
          secret: null,
          status: "active",
          webhookId: "webhook-1",
          webhookUrl: "https://public.example/fathom-webhook",
          webhookEvent: "new-meeting-content-ready",
          managedWebhooks: [
            { id: "webhook-1", url: "https://public.example/fathom-webhook" },
            { id: "webhook-2", url: "https://public.example/fathom-webhook-2" },
          ],
          lastSyncedAt: null,
          lastError: null,
        },
      })
    );
    mockedGetValidFathomAccessTokenForConnection.mockResolvedValue("access-token");
    mockedDeleteFathomWebhook.mockResolvedValue(undefined as never);

    const response = await DELETE(
      new Request("http://localhost", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: ["webhook-1"] }),
      }),
      {
        params: { workspaceId: "workspace-1", connectionId: "connection-1" },
      }
    );

    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.deleted).toBe(1);
    expect(mockedDeleteFathomWebhook).toHaveBeenCalledWith("access-token", {
      id: "webhook-1",
      url: "https://public.example/fathom-webhook",
    });
  });
});
