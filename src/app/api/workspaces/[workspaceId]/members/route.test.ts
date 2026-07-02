import { GET } from "@/app/api/workspaces/[workspaceId]/members/route";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import {
  assertWorkspaceAccess,
  ensureWorkspaceBootstrapForUser,
} from "@/lib/workspace-context";
import {
  countActiveWorkspaceOwners,
  listWorkspaceMembershipsForWorkspace,
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
}));

jest.mock("@/lib/workspace-memberships", () => ({
  countActiveWorkspaceOwners: jest.fn(),
  listWorkspaceMembershipsForWorkspace: jest.fn(),
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
const mockedCountActiveWorkspaceOwners =
  countActiveWorkspaceOwners as jest.MockedFunction<typeof countActiveWorkspaceOwners>;
const mockedListWorkspaceMembershipsForWorkspace =
  listWorkspaceMembershipsForWorkspace as jest.MockedFunction<
    typeof listWorkspaceMembershipsForWorkspace
  >;

describe("GET /api/workspaces/[workspaceId]/members", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetSessionUserId.mockResolvedValue("user-1");
    mockedEnsureWorkspaceBootstrapForUser.mockResolvedValue(null as never);
    mockedAssertWorkspaceAccess.mockResolvedValue({
      workspace: { _id: "workspace-1", name: "Main Workspace" },
      membership: { _id: "membership-1", role: "owner", status: "active" },
    } as any);
    mockedCountActiveWorkspaceOwners.mockResolvedValue(1);
    mockedListWorkspaceMembershipsForWorkspace.mockResolvedValue([
      {
        _id: "membership-1",
        workspaceId: "workspace-1",
        userId: "user-1",
        role: "owner",
        status: "active",
        joinedAt: new Date("2026-02-18T10:00:00.000Z"),
        updatedAt: new Date("2026-02-18T10:00:00.000Z"),
      },
      {
        _id: "membership-2",
        workspaceId: "workspace-1",
        userId: "user-2",
        role: "member",
        status: "active",
        joinedAt: new Date("2026-02-18T11:00:00.000Z"),
        updatedAt: new Date("2026-02-18T11:00:00.000Z"),
      },
    ] as any);

    mockedGetDb.mockResolvedValue({
      collection: jest.fn().mockReturnValue({
        find: jest.fn().mockReturnValue({
          toArray: jest.fn().mockResolvedValue([
            {
              _id: { toString: () => "user-1" },
              id: "user-1",
              name: "Owner",
              email: "owner@example.com",
              avatarUrl: null,
            },
            {
              _id: { toString: () => "user-2" },
              id: "user-2",
              name: "Member",
              email: "member@example.com",
              avatarUrl: null,
            },
          ]),
        }),
      }),
    } as any);
  });

  it("returns unauthorized when session is missing", async () => {
    mockedGetSessionUserId.mockResolvedValue(null);
    const response = await GET(new Request("http://localhost/api/workspaces/workspace-1/members"), {
      params: { workspaceId: "workspace-1" },
    });
    expect(response.status).toBe(401);
  });

  it("returns serialized members and permissions", async () => {
    const response = await GET(new Request("http://localhost/api/workspaces/workspace-1/members"), {
      params: { workspaceId: "workspace-1" },
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({
      ok: true,
      workspace: { id: "workspace-1", name: "Main Workspace" },
      permissions: {
        canInvite: true,
        canReadMembers: true,
        canUpdateMembers: true,
        canRemoveMembers: true,
      },
      members: [
        expect.objectContaining({
          membershipId: "membership-1",
          role: "owner",
          isCurrentUser: true,
          isLastOwner: true,
        }),
        expect.objectContaining({
          membershipId: "membership-2",
          role: "member",
          isCurrentUser: false,
          canEditRole: true,
          canRemove: true,
        }),
      ],
    });
  });
});
