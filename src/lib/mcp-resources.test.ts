import { getMcpResourceDefinitions } from "@/lib/mcp-resources";
import {
  readRegisteredMcpResource,
  registerMcpResources,
  resetMcpRegistryForTests,
} from "@/lib/mcp-registry";
import { listActiveWorkspaceMembershipsForWorkspace } from "@/lib/workspace-memberships";

jest.mock("@/lib/workspace-memberships", () => ({
  listActiveWorkspaceMembershipsForWorkspace: jest.fn(),
}));

const mockedMemberships =
  listActiveWorkspaceMembershipsForWorkspace as jest.MockedFunction<
    typeof listActiveWorkspaceMembershipsForWorkspace
  >;

const createCursor = (rows: any[]) => {
  let workingRows = [...rows];
  const cursor: any = {};
  cursor.project = jest.fn(() => cursor);
  cursor.sort = jest.fn(() => cursor);
  cursor.limit = jest.fn((limit: number) => {
    workingRows = workingRows.slice(0, limit);
    return cursor;
  });
  cursor.toArray = jest.fn(async () => workingRows);
  return cursor;
};

const read = (db: any, uri: string) =>
  readRegisteredMcpResource({ db, workspaceId: "workspace-1" }, uri);

const EXPECTED_URIS = [
  "taskwise://workspace/summary",
  "taskwise://meetings",
  "taskwise://meetings/{meetingId}/transcript",
  "taskwise://tasks",
  "taskwise://board",
  "taskwise://people",
  "taskwise://clients",
  "taskwise://calendar",
];

describe("mcp-resources", () => {
  beforeAll(() => {
    resetMcpRegistryForTests();
    registerMcpResources(getMcpResourceDefinitions());
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockedMemberships.mockResolvedValue([
      { userId: "user-1", status: "active" },
    ] as any);
  });

  it("registers exactly the eight spec resources", () => {
    expect(getMcpResourceDefinitions().map((resource) => resource.uri)).toEqual(
      EXPECTED_URIS
    );
  });

  it("workspace summary aggregates counts and recent meetings", async () => {
    const meetingsCursor = createCursor([
      {
        _id: "meeting-1",
        title: "Roadmap planning",
        startTime: new Date("2026-07-01T10:00:00.000Z"),
        attendees: [{ name: "Alex" }],
        summary: "Discussed milestones",
      },
    ]);
    const db = {
      collection: jest.fn((name: string) => {
        if (name === "meetings") {
          return {
            countDocuments: jest.fn(async () => 12),
            find: jest.fn(() => meetingsCursor),
          };
        }
        if (name === "tasks") return { countDocuments: jest.fn(async () => 7) };
        if (name === "people") return { countDocuments: jest.fn(async () => 5) };
        if (name === "taskReminders")
          return { countDocuments: jest.fn(async () => 2) };
        throw new Error(`Unexpected collection: ${name}`);
      }),
    } as any;

    const contents = await read(db, "taskwise://workspace/summary");
    expect(contents?.mimeType).toBe("application/json");
    const payload = JSON.parse(contents!.text);
    expect(payload.counts).toMatchObject({
      meetings: 12,
      openTasks: 7,
      overdueTasks: 7,
      people: 5,
      clients: 5,
      scheduledReminders: 2,
    });
    expect(payload.recentMeetings[0]).toMatchObject({
      id: "meeting-1",
      title: "Roadmap planning",
      attendeeCount: 1,
    });
  });

  it("meetings resource returns whitelisted fields only", async () => {
    const meetingsCursor = createCursor([
      {
        _id: "meeting-1",
        title: "Roadmap planning",
        startTime: new Date("2026-07-01T10:00:00.000Z"),
        attendees: [],
        summary: "Discussed milestones",
        recordingId: "secret",
        recordingIdHash: "secret-hash",
        originalTranscript: "raw transcript body",
      },
    ]);
    const db = {
      collection: jest.fn(() => ({ find: jest.fn(() => meetingsCursor) })),
    } as any;

    const contents = await read(db, "taskwise://meetings");
    expect(contents?.text).not.toContain("secret");
    expect(contents?.text).not.toContain("raw transcript body");
    const payload = JSON.parse(contents!.text);
    expect(payload.meetings[0]).toEqual({
      id: "meeting-1",
      title: "Roadmap planning",
      startTime: "2026-07-01T10:00:00.000Z",
      attendeeCount: 0,
      summary: "Discussed milestones",
    });
  });

  it("transcript resource matches parameterized URIs and caps the text", async () => {
    const longTranscript = "line ".repeat(10_000);
    const findOne = jest.fn(async () => ({
      _id: "meeting-1",
      title: "Roadmap planning",
      originalTranscript: longTranscript,
    }));
    const db = { collection: jest.fn(() => ({ findOne })) } as any;

    const contents = await read(db, "taskwise://meetings/meeting-1/transcript");
    expect(contents?.mimeType).toBe("text/plain");
    expect(contents!.text.length).toBeLessThan(longTranscript.length);
    expect(contents!.text).toContain("[Transcript truncated at 20000 characters]");
    expect(findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "workspace-1",
        $or: [{ _id: "meeting-1" }, { id: "meeting-1" }],
      }),
      expect.anything()
    );
  });

  it("transcript resource throws for missing meetings and ignores bad URIs", async () => {
    const db = {
      collection: jest.fn(() => ({ findOne: jest.fn(async () => null) })),
    } as any;

    await expect(
      read(db, "taskwise://meetings/ghost/transcript")
    ).rejects.toMatchObject({ code: "invalid_arguments" });

    // URIs that do not match the pattern resolve to no resource at all.
    await expect(
      read(db, "taskwise://meetings/../../etc/passwd/transcript")
    ).resolves.toBeNull();
  });

  it("tasks resource returns open tasks with whitelisted fields", async () => {
    const tasksCursor = createCursor([
      {
        _id: "task-1",
        title: "Ship the deck",
        status: "todo",
        dueAt: "2026-07-09T00:00:00.000Z",
        priorityScore: 60,
        priorityLabel: "high",
        priorityReason: "Due in 3 days",
        assigneeName: "Alex",
        sourceSessionId: "meeting-1",
        comments: "internal notes",
      },
    ]);
    const db = {
      collection: jest.fn(() => ({ find: jest.fn(() => tasksCursor) })),
    } as any;

    const contents = await read(db, "taskwise://tasks");
    const payload = JSON.parse(contents!.text);
    expect(payload.tasks[0]).toEqual({
      id: "task-1",
      title: "Ship the deck",
      status: "todo",
      dueAt: "2026-07-09T00:00:00.000Z",
      priorityScore: 60,
      priorityLabel: "high",
      priorityReason: "Due in 3 days",
      assigneeName: "Alex",
      sourceSessionId: "meeting-1",
    });
  });

  it("board resource snapshots the default board's columns", async () => {
    const board = { _id: "board-1", name: "Delivery", isDefault: true };
    const statuses = [
      { _id: "status-todo", label: "To do", category: "todo", order: 0 },
    ];
    const items = [
      {
        _id: "item-1",
        statusId: "status-todo",
        task: { _id: "task-1", title: "Ship the deck", status: "todo" },
      },
    ];
    const db = {
      collection: jest.fn((name: string) => {
        if (name === "boards") return { findOne: jest.fn(async () => board) };
        if (name === "boardStatuses")
          return { find: jest.fn(() => createCursor(statuses)) };
        if (name === "boardItems")
          return { aggregate: jest.fn(() => ({ toArray: jest.fn(async () => items) })) };
        throw new Error(`Unexpected collection: ${name}`);
      }),
    } as any;

    const contents = await read(db, "taskwise://board");
    const payload = JSON.parse(contents!.text);
    expect(payload.board).toEqual({ id: "board-1", name: "Delivery", isDefault: true });
    expect(payload.statuses[0]).toMatchObject({
      id: "status-todo",
      label: "To do",
      itemCount: 1,
    });
    expect(payload.statuses[0].items[0]).toMatchObject({
      id: "task-1",
      title: "Ship the deck",
    });
  });

  it("people and clients resources return compact person records", async () => {
    const people = [
      {
        _id: "person-1",
        name: "Casey Client",
        email: "casey@client.com",
        personType: "client",
        company: "Client Co",
        lastSeenAt: new Date("2026-07-01T10:00:00.000Z"),
        nextFollowUpAt: new Date("2026-07-20T10:00:00.000Z"),
        slackId: "U123",
      },
    ];
    const db = {
      collection: jest.fn(() => ({ find: jest.fn(() => createCursor(people)) })),
    } as any;

    const peopleContents = await read(db, "taskwise://people");
    const peoplePayload = JSON.parse(peopleContents!.text);
    expect(peoplePayload.people[0]).toEqual({
      id: "person-1",
      name: "Casey Client",
      email: "casey@client.com",
      personType: "client",
      company: "Client Co",
      lastSeenAt: "2026-07-01T10:00:00.000Z",
    });

    const clientsContents = await read(db, "taskwise://clients");
    const clientsPayload = JSON.parse(clientsContents!.text);
    expect(clientsPayload.clients[0]).toMatchObject({
      id: "person-1",
      company: "Client Co",
      nextFollowUpAt: "2026-07-20T10:00:00.000Z",
    });
  });

  it("calendar resource returns meetings, in-window tasks, and reminders", async () => {
    const inWindow = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    const meetings = [
      { _id: "meeting-1", title: "Client sync", startTime: inWindow, attendees: [] },
    ];
    const tasks = [
      { _id: "task-1", title: "Ship the deck", status: "todo", dueAt: inWindow },
      {
        _id: "task-far",
        title: "Far future",
        status: "todo",
        dueAt: "2999-01-01T00:00:00.000Z",
      },
    ];
    const reminders = [
      {
        _id: "reminder-1",
        taskId: "task-1",
        taskTitle: "Ship the deck",
        kind: "before_due",
        runAt: inWindow,
      },
    ];
    const db = {
      collection: jest.fn((name: string) => {
        if (name === "meetings") return { find: jest.fn(() => createCursor(meetings)) };
        if (name === "tasks") return { find: jest.fn(() => createCursor(tasks)) };
        if (name === "taskReminders")
          return { find: jest.fn(() => createCursor(reminders)) };
        throw new Error(`Unexpected collection: ${name}`);
      }),
    } as any;

    const contents = await read(db, "taskwise://calendar");
    const payload = JSON.parse(contents!.text);
    expect(payload.meetings).toHaveLength(1);
    expect(payload.tasks.map((task: any) => task.id)).toEqual(["task-1"]);
    expect(payload.reminders[0]).toMatchObject({ id: "reminder-1", kind: "before_due" });
  });
});
