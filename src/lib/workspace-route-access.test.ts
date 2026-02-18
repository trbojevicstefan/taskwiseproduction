import { ApiRouteError } from "@/lib/api-route";
import { requireWorkspaceRouteAccess } from "@/lib/workspace-route-access";
import { getSessionUserId } from "@/lib/server-auth";
import { getDb } from "@/lib/db";
import {
  assertWorkspaceAccess,
  ensureWorkspaceBootstrapForUser,
} from "@/lib/workspace-context";

jest.mock("@/lib/server-auth", () => ({
  getSessionUserId: jest.fn(),
}));

jest.mock("@/lib/db", () => ({
  getDb: jest.fn(),
}));

jest.mock("@/lib/workspace-context", () => ({
  assertWorkspaceAccess: jest.fn(),
  ensureWorkspaceBootstrapForUser: jest.fn(),
}));

const mockedGetSessionUserId = getSessionUserId as jest.MockedFunction<
  typeof getSessionUserId
>;
const mockedGetDb = getDb as jest.MockedFunction<typeof getDb>;
const mockedAssertWorkspaceAccess = assertWorkspaceAccess as jest.MockedFunction<
  typeof assertWorkspaceAccess
>;
const mockedEnsureWorkspaceBootstrapForUser =
  ensureWorkspaceBootstrapForUser as jest.MockedFunction<
    typeof ensureWorkspaceBootstrapForUser
  >;

const ORIGINAL_ENV = process.env;

describe("requireWorkspaceRouteAccess", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.WORKSPACE_MEMBERSHIP_GUARD_ENABLED;
    mockedGetSessionUserId.mockResolvedValue("user-1");
    mockedGetDb.mockResolvedValue({} as any);
    mockedEnsureWorkspaceBootstrapForUser.mockResolvedValue(null as any);
    mockedAssertWorkspaceAccess.mockResolvedValue({
      workspace: { _id: "workspace-1" },
      membership: { role: "member" },
    } as any);
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it("returns unauthorized when no session user exists", async () => {
    mockedGetSessionUserId.mockResolvedValue(null);
    const result = await requireWorkspaceRouteAccess("workspace-1");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
    }
  });

  it("skips membership assertion when guard flag is disabled", async () => {
    const result = await requireWorkspaceRouteAccess("workspace-1");
    expect(result.ok).toBe(true);
    expect(mockedAssertWorkspaceAccess).not.toHaveBeenCalled();
  });

  it("returns forbidden response when assertion fails and guard is enabled", async () => {
    process.env.WORKSPACE_MEMBERSHIP_GUARD_ENABLED = "1";
    mockedAssertWorkspaceAccess.mockRejectedValue(
      new ApiRouteError(403, "workspace_forbidden", "Forbidden")
    );

    const result = await requireWorkspaceRouteAccess("workspace-1");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(403);
    }
  });
});
