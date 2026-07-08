import { POST } from "@/app/api/calendar/meetings/link/route";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import {
  assertWorkspaceAccess,
  ensureWorkspaceBootstrapForUser,
} from "@/lib/workspace-context";

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

jest.mock("@/lib/observability-metrics", () => ({
  recordRouteMetric: jest.fn(),
}));

const mockedGetDb = getDb as jest.MockedFunction<typeof getDb>;
const mockedGetSessionUserId = getSessionUserId as jest.MockedFunction<
  typeof getSessionUserId
>;
const mockedAssertWorkspaceAccess =
  assertWorkspaceAccess as jest.MockedFunction<typeof assertWorkspaceAccess>;
const mockedEnsureWorkspaceBootstrapForUser =
  ensureWorkspaceBootstrapForUser as jest.MockedFunction<
    typeof ensureWorkspaceBootstrapForUser
  >;

const buildDb = (meeting: any) => {
  const findOne = jest.fn().mockResolvedValue(meeting);
  const updateOne = jest.fn().mockResolvedValue({ matchedCount: 1 });
  const db = {
    collection: jest.fn((name: string) => {
      if (name === "meetings") return { findOne, updateOne };
      throw new Error(`Unexpected collection in test: ${name}`);
    }),
  } as any;
  return { db, findOne, updateOne };
};

const requestWith = (body: unknown) =>
  new Request("http://localhost/api/calendar/meetings/link", {
    method: "POST",
    body: JSON.stringify(body),
  });

describe("POST /api/calendar/meetings/link", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetSessionUserId.mockResolvedValue("user-1");
    mockedEnsureWorkspaceBootstrapForUser.mockResolvedValue(null as any);
    mockedAssertWorkspaceAccess.mockResolvedValue({} as any);
  });

  it("returns 401 when there is no session user", async () => {
    mockedGetSessionUserId.mockResolvedValue(null as any);

    const response = await POST(
      requestWith({ meetingId: "m-1", externalEventId: "gcal-1" })
    );

    expect(response.status).toBe(401);
    expect(mockedGetDb).not.toHaveBeenCalled();
  });

  it.each([
    ["missing meetingId", { externalEventId: "gcal-1" }],
    ["missing externalEventId", { meetingId: "m-1" }],
    ["blank externalEventId", { meetingId: "m-1", externalEventId: "  " }],
    [
      "oversized externalEventId",
      { meetingId: "m-1", externalEventId: "x".repeat(257) },
    ],
  ])("returns 400 invalid_payload for %s", async (_label, body) => {
    const { db, updateOne } = buildDb(null);
    mockedGetDb.mockResolvedValue(db);

    const response = await POST(requestWith(body));

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.errorCode).toBe("invalid_payload");
    expect(updateOne).not.toHaveBeenCalled();
  });

  it("returns 404 for missing or hidden meetings", async () => {
    const { db } = buildDb(null);
    mockedGetDb.mockResolvedValue(db);
    const missing = await POST(
      requestWith({ meetingId: "m-x", externalEventId: "gcal-1" })
    );
    expect(missing.status).toBe(404);

    const hidden = buildDb({ _id: "m-1", isHidden: true, workspaceId: "w-1" });
    mockedGetDb.mockResolvedValue(hidden.db);
    const hiddenResponse = await POST(
      requestWith({ meetingId: "m-1", externalEventId: "gcal-1" })
    );
    expect(hiddenResponse.status).toBe(404);
    expect(hidden.updateOne).not.toHaveBeenCalled();
  });

  it("returns 404 when workspace access is denied", async () => {
    const { db, updateOne } = buildDb({
      _id: "m-1",
      workspaceId: "workspace-1",
    });
    mockedGetDb.mockResolvedValue(db);
    mockedAssertWorkspaceAccess.mockRejectedValue(new Error("denied"));

    const response = await POST(
      requestWith({ meetingId: "m-1", externalEventId: "gcal-1" })
    );

    expect(response.status).toBe(404);
    expect(updateOne).not.toHaveBeenCalled();
  });

  it("returns 404 for a legacy meeting owned by another user", async () => {
    const { db, updateOne } = buildDb({ _id: "m-1", userId: "someone-else" });
    mockedGetDb.mockResolvedValue(db);

    const response = await POST(
      requestWith({ meetingId: "m-1", externalEventId: "gcal-1" })
    );

    expect(response.status).toBe(404);
    expect(updateOne).not.toHaveBeenCalled();
  });

  it("stores the external event id on an accessible workspace meeting", async () => {
    const { db, updateOne } = buildDb({
      _id: "m-1",
      workspaceId: "workspace-1",
      userId: "user-1",
    });
    mockedGetDb.mockResolvedValue(db);

    const response = await POST(
      requestWith({ meetingId: "m-1", externalEventId: " gcal-9 " })
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({
      ok: true,
      meetingId: "m-1",
      externalEventId: "gcal-9",
    });
    expect(mockedAssertWorkspaceAccess).toHaveBeenCalledWith(
      db,
      "user-1",
      "workspace-1",
      "member"
    );
    expect(updateOne).toHaveBeenCalledWith(
      { _id: "m-1" },
      { $set: { calendarEventId: "gcal-9" } }
    );
  });
});
