import {
  DELETE,
  PATCH,
} from "@/app/api/workspaces/[workspaceId]/members/[membershipId]/route";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import {
  assertWorkspaceAccess,
  ensureWorkspaceBootstrapForUser,
  getActiveWorkspaceIdForUser,
  setActiveWorkspaceForUser,
} from "@/lib/workspace-context";
import {
  countActiveWorkspaceMembershipsForUser,
  countActiveWorkspaceOwners,
  findWorkspaceMembershipById,
  listActiveWorkspaceMembershipsForUser,
  updateWorkspaceMembershipById,
} from "@/lib/workspace-memberships";

jest.mock("@/lib/db", () => ({
  getDb: jest.fn(),
}));

jest.mock("@/lib/server-auth", () => ({
  getSessionUserId: jest.fn(),
}));

jest.mock("@/lib/workspace-context", () => ({
  assertWorkspaceAccess: jest.fn(),
  ensureWorkspaceBootstrapForUser: jest.fn(),
  getActiveWorkspaceIdForUser: jest.fn(),
  setActiveWorkspaceForUser: jest.fn(),
}));

jest.mock("@/lib/workspace-memberships", () => ({
  countActiveWorkspaceMembershipsForUser: jest.fn(),
  countActiveWorkspaceOwners: jest.fn(),
  findWorkspaceMembershipById: jest.fn(),
  listActiveWorkspaceMembershipsForUser: jest.fn(),
  updateWorkspaceMembershipById: jest.fn(),
}));

jest.mock("@/lib/observability-metrics", () => ({
  recordWorkspaceActionMetric: jest.fn(),
}));

const mockedGetDb = getDb as jest.MockedFunction<typeof getDb>;
const mockedGetSessionUserId = getSessionUserId as jest.MockedFunction<
  typeof getSessionUserId
>;
const mockedAssertWorkspaceAccess = assertWorkspaceAccess as jest.MockedFunction<
  typeof assertWorkspaceAccess
>;
const mockedEnsureWorkspaceBootstrapForUser =
  ensureWorkspaceBootstrapForUser as jest.MockedFunction<
    typeof ensureWorkspaceBootstrapForUser
  >;
const mockedGetActiveWorkspaceIdForUser =
  getActiveWorkspaceIdForUser as jest.MockedFunction<typeof getActiveWorkspaceIdForUser>;
const mockedSetActiveWorkspaceForUser =
  setActiveWorkspaceForUser as jest.MockedFunction<typeof setActiveWorkspaceForUser>;
const mockedCountActiveWorkspaceMembershipsForUser =
  countActiveWorkspaceMembershipsForUser as jest.MockedFunction<
    typeof countActiveWorkspaceMembershipsForUser
  >;
const mockedCountActiveWorkspaceOwners =
  countActiveWorkspaceOwners as jest.MockedFunction<typeof countActiveWorkspaceOwners>;
const mockedFindWorkspaceMembershipById =
  findWorkspaceMembershipById as jest.MockedFunction<typeof findWorkspaceMembershipById>;
const mockedListActiveWorkspaceMembershipsForUser =
  listActiveWorkspaceMembershipsForUser as jest.MockedFunction<
    typeof listActiveWorkspaceMembershipsForUser
  >;
const mockedUpdateWorkspaceMembershipById =
  updateWorkspaceMembershipById as jest.MockedFunction<
    typeof updateWorkspaceMembershipById
  >;

describe("PATCH /api/workspaces/[workspaceId]/members/[membershipId]", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetDb.mockResolvedValue({} as any);
    mockedGetSessionUserId.mockResolvedValue("user-1");
    mockedEnsureWorkspaceBootstrapForUser.mockResolvedValue(null as never);
    mockedAssertWorkspaceAccess.mockResolvedValue({
      workspace: { _id: "workspace-1", name: "Main Workspace" },
      membership: { _id: "actor-membership", role: "owner", status: "active" },
    } as any);
    mockedFindWorkspaceMembershipById.mockResolvedValue({
      _id: "membership-1",
      workspaceId: "workspace-1",
      userId: "user-1",
      role: "owner",
      status: "active",
      joinedAt: new Date("2026-02-18T00:00:00.000Z"),
      updatedAt: new Date("2026-02-18T00:00:00.000Z"),
    } as any);
    mockedCountActiveWorkspaceOwners.mockResolvedValue(1);
  });

  it("blocks demoting the last owner", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/workspaces/workspace-1/members/membership-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "admin" }),
      }),
      { params: { workspaceId: "workspace-1", membershipId: "membership-1" } }
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "Cannot demote the last workspace owner.",
    });
  });
});

describe("DELETE /api/workspaces/[workspaceId]/members/[membershipId]", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetDb.mockResolvedValue({} as any);
    mockedGetSessionUserId.mockResolvedValue("user-1");
    mockedEnsureWorkspaceBootstrapForUser.mockResolvedValue(null as never);
    mockedAssertWorkspaceAccess.mockResolvedValue({
      workspace: { _id: "workspace-1", name: "Main Workspace" },
      membership: { _id: "actor-membership", role: "owner", status: "active" },
    } as any);
    mockedFindWorkspaceMembershipById.mockResolvedValue({
      _id: "membership-2",
      workspaceId: "workspace-1",
      userId: "user-2",
      role: "member",
      status: "active",
      joinedAt: new Date("2026-02-18T00:00:00.000Z"),
      updatedAt: new Date("2026-02-18T00:00:00.000Z"),
    } as any);
    mockedCountActiveWorkspaceMembershipsForUser.mockResolvedValue(2);
    mockedGetActiveWorkspaceIdForUser.mockResolvedValue("workspace-1");
    mockedListActiveWorkspaceMembershipsForUser.mockResolvedValue([
      {
        _id: "membership-9",
        workspaceId: "workspace-2",
        userId: "user-2",
        role: "member",
        status: "active",
      },
    ] as any);
    mockedSetActiveWorkspaceForUser.mockResolvedValue({
      id: "workspace-2",
      name: "Client Workspace",
    });
    mockedUpdateWorkspaceMembershipById.mockResolvedValue({
      matchedCount: 1,
      modifiedCount: 1,
      acknowledged: true,
      upsertedCount: 0,
      upsertedId: null,
    } as any);
  });

  it("marks membership as left and reassigns active workspace", async () => {
    const response = await DELETE(
      new Request("http://localhost/api/workspaces/workspace-1/members/membership-2", {
        method: "DELETE",
      }),
      { params: { workspaceId: "workspace-1", membershipId: "membership-2" } }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      membership: {
        membershipId: "membership-2",
        status: "left",
      },
      reassignedActiveWorkspaceId: "workspace-2",
    });

    expect(mockedUpdateWorkspaceMembershipById).toHaveBeenCalledWith(
      expect.anything(),
      "membership-2",
      expect.objectContaining({ status: "left" })
    );
    expect(mockedSetActiveWorkspaceForUser).toHaveBeenCalledWith(
      expect.anything(),
      "user-2",
      "workspace-2"
    );
  });
});
