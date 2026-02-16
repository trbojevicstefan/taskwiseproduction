import { requireOperationalRouteAccess } from "@/lib/operational-route-guard";
import { getSessionUserId } from "@/lib/server-auth";

jest.mock("@/lib/server-auth", () => ({
  getSessionUserId: jest.fn(),
}));

const mockedGetSessionUserId = getSessionUserId as jest.MockedFunction<
  typeof getSessionUserId
>;

const ORIGINAL_ENV = process.env;

const expectErrorResponse = async (
  result: Awaited<ReturnType<typeof requireOperationalRouteAccess>>,
  status: number,
  error: string
) => {
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error("Expected access check to fail.");
  }
  expect(result.response.status).toBe(status);
  await expect(result.response.json()).resolves.toMatchObject({ error });
};

describe("requireOperationalRouteAccess", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.ENABLE_OPERATIONAL_ROUTES;
    delete process.env.OPERATIONAL_ROUTE_ALLOWED_USER_IDS;
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it("returns 404 when operational routes are disabled", async () => {
    process.env.ENABLE_OPERATIONAL_ROUTES = "0";
    mockedGetSessionUserId.mockResolvedValue("user-1");

    const result = await requireOperationalRouteAccess();

    await expectErrorResponse(result, 404, "Not found");
  });

  it("returns 401 when enabled but no authenticated user is present", async () => {
    process.env.ENABLE_OPERATIONAL_ROUTES = "1";
    mockedGetSessionUserId.mockResolvedValue(null);

    const result = await requireOperationalRouteAccess();

    await expectErrorResponse(result, 401, "Unauthorized");
  });

  it("returns 403 when allowlist is configured and user is not included", async () => {
    process.env.ENABLE_OPERATIONAL_ROUTES = "1";
    process.env.OPERATIONAL_ROUTE_ALLOWED_USER_IDS = "allowed-1,allowed-2";
    mockedGetSessionUserId.mockResolvedValue("blocked-user");

    const result = await requireOperationalRouteAccess();

    await expectErrorResponse(result, 403, "Forbidden");
  });

  it("grants access when enabled and user is allowlisted", async () => {
    process.env.ENABLE_OPERATIONAL_ROUTES = "1";
    process.env.OPERATIONAL_ROUTE_ALLOWED_USER_IDS = "allowed-1,allowed-2";
    mockedGetSessionUserId.mockResolvedValue("allowed-2");

    const result = await requireOperationalRouteAccess();

    expect(result).toEqual({ ok: true, userId: "allowed-2" });
  });
});
