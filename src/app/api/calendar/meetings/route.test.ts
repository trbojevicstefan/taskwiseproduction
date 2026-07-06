import { POST } from "@/app/api/calendar/meetings/route";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { runMeetingIngestionCommand } from "@/lib/services/meeting-ingestion-command";
import { getWorkspaceIdForUser } from "@/lib/workspace";
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

jest.mock("@/lib/services/meeting-ingestion-command", () => ({
  runMeetingIngestionCommand: jest.fn(),
}));

jest.mock("@/lib/workspace", () => ({
  getWorkspaceIdForUser: jest.fn(),
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
const mockedRunMeetingIngestionCommand =
  runMeetingIngestionCommand as jest.MockedFunction<
    typeof runMeetingIngestionCommand
  >;
const mockedGetWorkspaceIdForUser =
  getWorkspaceIdForUser as jest.MockedFunction<typeof getWorkspaceIdForUser>;
const mockedAssertWorkspaceAccess =
  assertWorkspaceAccess as jest.MockedFunction<typeof assertWorkspaceAccess>;
const mockedEnsureWorkspaceBootstrapForUser =
  ensureWorkspaceBootstrapForUser as jest.MockedFunction<
    typeof ensureWorkspaceBootstrapForUser
  >;

const buildDb = ({ existingMeeting = null }: { existingMeeting?: any } = {}) => {
  const findOne = jest.fn().mockResolvedValue(existingMeeting);
  const insertOne = jest.fn().mockResolvedValue({ acknowledged: true });
  const db = {
    collection: jest.fn((name: string) => {
      if (name === "meetings") return { findOne, insertOne };
      throw new Error(`Unexpected collection in test: ${name}`);
    }),
  } as any;
  return { db, findOne, insertOne };
};

const requestWith = (body: unknown) =>
  new Request("http://localhost/api/calendar/meetings", {
    method: "POST",
    body: JSON.stringify(body),
  });

const validBody = {
  title: "External planning call",
  startTime: "2026-07-06T15:00:00.000Z",
  endTime: "2026-07-06T16:00:00.000Z",
  attendees: [
    { name: "Ana", email: "ana@acme.com" },
    { name: null, email: "bo@acme.com" },
    { name: "", email: "" },
  ],
  description: "Quarterly planning",
  externalEventId: "gcal-77",
};

describe("POST /api/calendar/meetings", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetSessionUserId.mockResolvedValue("user-1");
    mockedGetWorkspaceIdForUser.mockResolvedValue("workspace-1");
    mockedEnsureWorkspaceBootstrapForUser.mockResolvedValue(null as any);
    mockedAssertWorkspaceAccess.mockResolvedValue({} as any);
    mockedRunMeetingIngestionCommand.mockResolvedValue({
      people: { created: 0, updated: 0 },
      tasks: { upserted: 0, deleted: 0 },
      boardItemsCreated: 0,
    });
  });

  it("returns 401 when there is no session user", async () => {
    mockedGetSessionUserId.mockResolvedValue(null as any);

    const response = await POST(requestWith(validBody));

    expect(response.status).toBe(401);
    expect(mockedGetDb).not.toHaveBeenCalled();
  });

  it.each([
    ["missing title", { ...validBody, title: undefined }],
    ["empty title", { ...validBody, title: "  " }],
    ["missing startTime", { ...validBody, startTime: undefined }],
    ["invalid startTime", { ...validBody, startTime: "not-a-date" }],
    [
      "too many attendees",
      {
        ...validBody,
        attendees: Array.from({ length: 51 }, (_, i) => ({
          email: `p${i}@x.com`,
        })),
      },
    ],
    ["oversized description", { ...validBody, description: "x".repeat(5001) }],
  ])("returns 400 invalid_payload for %s", async (_label, body) => {
    const { db, insertOne } = buildDb();
    mockedGetDb.mockResolvedValue(db);

    const response = await POST(requestWith(body));

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.ok).toBe(false);
    expect(payload.errorCode).toBe("invalid_payload");
    expect(insertOne).not.toHaveBeenCalled();
  });

  it("creates a workspace-scoped manual meeting and publishes ingestion events", async () => {
    const { db, findOne, insertOne } = buildDb();
    mockedGetDb.mockResolvedValue(db);

    const response = await POST(requestWith(validBody));

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.ok).toBe(true);
    expect(payload.created).toBe(true);
    expect(payload.meeting).toMatchObject({
      title: "External planning call",
      startTime: "2026-07-06T15:00:00.000Z",
      calendarEventId: "gcal-77",
    });
    expect(typeof payload.meeting.id).toBe("string");

    // Idempotency lookup is scoped to the workspace and ignores hidden docs.
    expect(findOne).toHaveBeenCalledWith(
      {
        workspaceId: "workspace-1",
        calendarEventId: "gcal-77",
        isHidden: { $ne: true },
      },
      expect.anything()
    );

    expect(mockedAssertWorkspaceAccess).toHaveBeenCalledWith(
      db,
      "user-1",
      "workspace-1",
      "member"
    );

    expect(insertOne).toHaveBeenCalledTimes(1);
    const inserted = insertOne.mock.calls[0][0];
    expect(inserted).toMatchObject({
      userId: "user-1",
      workspaceId: "workspace-1",
      title: "External planning call",
      summary: "Quarterly planning",
      originalTranscript: "",
      extractedTasks: [],
      calendarEventId: "gcal-77",
      ingestSource: "manual",
    });
    expect(inserted.startTime).toEqual(new Date("2026-07-06T15:00:00.000Z"));
    expect(inserted.endTime).toEqual(new Date("2026-07-06T16:00:00.000Z"));
    // Blank attendee rows are dropped; email-only rows get the email as name.
    expect(inserted.attendees).toEqual([
      { name: "Ana", email: "ana@acme.com", role: "attendee" },
      { name: "bo@acme.com", email: "bo@acme.com", role: "attendee" },
    ]);

    expect(mockedRunMeetingIngestionCommand).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        mode: "always-event",
        userId: "user-1",
        payload: expect.objectContaining({
          meetingId: inserted._id,
          workspaceId: "workspace-1",
          title: "External planning call",
          extractedTasks: [],
        }),
      })
    );
  });

  it("returns the existing meeting instead of duplicating a linked event", async () => {
    const { db, insertOne } = buildDb({
      existingMeeting: {
        _id: "m-existing",
        title: "Already imported",
        startTime: new Date("2026-07-06T15:00:00.000Z"),
        calendarEventId: "gcal-77",
      },
    });
    mockedGetDb.mockResolvedValue(db);

    const response = await POST(requestWith(validBody));

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.created).toBe(false);
    expect(payload.meeting).toMatchObject({
      id: "m-existing",
      title: "Already imported",
      calendarEventId: "gcal-77",
    });
    expect(insertOne).not.toHaveBeenCalled();
    expect(mockedRunMeetingIngestionCommand).not.toHaveBeenCalled();
  });

  it("returns 400 when no workspace is configured", async () => {
    mockedGetWorkspaceIdForUser.mockResolvedValue(null as any);
    const { db, insertOne } = buildDb();
    mockedGetDb.mockResolvedValue(db);

    const response = await POST(requestWith(validBody));

    expect(response.status).toBe(400);
    expect(insertOne).not.toHaveBeenCalled();
  });
});
