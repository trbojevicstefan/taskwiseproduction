import { GET, PATCH } from "@/app/api/users/me/route";
import { getServerSession } from "next-auth";
import { findUserById, updateUserById } from "@/lib/db/users";
import { getDb } from "@/lib/db";
import {
  assertWorkspaceAccess,
  ensureWorkspaceBootstrapForUser,
} from "@/lib/workspace-context";
import {
  listActiveWorkspaceMembershipsForWorkspace,
  listWorkspaceMembershipsForUser,
} from "@/lib/workspace-memberships";
import {
  findPreferredFathomConnectionForWorkspace,
  listFathomConnectionsForWorkspace,
} from "@/lib/fathom-connections";
import {
  findWorkspaceById,
  listWorkspacesByIds,
  updateWorkspaceById,
} from "@/lib/workspaces";

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
  assertWorkspaceAccess: jest.fn(),
}));

jest.mock("@/lib/workspace-memberships", () => ({
  listWorkspaceMembershipsForUser: jest.fn(),
  listActiveWorkspaceMembershipsForWorkspace: jest.fn(),
}));

jest.mock("@/lib/workspaces", () => ({
  listWorkspacesByIds: jest.fn(),
  findWorkspaceById: jest.fn(),
  updateWorkspaceById: jest.fn(),
}));

jest.mock("@/lib/fathom-connections", () => ({
  listFathomConnectionsForWorkspace: jest.fn(),
  findPreferredFathomConnectionForWorkspace: jest.fn(),
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
const mockedUpdateWorkspaceById = updateWorkspaceById as jest.MockedFunction<
  typeof updateWorkspaceById
>;
const mockedAssertWorkspaceAccess = assertWorkspaceAccess as jest.MockedFunction<
  typeof assertWorkspaceAccess
>;
const mockedListFathomConnectionsForWorkspace =
  listFathomConnectionsForWorkspace as jest.MockedFunction<
    typeof listFathomConnectionsForWorkspace
  >;
const mockedFindPreferredFathomConnectionForWorkspace =
  findPreferredFathomConnectionForWorkspace as jest.MockedFunction<
    typeof findPreferredFathomConnectionForWorkspace
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
    mockedListFathomConnectionsForWorkspace.mockResolvedValue([] as any);
    mockedFindPreferredFathomConnectionForWorkspace.mockResolvedValue(null);
  });

  it("hydrates activeWorkspaceId for legacy users and returns membership summary", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({
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
    expect(payload).not.toHaveProperty("fathomWebhookToken");
    expect(payload).not.toHaveProperty("fathomConnected");
    expect(payload).not.toHaveProperty("fathomUserId");
    expect(mockedUpdateUserById).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({
        workspace: { id: "workspace-1", name: "Main Workspace" },
        activeWorkspaceId: "workspace-1",
      })
    );
  });
});

describe("PATCH /api/users/me workspace.settings.slackReminders persistence", () => {
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
    mockedAssertWorkspaceAccess.mockResolvedValue({
      workspace: { _id: "workspace-1", name: "Main Workspace", settings: null },
      membership: { role: "owner" },
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
      activeWorkspaceId: "workspace-1",
      firefliesWebhookToken: null,
    } as any);
    mockedUpdateUserById.mockResolvedValue(undefined as never);
    mockedUpdateWorkspaceById.mockResolvedValue(undefined as never);
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
    mockedListFathomConnectionsForWorkspace.mockResolvedValue([] as any);
    mockedFindPreferredFathomConnectionForWorkspace.mockResolvedValue(null);
  });

  const buildPatchRequest = (body: Record<string, unknown>) =>
    new Request("http://localhost/api/users/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  it("merges a partial slackReminders patch over resolved defaults and persists it", async () => {
    const response = await PATCH(
      buildPatchRequest({
        workspace: {
          id: "workspace-1",
          name: "Main Workspace",
          settings: {
            slackReminders: {
              enabled: true,
              remindDaysBefore: [1, 3],
              deliver: "channel",
              defaultChannelId: "C123",
            },
          },
        },
      })
    );

    expect(response.status).toBe(200);
    expect(mockedUpdateWorkspaceById).toHaveBeenCalledTimes(1);
    const [, workspaceId, updatePayload] =
      mockedUpdateWorkspaceById.mock.calls[0] as any[];
    expect(workspaceId).toBe("workspace-1");
    // Patch merged over the full resolved defaults (same pattern as taskCleanup).
    expect(updatePayload.settings.slackReminders).toEqual({
      enabled: true,
      remindDaysBefore: [1, 3],
      remindOnDue: true,
      remindOverdue: true,
      maxRemindersPerTask: 3,
      deliver: "channel",
      defaultChannelId: "C123",
      quietHoursStart: 22,
      quietHoursEnd: 7,
      digest: "off",
    });
  });

  it("leaves stored slackReminders untouched when the patch omits them", async () => {
    mockedFindWorkspaceById.mockResolvedValue({
      _id: "workspace-1",
      name: "Main Workspace",
      settings: {
        slackReminders: { enabled: true, deliver: "channel" },
      },
    } as any);

    const response = await PATCH(
      buildPatchRequest({
        workspace: { id: "workspace-1", name: "Renamed Workspace" },
      })
    );

    expect(response.status).toBe(200);
    const [, , updatePayload] = mockedUpdateWorkspaceById.mock.calls[0] as any[];
    expect(updatePayload.settings.slackReminders).toEqual({
      enabled: true,
      deliver: "channel",
    });
  });

  it("rejects invalid slackReminders values via the zod schema", async () => {
    const response = await PATCH(
      buildPatchRequest({
        workspace: {
          id: "workspace-1",
          name: "Main Workspace",
          settings: {
            slackReminders: { remindDaysBefore: [0] },
          },
        },
      })
    );

    expect(response.status).toBe(400);
    expect(mockedUpdateWorkspaceById).not.toHaveBeenCalled();
  });
});
