import { POST } from "@/app/api/workspaces/[workspaceId]/google/revoke/route";
import { revokeGoogleTokensForUser } from "@/lib/google-auth";
import { listActiveWorkspaceMembershipsForWorkspace } from "@/lib/workspace-memberships";
import { requireWorkspaceRouteAccess } from "@/lib/workspace-route-access";

jest.mock("@/lib/workspace-route-access", () => ({
  requireWorkspaceRouteAccess: jest.fn(),
}));

jest.mock("@/lib/workspace-memberships", () => ({
  listActiveWorkspaceMembershipsForWorkspace: jest.fn(),
}));

jest.mock("@/lib/google-auth", () => ({
  revokeGoogleTokensForUser: jest.fn(),
}));

const mockedRequireWorkspaceRouteAccess =
  requireWorkspaceRouteAccess as jest.MockedFunction<typeof requireWorkspaceRouteAccess>;
const mockedListActiveWorkspaceMembershipsForWorkspace =
  listActiveWorkspaceMembershipsForWorkspace as jest.MockedFunction<
    typeof listActiveWorkspaceMembershipsForWorkspace
  >;
const mockedRevokeGoogleTokensForUser =
  revokeGoogleTokensForUser as jest.MockedFunction<typeof revokeGoogleTokensForUser>;

const USER_1_ID = "507f1f77bcf86cd799439011";
const USER_2_ID = "507f1f77bcf86cd799439012";

const createAccessDb = (users: Array<{ _id: string; googleConnected: boolean }>) => {
  const toArray = jest.fn().mockResolvedValue(users);
  const find = jest.fn().mockReturnValue({ toArray });
  const collection = jest.fn().mockReturnValue({ find });
  return {
    collection,
  };
};

describe("workspace google revoke route", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedListActiveWorkspaceMembershipsForWorkspace.mockResolvedValue([
      { workspaceId: "workspace-1", userId: USER_1_ID, role: "member", status: "active" } as any,
      { workspaceId: "workspace-1", userId: USER_2_ID, role: "admin", status: "active" } as any,
    ]);
    mockedRevokeGoogleTokensForUser.mockResolvedValue({
      revokedUserId: USER_1_ID,
      remotelyRevoked: true,
    });
  });

  it("blocks members from revoking another workspace member", async () => {
    mockedRequireWorkspaceRouteAccess.mockResolvedValue({
      ok: true,
      db: createAccessDb([
        { _id: USER_1_ID, googleConnected: false },
        { _id: USER_2_ID, googleConnected: true },
      ]) as any,
      userId: USER_1_ID,
      workspace: { _id: "workspace-1", name: "Main Workspace" },
      membership: { role: "member", status: "active" },
    } as any);

    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetUserId: USER_2_ID }),
      }),
      {
        params: { workspaceId: "workspace-1" },
      }
    );
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.ok).toBe(false);
    expect(mockedRevokeGoogleTokensForUser).not.toHaveBeenCalled();
  });

  it("allows owner/admin to revoke another member's Google connection", async () => {
    mockedRequireWorkspaceRouteAccess.mockResolvedValue({
      ok: true,
      db: createAccessDb([
        { _id: USER_1_ID, googleConnected: false },
        { _id: USER_2_ID, googleConnected: true },
      ]) as any,
      userId: USER_1_ID,
      workspace: { _id: "workspace-1", name: "Main Workspace" },
      membership: { role: "owner", status: "active" },
    } as any);
    mockedRevokeGoogleTokensForUser.mockResolvedValue({
      revokedUserId: USER_2_ID,
      remotelyRevoked: true,
    });

    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetUserId: USER_2_ID }),
      }),
      {
        params: { workspaceId: "workspace-1" },
      }
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.revokedUserId).toBe(USER_2_ID);
    expect(mockedRevokeGoogleTokensForUser).toHaveBeenCalledWith(USER_2_ID, {
      workspaceId: "workspace-1",
      actorUserId: USER_1_ID,
    });
  });

  it("returns warning when remote revoke fails but local disconnect succeeds", async () => {
    mockedRequireWorkspaceRouteAccess.mockResolvedValue({
      ok: true,
      db: createAccessDb([
        { _id: USER_1_ID, googleConnected: false },
        { _id: USER_2_ID, googleConnected: true },
      ]) as any,
      userId: USER_1_ID,
      workspace: { _id: "workspace-1", name: "Main Workspace" },
      membership: { role: "admin", status: "active" },
    } as any);
    mockedRevokeGoogleTokensForUser.mockResolvedValue({
      revokedUserId: USER_2_ID,
      remotelyRevoked: false,
      warning: "Remote revoke failed with 500, local credentials were cleared.",
    });

    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
      }),
      {
        params: { workspaceId: "workspace-1" },
      }
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.remotelyRevoked).toBe(false);
    expect(payload.warning).toContain("local credentials were cleared");
    expect(mockedRevokeGoogleTokensForUser).toHaveBeenCalledWith(USER_2_ID, {
      workspaceId: "workspace-1",
      actorUserId: USER_1_ID,
    });
  });
});
