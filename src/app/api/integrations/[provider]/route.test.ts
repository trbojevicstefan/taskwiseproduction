import { DELETE, GET, POST } from "@/app/api/integrations/[provider]/route";
import { getDb } from "@/lib/db";
import {
  findMeetingConnectionForWorkspace,
  revokeMeetingConnection,
  upsertMeetingConnection,
} from "@/lib/meeting-connections";
import { getMeetingProviderAdapter } from "@/lib/meeting-providers";
import { getSessionUserId } from "@/lib/server-auth";
import { resolveWorkspaceScopeForUser } from "@/lib/workspace-scope";

jest.mock("@/lib/db", () => ({
  getDb: jest.fn(),
}));

jest.mock("@/lib/server-auth", () => ({
  getSessionUserId: jest.fn(),
}));

jest.mock("@/lib/workspace-scope", () => ({
  resolveWorkspaceScopeForUser: jest.fn(),
}));

jest.mock("@/lib/meeting-connections", () => {
  const actual = jest.requireActual("@/lib/meeting-connections");
  return {
    ...actual,
    findMeetingConnectionForWorkspace: jest.fn(),
    revokeMeetingConnection: jest.fn(),
    upsertMeetingConnection: jest.fn(),
  };
});

jest.mock("@/lib/meeting-providers", () => {
  const actual = jest.requireActual("@/lib/meeting-providers/types");
  return {
    getMeetingProviderAdapter: jest.fn(),
    ProviderNotImplementedError: actual.ProviderNotImplementedError,
  };
});

jest.mock("@/lib/observability-metrics", () => ({
  recordRouteMetric: jest.fn(),
}));

const mockedGetDb = getDb as jest.MockedFunction<typeof getDb>;
const mockedGetSessionUserId = getSessionUserId as jest.MockedFunction<
  typeof getSessionUserId
>;
const mockedResolveWorkspaceScopeForUser =
  resolveWorkspaceScopeForUser as jest.MockedFunction<
    typeof resolveWorkspaceScopeForUser
  >;
const mockedGetAdapter = getMeetingProviderAdapter as jest.MockedFunction<
  typeof getMeetingProviderAdapter
>;
const mockedUpsertConnection = upsertMeetingConnection as jest.MockedFunction<
  typeof upsertMeetingConnection
>;
const mockedFindConnection =
  findMeetingConnectionForWorkspace as jest.MockedFunction<
    typeof findMeetingConnectionForWorkspace
  >;
const mockedRevokeConnection = revokeMeetingConnection as jest.MockedFunction<
  typeof revokeMeetingConnection
>;

const buildAdapter = (overrides: Record<string, any> = {}) => ({
  provider: "fireflies",
  displayName: "Fireflies.ai",
  verifyWebhookRequest: jest.fn(),
  parseWebhookPayload: jest.fn(),
  validateCredentials: jest
    .fn()
    .mockResolvedValue({ ok: true, accountName: "Acme" }),
  ...overrides,
});

const buildConnection = (overrides: Record<string, any> = {}) => ({
  _id: "connection-1",
  workspaceId: "workspace-1",
  userId: "user-1",
  provider: "fireflies" as const,
  status: "active" as const,
  apiKey: "secret-key",
  accountName: "Acme",
  webhookSecret: null,
  webhookToken: "hook-token",
  createdAt: new Date("2026-07-01T00:00:00Z"),
  updatedAt: new Date("2026-07-01T00:00:00Z"),
  revokedAt: null,
  ...overrides,
});

const buildPostRequest = (provider: string, body: unknown = { apiKey: "api-key" }) =>
  new Request(`http://localhost/api/integrations/${provider}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const params = (provider: string) => ({
  params: Promise.resolve({ provider }),
});

describe("/api/integrations/[provider]", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetDb.mockResolvedValue({} as any);
    mockedGetSessionUserId.mockResolvedValue("user-1");
    mockedResolveWorkspaceScopeForUser.mockResolvedValue({
      workspaceId: "workspace-1",
      workspace: null as any,
      membership: null as any,
      workspaceMemberUserIds: ["user-1"],
    } as any);
    mockedGetAdapter.mockReturnValue(buildAdapter() as any);
    mockedUpsertConnection.mockResolvedValue(buildConnection() as any);
    mockedFindConnection.mockResolvedValue(buildConnection() as any);
    mockedRevokeConnection.mockResolvedValue(
      buildConnection({ status: "revoked", revokedAt: new Date() }) as any
    );
  });

  it("returns 404 for unknown providers", async () => {
    mockedGetAdapter.mockReturnValue(null);

    const response = await POST(buildPostRequest("otter"), params("otter"));

    expect(response.status).toBe(404);
    expect(mockedUpsertConnection).not.toHaveBeenCalled();
  });

  it("returns 404 for fathom (has bespoke routes)", async () => {
    mockedGetAdapter.mockReturnValue(
      buildAdapter({ provider: "fathom", legacyWebhook: true }) as any
    );

    const postResponse = await POST(buildPostRequest("fathom"), params("fathom"));
    const getResponse = await GET(
      new Request("http://localhost/api/integrations/fathom"),
      params("fathom")
    );
    const deleteResponse = await DELETE(
      new Request("http://localhost/api/integrations/fathom", { method: "DELETE" }),
      params("fathom")
    );

    expect(postResponse.status).toBe(404);
    expect(getResponse.status).toBe(404);
    expect(deleteResponse.status).toBe(404);
  });

  it("returns 401 without a session user", async () => {
    mockedGetSessionUserId.mockResolvedValue(null as any);

    const response = await POST(buildPostRequest("fireflies"), params("fireflies"));

    expect(response.status).toBe(401);
    expect(mockedUpsertConnection).not.toHaveBeenCalled();
  });

  it("rejects invalid credentials with 400 and does not store them", async () => {
    mockedGetAdapter.mockReturnValue(
      buildAdapter({
        validateCredentials: jest
          .fn()
          .mockResolvedValue({ ok: false, error: "Bad key" }),
      }) as any
    );

    const response = await POST(buildPostRequest("fireflies"), params("fireflies"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      errorCode: "invalid_credentials",
      error: "Bad key",
    });
    expect(mockedUpsertConnection).not.toHaveBeenCalled();
  });

  it("validates and upserts the connection without leaking the api key", async () => {
    const adapter = buildAdapter();
    mockedGetAdapter.mockReturnValue(adapter as any);

    const response = await POST(buildPostRequest("fireflies"), params("fireflies"));

    expect(response.status).toBe(200);
    expect(adapter.validateCredentials).toHaveBeenCalledWith({ apiKey: "api-key" });
    expect(mockedUpsertConnection).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        workspaceId: "workspace-1",
        userId: "user-1",
        provider: "fireflies",
        apiKey: "api-key",
        accountName: "Acme",
      })
    );
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.connection.hasApiKey).toBe(true);
    expect(body.connection.apiKey).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("secret-key");
  });

  it("returns 501 when the adapter credentials check is not implemented", async () => {
    const { ProviderNotImplementedError } = jest.requireActual(
      "@/lib/meeting-providers/types"
    );
    mockedGetAdapter.mockReturnValue(
      buildAdapter({
        validateCredentials: jest.fn().mockRejectedValue(
          new ProviderNotImplementedError("fireflies", "validateCredentials")
        ),
      }) as any
    );

    const response = await POST(buildPostRequest("fireflies"), params("fireflies"));

    expect(response.status).toBe(501);
    expect(mockedUpsertConnection).not.toHaveBeenCalled();
  });

  it("GET returns the connection status without the api key", async () => {
    const response = await GET(
      new Request("http://localhost/api/integrations/fireflies"),
      params("fireflies")
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      ok: true,
      provider: "fireflies",
      displayName: "Fireflies.ai",
      connection: expect.objectContaining({
        id: "connection-1",
        status: "active",
        hasApiKey: true,
      }),
    });
    expect(body.connection.apiKey).toBeUndefined();
  });

  it("GET returns a null connection when none exists", async () => {
    mockedFindConnection.mockResolvedValue(null as any);

    const response = await GET(
      new Request("http://localhost/api/integrations/grain"),
      params("fireflies")
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      connection: null,
    });
  });

  it("DELETE marks the connection revoked", async () => {
    const response = await DELETE(
      new Request("http://localhost/api/integrations/fireflies", {
        method: "DELETE",
      }),
      params("fireflies")
    );

    expect(response.status).toBe(200);
    expect(mockedRevokeConnection).toHaveBeenCalledWith(
      expect.anything(),
      "workspace-1",
      "fireflies"
    );
    const body = await response.json();
    expect(body.connection.status).toBe("revoked");
  });

  it("DELETE returns 404 when there is nothing to revoke", async () => {
    mockedRevokeConnection.mockResolvedValue(null as any);

    const response = await DELETE(
      new Request("http://localhost/api/integrations/fireflies", {
        method: "DELETE",
      }),
      params("fireflies")
    );

    expect(response.status).toBe(404);
  });
});
