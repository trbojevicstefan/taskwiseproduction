import { POST } from "@/app/api/integrations/[provider]/route";
import { getDb } from "@/lib/db";
import { upsertMeetingConnection } from "@/lib/meeting-connections";
import { getMeetingProviderAdapter } from "@/lib/meeting-providers";
import { getSessionUserId } from "@/lib/server-auth";
import { resolveWorkspaceScopeForUser } from "@/lib/workspace-scope";

jest.mock("@/lib/db", () => ({ getDb: jest.fn() }));
jest.mock("@/lib/server-auth", () => ({ getSessionUserId: jest.fn() }));
jest.mock("@/lib/workspace-scope", () => ({ resolveWorkspaceScopeForUser: jest.fn() }));
jest.mock("@/lib/meeting-connections", () => {
  const actual = jest.requireActual("@/lib/meeting-connections");
  return { ...actual, upsertMeetingConnection: jest.fn() };
});
jest.mock("@/lib/meeting-providers", () => ({
  getMeetingProviderAdapter: jest.fn(),
  ProviderNotImplementedError: jest.requireActual("@/lib/meeting-providers/types").ProviderNotImplementedError,
}));
jest.mock("@/lib/observability-metrics", () => ({ recordRouteMetric: jest.fn() }));

const mockedGetDb = getDb as jest.MockedFunction<typeof getDb>;
const mockedUser = getSessionUserId as jest.MockedFunction<typeof getSessionUserId>;
const mockedScope = resolveWorkspaceScopeForUser as jest.MockedFunction<typeof resolveWorkspaceScopeForUser>;
const mockedAdapter = getMeetingProviderAdapter as jest.MockedFunction<typeof getMeetingProviderAdapter>;
const mockedUpsert = upsertMeetingConnection as jest.MockedFunction<typeof upsertMeetingConnection>;

const params = { params: Promise.resolve({ provider: "read" }) };

describe("webhook-only meeting provider connection", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetDb.mockResolvedValue({} as any);
    mockedUser.mockResolvedValue("user-1");
    mockedScope.mockResolvedValue({ workspaceId: "ws-1" } as any);
    mockedAdapter.mockReturnValue({
      provider: "read",
      displayName: "Read AI",
      capabilities: {
        connectionMode: "webhook-only",
        manualSync: false,
        supportsWebhookSecret: true,
      },
      verifyWebhookRequest: jest.fn(),
      parseWebhookPayload: jest.fn(),
      validateCredentials: jest.fn(),
    } as any);
    mockedUpsert.mockResolvedValue({
      _id: "read-connection",
      workspaceId: "ws-1",
      userId: "user-1",
      provider: "read",
      status: "active",
      apiKey: null,
      accountName: "Read AI webhook",
      webhookSecret: "signing-key",
      webhookToken: "routing-token",
      createdAt: new Date("2026-09-11T00:00:00Z"),
      updatedAt: new Date("2026-09-11T00:00:00Z"),
      revokedAt: null,
    } as any);
  });

  it("connects with a webhook signing key and does not require or validate an api key", async () => {
    const request = new Request("http://localhost/api/integrations/read", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ webhookSecret: " signing-key " }),
    });

    const response = await POST(request, params);

    expect(response.status).toBe(200);
    expect(mockedUpsert).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        workspaceId: "ws-1",
        userId: "user-1",
        provider: "read",
        apiKey: null,
        webhookSecret: "signing-key",
      })
    );
    expect(mockedAdapter.mock.results[0].value?.validateCredentials).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      capabilities: { connectionMode: "webhook-only", manualSync: false },
      connection: { hasApiKey: false, hasWebhookSecret: true },
    });
  });

  it("rejects a webhook-only connection without a signing key", async () => {
    const request = new Request("http://localhost/api/integrations/read", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    const response = await POST(request, params);
    expect(response.status).toBe(400);
    expect(mockedUpsert).not.toHaveBeenCalled();
  });
});
