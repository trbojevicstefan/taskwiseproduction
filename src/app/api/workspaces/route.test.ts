import { GET, POST } from "@/app/api/workspaces/route";
import { getSessionUserId } from "@/lib/server-auth";
import { getDb } from "@/lib/db";
import {
  ensureWorkspaceBootstrapForUser,
  getActiveWorkspaceIdForUser,
  setActiveWorkspaceForUser,
} from "@/lib/workspace-context";
import {
  createWorkspace,
  ensureWorkspaceIndexes,
  listWorkspacesByIds,
} from "@/lib/workspaces";
import {
  createWorkspaceMembership,
  ensureWorkspaceMembershipIndexes,
  listActiveWorkspaceMembershipsForUser,
} from "@/lib/workspace-memberships";

jest.mock("@/lib/server-auth", () => ({
  getSessionUserId: jest.fn(),
}));

jest.mock("@/lib/db", () => ({
  getDb: jest.fn(),
}));

jest.mock("@/lib/workspace-context", () => ({
  ensureWorkspaceBootstrapForUser: jest.fn(),
  getActiveWorkspaceIdForUser: jest.fn(),
  setActiveWorkspaceForUser: jest.fn(),
}));

jest.mock("@/lib/workspaces", () => ({
  createWorkspace: jest.fn(),
  ensureWorkspaceIndexes: jest.fn(),
  listWorkspacesByIds: jest.fn(),
}));

jest.mock("@/lib/workspace-memberships", () => ({
  createWorkspaceMembership: jest.fn(),
  ensureWorkspaceMembershipIndexes: jest.fn(),
  listActiveWorkspaceMembershipsForUser: jest.fn(),
}));

const mockedGetSessionUserId = getSessionUserId as jest.MockedFunction<
  typeof getSessionUserId
>;
const mockedGetDb = getDb as jest.MockedFunction<typeof getDb>;
const mockedEnsureWorkspaceBootstrapForUser =
  ensureWorkspaceBootstrapForUser as jest.MockedFunction<
    typeof ensureWorkspaceBootstrapForUser
  >;
const mockedGetActiveWorkspaceIdForUser =
  getActiveWorkspaceIdForUser as jest.MockedFunction<
    typeof getActiveWorkspaceIdForUser
  >;
const mockedSetActiveWorkspaceForUser =
  setActiveWorkspaceForUser as jest.MockedFunction<typeof setActiveWorkspaceForUser>;
const mockedCreateWorkspace = createWorkspace as jest.MockedFunction<
  typeof createWorkspace
>;
const mockedEnsureWorkspaceIndexes =
  ensureWorkspaceIndexes as jest.MockedFunction<typeof ensureWorkspaceIndexes>;
const mockedListWorkspacesByIds = listWorkspacesByIds as jest.MockedFunction<
  typeof listWorkspacesByIds
>;
const mockedCreateWorkspaceMembership =
  createWorkspaceMembership as jest.MockedFunction<typeof createWorkspaceMembership>;
const mockedEnsureWorkspaceMembershipIndexes =
  ensureWorkspaceMembershipIndexes as jest.MockedFunction<
    typeof ensureWorkspaceMembershipIndexes
  >;
const mockedListActiveWorkspaceMembershipsForUser =
  listActiveWorkspaceMembershipsForUser as jest.MockedFunction<
    typeof listActiveWorkspaceMembershipsForUser
  >;

describe("GET /api/workspaces", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetSessionUserId.mockResolvedValue("user-1");
    mockedGetDb.mockResolvedValue({} as any);
    mockedEnsureWorkspaceBootstrapForUser.mockResolvedValue({
      id: "workspace-1",
      name: "Main Workspace",
    } as any);
    mockedGetActiveWorkspaceIdForUser.mockResolvedValue("workspace-1");
    mockedListActiveWorkspaceMembershipsForUser.mockResolvedValue([
      {
        _id: "membership-1",
        workspaceId: "workspace-1",
        userId: "user-1",
        role: "owner",
        status: "active",
      },
      {
        _id: "membership-2",
        workspaceId: "workspace-2",
        userId: "user-1",
        role: "member",
        status: "active",
      },
    ] as any);
    mockedListWorkspacesByIds.mockResolvedValue([
      {
        _id: "workspace-1",
        name: "Main Workspace",
        slug: null,
        status: "active",
        createdAt: new Date("2026-02-18T00:00:00.000Z"),
        updatedAt: new Date("2026-02-18T00:00:00.000Z"),
      },
      {
        _id: "workspace-2",
        name: "Client Workspace",
        slug: null,
        status: "active",
        createdAt: new Date("2026-02-18T00:00:00.000Z"),
        updatedAt: new Date("2026-02-18T00:00:00.000Z"),
      },
    ] as any);
  });

  it("returns workspace list with active marker", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      activeWorkspaceId: "workspace-1",
      workspaces: [
        expect.objectContaining({ id: "workspace-1", role: "owner", isActive: true }),
        expect.objectContaining({ id: "workspace-2", role: "member", isActive: false }),
      ],
    });
  });
});

describe("POST /api/workspaces", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetSessionUserId.mockResolvedValue("user-1");
    mockedGetDb.mockResolvedValue({} as any);
    mockedEnsureWorkspaceIndexes.mockResolvedValue(undefined as never);
    mockedEnsureWorkspaceMembershipIndexes.mockResolvedValue(undefined as never);
    mockedCreateWorkspace.mockResolvedValue({
      _id: "workspace-new",
      name: "New Workspace",
      slug: "new-workspace",
      status: "active",
      createdAt: new Date("2026-02-18T00:00:00.000Z"),
      updatedAt: new Date("2026-02-18T00:00:00.000Z"),
    } as any);
    mockedCreateWorkspaceMembership.mockResolvedValue({
      _id: "membership-new",
    } as any);
    mockedSetActiveWorkspaceForUser.mockResolvedValue({
      id: "workspace-new",
      name: "New Workspace",
    });
  });

  it("creates a workspace and sets it active", async () => {
    const response = await POST(
      new Request("http://localhost/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "New Workspace", slug: "new-workspace" }),
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      activeWorkspaceId: "workspace-new",
      workspace: expect.objectContaining({
        id: "workspace-new",
        name: "New Workspace",
        role: "owner",
        isActive: true,
      }),
    });
    expect(mockedCreateWorkspaceMembership).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        workspaceId: "workspace-new",
        userId: "user-1",
        role: "owner",
      })
    );
  });
});
