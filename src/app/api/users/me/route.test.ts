import { GET } from "@/app/api/users/me/route";
import { getServerSession } from "next-auth";
import { findUserById, updateUserById } from "@/lib/db/users";
import { getDb } from "@/lib/db";
import { ensureWorkspaceBootstrapForUser } from "@/lib/workspace-context";
import {
  listActiveWorkspaceMembershipsForWorkspace,
  listWorkspaceMembershipsForUser,
} from "@/lib/workspace-memberships";
import { findWorkspaceById, listWorkspacesByIds } from "@/lib/workspaces";

jest.mock("next-auth", () => ({
  getServerSession: jest.fn(),
}));

jest.mock("@/lib/db/users", () => ({
  findUserById: jest.fn(),
  updateUserById: jest.fn(),
}));

jest.mock("@/lib/db", () => ({
  getDb: jest.fn(),
}));

jest.mock("@/lib/workspace-context", () => ({
  ensureWorkspaceBootstrapForUser: jest.fn(),
}));

jest.mock("@/lib/workspace-memberships", () => ({
  listWorkspaceMembershipsForUser: jest.fn(),
  listActiveWorkspaceMembershipsForWorkspace: jest.fn(),
}));

jest.mock("@/lib/workspaces", () => ({
  listWorkspacesByIds: jest.fn(),
  findWorkspaceById: jest.fn(),
}));

const mockedGetServerSession = getServerSession as jest.MockedFunction<
  typeof getServerSession
>;
const mockedFindUserById = findUserById as jest.MockedFunction<typeof findUserById>;
const mockedUpdateUserById = updateUserById as jest.MockedFunction<typeof updateUserById>;
const mockedGetDb = getDb as jest.MockedFunction<typeof getDb>;
const mockedEnsureWorkspaceBootstrapForUser =
  ensureWorkspaceBootstrapForUser as jest.MockedFunction<
    typeof ensureWorkspaceBootstrapForUser
  >;
const mockedListWorkspaceMembershipsForUser =
  listWorkspaceMembershipsForUser as jest.MockedFunction<
    typeof listWorkspaceMembershipsForUser
  >;
const mockedListActiveWorkspaceMembershipsForWorkspace =
  listActiveWorkspaceMembershipsForWorkspace as jest.MockedFunction<
    typeof listActiveWorkspaceMembershipsForWorkspace
  >;
const mockedListWorkspacesByIds = listWorkspacesByIds as jest.MockedFunction<
  typeof listWorkspacesByIds
>;
const mockedFindWorkspaceById = findWorkspaceById as jest.MockedFunction<
  typeof findWorkspaceById
>;

describe("GET /api/users/me compatibility", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetServerSession.mockResolvedValue({
      user: { id: "user-1" },
    } as any);
    mockedGetDb.mockResolvedValue({} as any);
    mockedEnsureWorkspaceBootstrapForUser.mockResolvedValue({
      id: "workspace-1",
      name: "Main Workspace",
    } as any);
    mockedFindUserById.mockResolvedValue({
      _id: { toString: () => "user-1" },
      email: "user@example.com",
      name: "User",
      avatarUrl: null,
      sourceSessionIds: [],
      createdAt: new Date("2026-02-18T00:00:00.000Z"),
      lastUpdated: new Date("2026-02-18T00:00:00.000Z"),
      lastSeenAt: new Date("2026-02-18T00:00:00.000Z"),
      onboardingCompleted: true,
      workspace: { id: "workspace-1", name: "Main Workspace" },
      activeWorkspaceId: null,
      firefliesWebhookToken: null,
    } as any);
    mockedUpdateUserById.mockResolvedValue(undefined as never);
    mockedListWorkspaceMembershipsForUser.mockResolvedValue([
      {
        _id: "membership-1",
        workspaceId: "workspace-1",
        role: "owner",
        status: "active",
        joinedAt: new Date("2026-02-18T00:00:00.000Z"),
        updatedAt: new Date("2026-02-18T00:00:00.000Z"),
      },
    ] as any);
    mockedListWorkspacesByIds.mockResolvedValue([
      {
        _id: "workspace-1",
        name: "Main Workspace",
        settings: null,
      },
    ] as any);
    mockedListActiveWorkspaceMembershipsForWorkspace.mockResolvedValue([] as any);
    mockedFindWorkspaceById.mockResolvedValue({
      _id: "workspace-1",
      name: "Main Workspace",
      settings: null,
    } as any);
  });

  it("hydrates activeWorkspaceId for legacy users and returns membership summary", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      activeWorkspaceId: "workspace-1",
      workspaceMemberships: [
        expect.objectContaining({
          workspaceId: "workspace-1",
          workspaceName: "Main Workspace",
          role: "owner",
          status: "active",
          isActive: true,
        }),
      ],
    });
    expect(mockedUpdateUserById).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({
        workspace: { id: "workspace-1", name: "Main Workspace" },
        activeWorkspaceId: "workspace-1",
      })
    );
  });
});
