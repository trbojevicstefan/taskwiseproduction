import { GET } from "@/app/api/workspaces/current/route";
import { getSessionUserId } from "@/lib/server-auth";
import { getDb } from "@/lib/db";
import {
  ensureWorkspaceBootstrapForUser,
  getActiveWorkspaceForUser,
  getActiveWorkspaceIdForUser,
} from "@/lib/workspace-context";
import { findActiveWorkspaceMembership } from "@/lib/workspace-memberships";

jest.mock("@/lib/server-auth", () => ({
  getSessionUserId: jest.fn(),
}));

jest.mock("@/lib/db", () => ({
  getDb: jest.fn(),
}));

jest.mock("@/lib/workspace-context", () => ({
  ensureWorkspaceBootstrapForUser: jest.fn(),
  getActiveWorkspaceForUser: jest.fn(),
  getActiveWorkspaceIdForUser: jest.fn(),
}));

jest.mock("@/lib/workspace-memberships", () => ({
  findActiveWorkspaceMembership: jest.fn(),
}));

const mockedGetSessionUserId = getSessionUserId as jest.MockedFunction<
  typeof getSessionUserId
>;
const mockedGetDb = getDb as jest.MockedFunction<typeof getDb>;
const mockedEnsureWorkspaceBootstrapForUser =
  ensureWorkspaceBootstrapForUser as jest.MockedFunction<
    typeof ensureWorkspaceBootstrapForUser
  >;
const mockedGetActiveWorkspaceForUser =
  getActiveWorkspaceForUser as jest.MockedFunction<typeof getActiveWorkspaceForUser>;
const mockedGetActiveWorkspaceIdForUser =
  getActiveWorkspaceIdForUser as jest.MockedFunction<
    typeof getActiveWorkspaceIdForUser
  >;
const mockedFindActiveWorkspaceMembership =
  findActiveWorkspaceMembership as jest.MockedFunction<
    typeof findActiveWorkspaceMembership
  >;

describe("GET /api/workspaces/current", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetSessionUserId.mockResolvedValue("user-1");
    mockedGetDb.mockResolvedValue({} as any);
    mockedEnsureWorkspaceBootstrapForUser.mockResolvedValue(null as any);
    mockedGetActiveWorkspaceIdForUser.mockResolvedValue("workspace-1");
    mockedGetActiveWorkspaceForUser.mockResolvedValue({
      id: "workspace-1",
      name: "Main Workspace",
    });
    mockedFindActiveWorkspaceMembership.mockResolvedValue({
      _id: "membership-1",
      workspaceId: "workspace-1",
      userId: "user-1",
      role: "owner",
      status: "active",
    } as any);
  });

  it("returns current workspace context", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      activeWorkspaceId: "workspace-1",
      workspace: {
        id: "workspace-1",
        name: "Main Workspace",
      },
      membership: {
        role: "owner",
        status: "active",
      },
    });
  });
});
