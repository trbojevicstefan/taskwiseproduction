import { DELETE, GET } from "@/app/api/trello/connection/route";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { buildTrelloAuthorizeUrl, isTrelloConfigured } from "@/lib/trelloAPI";
import {
  findTrelloConnectionForWorkspace,
  revokeTrelloConnection,
} from "@/lib/trello-connections";
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

jest.mock("@/lib/trelloAPI", () => {
  const actual = jest.requireActual("@/lib/trelloAPI");
  return {
    ...actual,
    isTrelloConfigured: jest.fn(() => true),
    buildTrelloAuthorizeUrl: jest.fn(
      () => "https://trello.com/1/authorize?key=public-key"
    ),
  };
});

jest.mock("@/lib/trello-connections", () => {
  const actual = jest.requireActual("@/lib/trello-connections");
  return {
    ...actual,
    findTrelloConnectionForWorkspace: jest.fn(),
    revokeTrelloConnection: jest.fn(),
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
const mockedIsTrelloConfigured = isTrelloConfigured as jest.MockedFunction<
  typeof isTrelloConfigured
>;
const mockedBuildAuthorizeUrl = buildTrelloAuthorizeUrl as jest.MockedFunction<
  typeof buildTrelloAuthorizeUrl
>;
const mockedFindConnection =
  findTrelloConnectionForWorkspace as jest.MockedFunction<
    typeof findTrelloConnectionForWorkspace
  >;
const mockedRevokeConnection = revokeTrelloConnection as jest.MockedFunction<
  typeof revokeTrelloConnection
>;

const buildConnection = (overrides: Record<string, any> = {}) => ({
  _id: "trello-conn-1",
  workspaceId: "workspace-1",
  userId: "user-1",
  status: "active" as const,
  token: "secret-trello-token",
  memberId: "member-1",
  memberUsername: "jane",
  memberFullName: "Jane Doe",
  createdAt: new Date("2026-07-01T00:00:00Z"),
  updatedAt: new Date("2026-07-01T00:00:00Z"),
  revokedAt: null,
  ...overrides,
});

describe("/api/trello/connection", () => {
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
    mockedIsTrelloConfigured.mockReturnValue(true);
    mockedBuildAuthorizeUrl.mockReturnValue(
      "https://trello.com/1/authorize?key=public-key"
    );
    mockedFindConnection.mockResolvedValue(buildConnection() as any);
    mockedRevokeConnection.mockResolvedValue(
      buildConnection({
        status: "revoked",
        token: null,
        revokedAt: new Date("2026-07-06T00:00:00Z"),
      }) as any
    );
  });

  it("GET returns 401 without a session user", async () => {
    mockedGetSessionUserId.mockResolvedValue(null as any);

    const response = await GET(new Request("http://localhost/api/trello/connection"));

    expect(response.status).toBe(401);
  });

  it("GET returns the status and authorize URL without the token", async () => {
    const response = await GET(new Request("http://localhost/api/trello/connection"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      ok: true,
      configured: true,
      authorizeUrl: "https://trello.com/1/authorize?key=public-key",
      connection: expect.objectContaining({
        status: "active",
        hasToken: true,
        memberUsername: "jane",
      }),
    });
    expect(body.connection.token).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("secret-trello-token");
  });

  it("GET returns a null connection when the workspace never connected", async () => {
    mockedFindConnection.mockResolvedValue(null as any);

    const response = await GET(new Request("http://localhost/api/trello/connection"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      connection: null,
    });
  });

  it("DELETE returns 401 without a session user", async () => {
    mockedGetSessionUserId.mockResolvedValue(null as any);

    const response = await DELETE(
      new Request("http://localhost/api/trello/connection", { method: "DELETE" })
    );

    expect(response.status).toBe(401);
    expect(mockedRevokeConnection).not.toHaveBeenCalled();
  });

  it("DELETE revokes the workspace connection", async () => {
    const response = await DELETE(
      new Request("http://localhost/api/trello/connection", { method: "DELETE" })
    );

    expect(response.status).toBe(200);
    expect(mockedRevokeConnection).toHaveBeenCalledWith(
      expect.anything(),
      "workspace-1"
    );
    const body = await response.json();
    expect(body.connection.status).toBe("revoked");
    expect(body.connection.hasToken).toBe(false);
  });

  it("DELETE returns 404 when there is nothing to revoke", async () => {
    mockedRevokeConnection.mockResolvedValue(null as any);

    const response = await DELETE(
      new Request("http://localhost/api/trello/connection", { method: "DELETE" })
    );

    expect(response.status).toBe(404);
  });
});
