import { assertWorkspaceAccess } from "@/lib/workspace-authz";
import { findActiveWorkspaceMembership } from "@/lib/workspace-memberships";
import { hasWorkspaceRoleAtLeast } from "@/lib/workspace-roles";
import { findWorkspaceById } from "@/lib/workspaces";

jest.mock("@/lib/workspace-memberships", () => ({
  findActiveWorkspaceMembership: jest.fn(),
}));

jest.mock("@/lib/workspaces", () => ({
  findWorkspaceById: jest.fn(),
}));

const mockedFindActiveWorkspaceMembership =
  findActiveWorkspaceMembership as jest.MockedFunction<
    typeof findActiveWorkspaceMembership
  >;
const mockedFindWorkspaceById = findWorkspaceById as jest.MockedFunction<
  typeof findWorkspaceById
>;

describe("workspace role precedence", () => {
  it("respects owner > admin > member precedence", () => {
    expect(hasWorkspaceRoleAtLeast("owner", "admin")).toBe(true);
    expect(hasWorkspaceRoleAtLeast("owner", "member")).toBe(true);
    expect(hasWorkspaceRoleAtLeast("admin", "member")).toBe(true);
    expect(hasWorkspaceRoleAtLeast("admin", "owner")).toBe(false);
    expect(hasWorkspaceRoleAtLeast("member", "admin")).toBe(false);
  });
});

describe("assertWorkspaceAccess", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedFindActiveWorkspaceMembership.mockResolvedValue({
      _id: "membership-1",
      workspaceId: "workspace-1",
      userId: "user-1",
      role: "admin",
      status: "active",
      joinedAt: new Date("2026-02-18T00:00:00.000Z"),
      createdAt: new Date("2026-02-18T00:00:00.000Z"),
      updatedAt: new Date("2026-02-18T00:00:00.000Z"),
      invitedByUserId: null,
    } as any);
    mockedFindWorkspaceById.mockResolvedValue({
      _id: "workspace-1",
      name: "Workspace One",
      slug: null,
      createdByUserId: "user-1",
      createdAt: new Date("2026-02-18T00:00:00.000Z"),
      updatedAt: new Date("2026-02-18T00:00:00.000Z"),
      status: "active",
      settings: null,
    } as any);
  });

  it("returns workspace context when membership is active and role is sufficient", async () => {
    const result = await assertWorkspaceAccess({} as any, "user-1", "workspace-1", "member");

    expect(result.workspace._id).toBe("workspace-1");
    expect(result.membership.userId).toBe("user-1");
    expect(mockedFindActiveWorkspaceMembership).toHaveBeenCalledWith(
      expect.anything(),
      "workspace-1",
      "user-1"
    );
  });

  it("throws forbidden when active membership is missing", async () => {
    mockedFindActiveWorkspaceMembership.mockResolvedValue(null);

    await expect(
      assertWorkspaceAccess({} as any, "user-1", "workspace-1", "member")
    ).rejects.toMatchObject({
      status: 403,
      code: "workspace_forbidden",
    });
  });

  it("throws forbidden when membership role is insufficient", async () => {
    mockedFindActiveWorkspaceMembership.mockResolvedValue({
      _id: "membership-1",
      workspaceId: "workspace-1",
      userId: "user-1",
      role: "member",
      status: "active",
      joinedAt: new Date("2026-02-18T00:00:00.000Z"),
      createdAt: new Date("2026-02-18T00:00:00.000Z"),
      updatedAt: new Date("2026-02-18T00:00:00.000Z"),
      invitedByUserId: null,
    } as any);

    await expect(
      assertWorkspaceAccess({} as any, "user-1", "workspace-1", "admin")
    ).rejects.toMatchObject({
      status: 403,
      code: "workspace_forbidden",
    });
  });

  it("throws not found when workspace does not exist", async () => {
    mockedFindWorkspaceById.mockResolvedValue(null);

    await expect(
      assertWorkspaceAccess({} as any, "user-1", "workspace-1", "member")
    ).rejects.toMatchObject({
      status: 404,
      code: "workspace_not_found",
    });
  });

  it("throws not found when workspace is deleted", async () => {
    mockedFindWorkspaceById.mockResolvedValue({
      _id: "workspace-1",
      name: "Workspace One",
      slug: null,
      createdByUserId: "user-1",
      createdAt: new Date("2026-02-18T00:00:00.000Z"),
      updatedAt: new Date("2026-02-18T00:00:00.000Z"),
      status: "deleted",
      settings: null,
    } as any);

    await expect(
      assertWorkspaceAccess({} as any, "user-1", "workspace-1", "member")
    ).rejects.toMatchObject({
      status: 404,
      code: "workspace_not_found",
    });
  });
});
