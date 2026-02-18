import { POST } from "@/app/api/workspace-invitations/route";
import { getSessionUserId } from "@/lib/server-auth";
import { findUserById } from "@/lib/db/users";
import { getDb } from "@/lib/db";
import { assertWorkspaceAccess, ensureWorkspaceBootstrapForUser, getActiveWorkspaceForUser } from "@/lib/workspace-context";
import {
  createWorkspaceInvitation,
  ensureWorkspaceInvitationIndexes,
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
  createWorkspaceInvitation: jest.fn(),
  ensureWorkspaceInvitationIndexes: jest.fn(),
}));

jest.mock("@/lib/workspace-context", () => ({
  assertWorkspaceAccess: jest.fn(),
  ensureWorkspaceBootstrapForUser: jest.fn(),
  getActiveWorkspaceForUser: jest.fn(),
}));

const mockedGetSessionUserId = getSessionUserId as jest.MockedFunction<
  typeof getSessionUserId
>;
const mockedFindUserById = findUserById as jest.MockedFunction<typeof findUserById>;
const mockedGetDb = getDb as jest.MockedFunction<typeof getDb>;
const mockedEnsureWorkspaceInvitationIndexes =
  ensureWorkspaceInvitationIndexes as jest.MockedFunction<
    typeof ensureWorkspaceInvitationIndexes
  >;
const mockedCreateWorkspaceInvitation =
  createWorkspaceInvitation as jest.MockedFunction<
    typeof createWorkspaceInvitation
  >;
const mockedAssertWorkspaceAccess = assertWorkspaceAccess as jest.MockedFunction<
  typeof assertWorkspaceAccess
>;
const mockedEnsureWorkspaceBootstrapForUser =
  ensureWorkspaceBootstrapForUser as jest.MockedFunction<
    typeof ensureWorkspaceBootstrapForUser
  >;
const mockedGetActiveWorkspaceForUser =
  getActiveWorkspaceForUser as jest.MockedFunction<typeof getActiveWorkspaceForUser>;

describe("POST /api/workspace-invitations", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetSessionUserId.mockResolvedValue("user-1");
    mockedGetDb.mockResolvedValue({} as any);
    mockedEnsureWorkspaceInvitationIndexes.mockResolvedValue(undefined as never);
    mockedEnsureWorkspaceBootstrapForUser.mockResolvedValue({
      id: "workspace-1",
      name: "Main Workspace",
    } as never);
    mockedGetActiveWorkspaceForUser.mockResolvedValue({
      id: "workspace-1",
      name: "Main Workspace",
    });
    mockedAssertWorkspaceAccess.mockResolvedValue({
      workspace: { _id: "workspace-1" },
      membership: { role: "owner" },
    } as any);
    mockedFindUserById.mockResolvedValue({
      _id: { toString: () => "user-1" },
      email: "owner@example.com",
      workspace: {
        id: "workspace-1",
        name: "Main Workspace",
      },
    } as any);
    mockedCreateWorkspaceInvitation.mockResolvedValue({
      _id: "invite-token",
      workspaceId: "workspace-1",
      workspaceName: "Main Workspace",
      inviterUserId: "user-1",
      inviterEmail: "owner@example.com",
      invitedEmail: "member@example.com",
      status: "pending",
      createdAt: new Date("2026-02-16T00:00:00.000Z"),
      expiresAt: new Date("2026-02-23T00:00:00.000Z"),
    } as any);
  });

  it("returns unauthorized when no session is present", async () => {
    mockedGetSessionUserId.mockResolvedValue(null);
    const response = await POST(
      new Request("http://localhost/api/workspace-invitations", {
        method: "POST",
        body: JSON.stringify({}),
      })
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "Unauthorized",
    });
  });

  it("creates and returns a workspace invitation link", async () => {
    const response = await POST(
      new Request("http://localhost/api/workspace-invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invitedEmail: "member@example.com" }),
      })
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({
      ok: true,
      invitation: {
        token: "invite-token",
        workspaceId: "workspace-1",
        workspaceName: "Main Workspace",
        invitationUrl: "http://localhost/invite/invite-token",
      },
    });
    expect(mockedEnsureWorkspaceInvitationIndexes).toHaveBeenCalled();
    expect(mockedCreateWorkspaceInvitation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        workspaceId: "workspace-1",
        workspaceName: "Main Workspace",
        inviterUserId: "user-1",
        role: "member",
        invitedEmail: "member@example.com",
      })
    );
    expect(mockedAssertWorkspaceAccess).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      "workspace-1",
      "admin"
    );
  });
});
