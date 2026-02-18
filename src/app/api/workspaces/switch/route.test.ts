import { POST } from "@/app/api/workspaces/switch/route";
import { getSessionUserId } from "@/lib/server-auth";
import { getDb } from "@/lib/db";
import {
  ensureWorkspaceBootstrapForUser,
  setActiveWorkspaceForUser,
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
  setActiveWorkspaceForUser: jest.fn(),
}));

jest.mock("@/lib/workspace-memberships", () => ({
  findActiveWorkspaceMembership: jest.fn(),
}));

jest.mock("@/lib/observability-metrics", () => ({
  recordWorkspaceActionMetric: jest.fn(),
}));

const mockedGetSessionUserId = getSessionUserId as jest.MockedFunction<
  typeof getSessionUserId
>;
const mockedGetDb = getDb as jest.MockedFunction<typeof getDb>;
const mockedEnsureWorkspaceBootstrapForUser =
  ensureWorkspaceBootstrapForUser as jest.MockedFunction<
    typeof ensureWorkspaceBootstrapForUser
  >;
const mockedSetActiveWorkspaceForUser =
  setActiveWorkspaceForUser as jest.MockedFunction<typeof setActiveWorkspaceForUser>;
const mockedFindActiveWorkspaceMembership =
  findActiveWorkspaceMembership as jest.MockedFunction<
    typeof findActiveWorkspaceMembership
  >;

describe("POST /api/workspaces/switch", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetSessionUserId.mockResolvedValue("user-1");
    mockedGetDb.mockResolvedValue({} as any);
    mockedEnsureWorkspaceBootstrapForUser.mockResolvedValue(null as any);
    mockedSetActiveWorkspaceForUser.mockResolvedValue({
      id: "workspace-2",
      name: "Client Workspace",
    });
    mockedFindActiveWorkspaceMembership.mockResolvedValue({
      _id: "membership-2",
      role: "member",
      status: "active",
    } as any);
  });

  it("switches active workspace", async () => {
    const response = await POST(
      new Request("http://localhost/api/workspaces/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: "workspace-2" }),
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      activeWorkspaceId: "workspace-2",
      workspace: {
        id: "workspace-2",
        name: "Client Workspace",
      },
      membership: {
        role: "member",
        status: "active",
      },
    });
  });
});
