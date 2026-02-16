import { POST } from "@/app/api/workspace-invitations/[token]/accept/route";
import { getSessionUserId } from "@/lib/server-auth";
import { findUserById, updateUserById } from "@/lib/db/users";
import { getDb } from "@/lib/db";
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
  updateUserById: jest.fn(),
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

const mockedGetSessionUserId = getSessionUserId as jest.MockedFunction<
  typeof getSessionUserId
>;
const mockedFindUserById = findUserById as jest.MockedFunction<typeof findUserById>;
const mockedUpdateUserById = updateUserById as jest.MockedFunction<
  typeof updateUserById
>;
const mockedGetDb = getDb as jest.MockedFunction<typeof getDb>;
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
    } as any);
    mockedUpdateUserById.mockResolvedValue(undefined as never);
    mockedMarkWorkspaceInvitationAccepted.mockResolvedValue(undefined as never);
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
    });
    expect(mockedUpdateUserById).toHaveBeenCalledWith(
      "user-2",
      expect.objectContaining({
        workspace: {
          id: "workspace-1",
          name: "Main Workspace",
        },
      })
    );
    expect(mockedMarkWorkspaceInvitationAccepted).toHaveBeenCalledWith(
      expect.anything(),
      "invite-token",
      "user-2"
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
    expect(mockedUpdateUserById).not.toHaveBeenCalled();
  });
});

