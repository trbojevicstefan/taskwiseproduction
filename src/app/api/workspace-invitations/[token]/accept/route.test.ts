import { POST } from "@/app/api/workspace-invitations/[token]/accept/route";
import { getSessionUserId } from "@/lib/server-auth";
import { findUserById } from "@/lib/db/users";
import { getDb } from "@/lib/db";
import {
  createWorkspaceMembership,
  findWorkspaceMembership,
  updateWorkspaceMembershipById,
} from "@/lib/workspace-memberships";
import { setActiveWorkspaceForUser } from "@/lib/workspace-context";
import {
  ensureWorkspaceInvitationIndexes,
  findWorkspaceInvitationByToken,
  isWorkspaceInvitationExpired,
  markWorkspaceInvitationAccepted,
  markWorkspaceInvitationExpired,
} from "@/lib/workspace-invitations";

jest.mock("@/lib/server-auth", () => ({
  getSessionUserId: jest.fn(),
}));

jest.mock("@/lib/db/users", () => ({
  findUserById: jest.fn(),
}));

jest.mock("@/lib/db", () => ({
  getDb: jest.fn(),
}));

jest.mock("@/lib/workspace-invitations", () => ({
  ensureWorkspaceInvitationIndexes: jest.fn(),
  findWorkspaceInvitationByToken: jest.fn(),
  isWorkspaceInvitationExpired: jest.fn(),
  markWorkspaceInvitationAccepted: jest.fn(),
  markWorkspaceInvitationExpired: jest.fn(),
  normalizeInviteEmail: (email?: string | null) =>
    email ? email.trim().toLowerCase() : null,
}));

jest.mock("@/lib/workspace-memberships", () => ({
  createWorkspaceMembership: jest.fn(),
  findWorkspaceMembership: jest.fn(),
  updateWorkspaceMembershipById: jest.fn(),
}));

jest.mock("@/lib/workspace-context", () => ({
  setActiveWorkspaceForUser: jest.fn(),
}));

jest.mock("@/lib/observability-metrics", () => ({
  recordWorkspaceActionMetric: jest.fn(),
}));

const mockedGetSessionUserId = getSessionUserId as jest.MockedFunction<
  typeof getSessionUserId
>;
const mockedFindUserById = findUserById as jest.MockedFunction<typeof findUserById>;
const mockedGetDb = getDb as jest.MockedFunction<typeof getDb>;
const mockedCreateWorkspaceMembership =
  createWorkspaceMembership as jest.MockedFunction<typeof createWorkspaceMembership>;
const mockedFindWorkspaceMembership =
  findWorkspaceMembership as jest.MockedFunction<typeof findWorkspaceMembership>;
const mockedUpdateWorkspaceMembershipById =
  updateWorkspaceMembershipById as jest.MockedFunction<
    typeof updateWorkspaceMembershipById
  >;
const mockedSetActiveWorkspaceForUser =
  setActiveWorkspaceForUser as jest.MockedFunction<typeof setActiveWorkspaceForUser>;
const mockedEnsureWorkspaceInvitationIndexes =
  ensureWorkspaceInvitationIndexes as jest.MockedFunction<
    typeof ensureWorkspaceInvitationIndexes
  >;
const mockedFindWorkspaceInvitationByToken =
  findWorkspaceInvitationByToken as jest.MockedFunction<
    typeof findWorkspaceInvitationByToken
  >;
const mockedIsWorkspaceInvitationExpired =
  isWorkspaceInvitationExpired as jest.MockedFunction<
    typeof isWorkspaceInvitationExpired
  >;
const mockedMarkWorkspaceInvitationAccepted =
  markWorkspaceInvitationAccepted as jest.MockedFunction<
    typeof markWorkspaceInvitationAccepted
  >;
const mockedMarkWorkspaceInvitationExpired =
  markWorkspaceInvitationExpired as jest.MockedFunction<
    typeof markWorkspaceInvitationExpired
  >;

describe("POST /api/workspace-invitations/[token]/accept", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetSessionUserId.mockResolvedValue("user-2");
    mockedGetDb.mockResolvedValue({} as any);
    mockedEnsureWorkspaceInvitationIndexes.mockResolvedValue(undefined as never);
    mockedFindWorkspaceInvitationByToken.mockResolvedValue({
      _id: "invite-token",
      workspaceId: "workspace-1",
      workspaceName: "Main Workspace",
      invitedEmail: "member@example.com",
      status: "pending",
      expiresAt: new Date("2026-12-31T00:00:00.000Z"),
    } as any);
    mockedIsWorkspaceInvitationExpired.mockReturnValue(false);
    mockedFindUserById.mockResolvedValue({
      _id: { toString: () => "user-2" },
      email: "member@example.com",
      activeWorkspaceId: null,
    } as any);
    mockedFindWorkspaceMembership.mockResolvedValue(null);
    mockedCreateWorkspaceMembership.mockResolvedValue({
      _id: "membership-1",
      workspaceId: "workspace-1",
      userId: "user-2",
      role: "member",
      status: "active",
      createdAt: new Date("2026-02-18T00:00:00.000Z"),
      updatedAt: new Date("2026-02-18T00:00:00.000Z"),
    } as any);
    mockedUpdateWorkspaceMembershipById.mockResolvedValue(undefined as never);
    mockedSetActiveWorkspaceForUser.mockResolvedValue({
      id: "workspace-1",
      name: "Main Workspace",
    });
    mockedMarkWorkspaceInvitationAccepted.mockResolvedValue({ matchedCount: 1 } as never);
    mockedMarkWorkspaceInvitationExpired.mockResolvedValue(undefined as never);
  });

  it("accepts a valid workspace invitation", async () => {
    const response = await POST(new Request("http://localhost"), {
      params: { token: "invite-token" },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      workspace: {
        id: "workspace-1",
        name: "Main Workspace",
      },
      switchedActiveWorkspace: true,
      membershipId: "membership-1",
    });
    expect(mockedCreateWorkspaceMembership).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        workspaceId: "workspace-1",
        userId: "user-2",
        role: "member",
      })
    );
    expect(mockedMarkWorkspaceInvitationAccepted).toHaveBeenCalledWith(
      expect.anything(),
      "invite-token",
      "user-2",
      expect.objectContaining({ acceptedMembershipId: "membership-1" })
    );
  });

  it("rejects invitation acceptance for non-matching invited email", async () => {
    mockedFindUserById.mockResolvedValue({
      _id: { toString: () => "user-2" },
      email: "other@example.com",
    } as any);

    const response = await POST(new Request("http://localhost"), {
      params: { token: "invite-token" },
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      errorCode: "forbidden",
    });
    expect(mockedCreateWorkspaceMembership).not.toHaveBeenCalled();
  });

  it("returns gone and marks invitation expired when invitation is expired", async () => {
    mockedIsWorkspaceInvitationExpired.mockReturnValue(true);

    const response = await POST(new Request("http://localhost"), {
      params: { token: "invite-token" },
    });

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      errorCode: "gone",
    });
    expect(mockedMarkWorkspaceInvitationExpired).toHaveBeenCalledWith(
      expect.anything(),
      "invite-token"
    );
  });

  it("returns conflict when invitation is not pending", async () => {
    mockedFindWorkspaceInvitationByToken.mockResolvedValue({
      _id: "invite-token",
      workspaceId: "workspace-1",
      workspaceName: "Main Workspace",
      invitedEmail: "member@example.com",
      status: "revoked",
      expiresAt: new Date("2026-12-31T00:00:00.000Z"),
    } as any);

    const response = await POST(new Request("http://localhost"), {
      params: { token: "invite-token" },
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      errorCode: "conflict",
    });
  });

  it("is idempotent when invitation was already accepted by the same user", async () => {
    mockedFindWorkspaceInvitationByToken.mockResolvedValue({
      _id: "invite-token",
      workspaceId: "workspace-1",
      workspaceName: "Main Workspace",
      invitedEmail: "member@example.com",
      status: "accepted",
      acceptedByUserId: "user-2",
      expiresAt: new Date("2026-12-31T00:00:00.000Z"),
    } as any);

    const response = await POST(new Request("http://localhost"), {
      params: { token: "invite-token" },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      workspace: {
        id: "workspace-1",
        name: "Main Workspace",
      },
      switchedActiveWorkspace: false,
    });
  });

  it("keeps existing active workspace when policy does not force switching", async () => {
    mockedFindUserById.mockResolvedValue({
      _id: { toString: () => "user-2" },
      email: "member@example.com",
      activeWorkspaceId: "workspace-existing",
    } as any);

    const response = await POST(new Request("http://localhost"), {
      params: { token: "invite-token" },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      switchedActiveWorkspace: false,
      activeWorkspaceId: "workspace-existing",
    });
    expect(mockedSetActiveWorkspaceForUser).not.toHaveBeenCalled();
  });
});
