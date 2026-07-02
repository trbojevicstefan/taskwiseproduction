import { POST } from "@/app/api/workspaces/[workspaceId]/members/invite/route";
import { getDb } from "@/lib/db";
import { findUserById } from "@/lib/db/users";
import { getSessionUserId } from "@/lib/server-auth";
import {
  assertWorkspaceAccess,
  ensureWorkspaceBootstrapForUser,
} from "@/lib/workspace-context";
import {
  createWorkspaceInvitation,
  ensureWorkspaceInvitationIndexes,
} from "@/lib/workspace-invitations";

jest.mock("@/lib/db", () => ({
  getDb: jest.fn(),
}));

jest.mock("@/lib/db/users", () => ({
  findUserById: jest.fn(),
}));

jest.mock("@/lib/server-auth", () => ({
  getSessionUserId: jest.fn(),
}));

jest.mock("@/lib/workspace-context", () => ({
  assertWorkspaceAccess: jest.fn(),
  ensureWorkspaceBootstrapForUser: jest.fn(),
}));

jest.mock("@/lib/workspace-invitations", () => ({
  createWorkspaceInvitation: jest.fn(),
  ensureWorkspaceInvitationIndexes: jest.fn(),
}));

jest.mock("@/lib/observability-metrics", () => ({
  recordWorkspaceActionMetric: jest.fn(),
}));

const mockedGetDb = getDb as jest.MockedFunction<typeof getDb>;
const mockedFindUserById = findUserById as jest.MockedFunction<typeof findUserById>;
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
const mockedCreateWorkspaceInvitation =
  createWorkspaceInvitation as jest.MockedFunction<typeof createWorkspaceInvitation>;
const mockedEnsureWorkspaceInvitationIndexes =
  ensureWorkspaceInvitationIndexes as jest.MockedFunction<
    typeof ensureWorkspaceInvitationIndexes
  >;

describe("POST /api/workspaces/[workspaceId]/members/invite", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetDb.mockResolvedValue({} as any);
    mockedGetSessionUserId.mockResolvedValue("user-1");
    mockedEnsureWorkspaceBootstrapForUser.mockResolvedValue(null as never);
    mockedEnsureWorkspaceInvitationIndexes.mockResolvedValue(undefined as never);
    mockedAssertWorkspaceAccess.mockResolvedValue({
      workspace: { _id: "workspace-1", name: "Main Workspace" },
      membership: { _id: "membership-1", role: "admin", status: "active" },
    } as any);
    mockedFindUserById.mockResolvedValue({
      _id: { toString: () => "user-1" },
      email: "admin@example.com",
    } as any);
    mockedCreateWorkspaceInvitation.mockResolvedValue({
      _id: "invite-token",
      workspaceId: "workspace-1",
      workspaceName: "Main Workspace",
      role: "admin",
      inviterEmail: "admin@example.com",
      invitedEmail: "member@example.com",
      status: "pending",
      createdAt: new Date("2026-02-18T00:00:00.000Z"),
      expiresAt: new Date("2026-02-25T00:00:00.000Z"),
    } as any);
  });

  it("returns unauthorized when not authenticated", async () => {
    mockedGetSessionUserId.mockResolvedValue(null);
    const response = await POST(
      new Request("http://localhost/api/workspaces/workspace-1/members/invite", {
        method: "POST",
        body: JSON.stringify({ invitedEmail: "member@example.com" }),
      }),
      { params: { workspaceId: "workspace-1" } }
    );
    expect(response.status).toBe(401);
  });

  it("creates an invitation for a workspace member", async () => {
    const response = await POST(
      new Request("http://localhost/api/workspaces/workspace-1/members/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invitedEmail: "member@example.com",
          role: "admin",
          expiresInDays: 5,
        }),
      }),
      { params: { workspaceId: "workspace-1" } }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      invitation: {
        token: "invite-token",
        workspaceId: "workspace-1",
        role: "admin",
        invitationUrl: "http://localhost/invite/invite-token",
      },
    });

    expect(mockedCreateWorkspaceInvitation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        workspaceId: "workspace-1",
        workspaceName: "Main Workspace",
        role: "admin",
        invitedEmail: "member@example.com",
      })
    );
  });
});
