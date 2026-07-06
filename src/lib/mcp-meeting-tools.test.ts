import { getMcpMeetingToolDefinitions } from "@/lib/mcp-meeting-tools";
import {
  executeRegisteredMcpTool,
  registerMcpTools,
  resetMcpRegistryForTests,
} from "@/lib/mcp-registry";
import { McpToolCallError } from "@/lib/mcp-read-tools";

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

const run = (db: any, toolName: string, args: Record<string, unknown>) =>
  executeRegisteredMcpTool({ db, workspaceId: "workspace-1" }, toolName, args);

describe("mcp-meeting-tools", () => {
  beforeAll(() => {
    resetMcpRegistryForTests();
    registerMcpTools(getMcpMeetingToolDefinitions());
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("exposes the three meeting tools, all read-scoped", () => {
    const definitions = getMcpMeetingToolDefinitions();
    expect(definitions.map((definition) => definition.name)).toEqual([
      "search_meetings",
      "get_meeting",
      "get_transcript_snippets",
    ]);
    expect(definitions.every((definition) => definition.scope === "mcp:read")).toBe(
      true
    );
  });

  it("search_meetings ranks keyword matches and strips secrets", async () => {
    const meetingsCursor = createCursor([
      {
        _id: "meeting-1",
        title: "Roadmap planning",
        summary: "Discussed the roadmap milestones",
        attendees: [{ name: "Alex" }],
        startTime: new Date("2026-06-01T10:00:00.000Z"),
        recordingId: "secret",
        recordingIdHash: "secret-hash",
      },
      {
        _id: "meeting-2",
        title: "Hiring sync",
        summary: "Interview loop",
        attendees: [],
        startTime: new Date("2026-06-02T10:00:00.000Z"),
      },
    ]);
    const find = jest.fn(() => meetingsCursor);
    const db = {
      collection: jest.fn((name: string) => {
        if (name === "meetings") return { find };
        throw new Error(`Unexpected collection: ${name}`);
      }),
    } as any;

    const result = await run(db, "search_meetings", { query: "roadmap" });
    const data = result.data as any;

    expect(find).toHaveBeenCalledWith(
      { workspaceId: "workspace-1", isHidden: { $ne: true } },
      expect.anything()
    );
    expect(data.totalCount).toBe(1);
    expect(data.meetings[0]).toMatchObject({
      id: "meeting-1",
      title: "Roadmap planning",
    });
    expect(data.meetings[0].score).toBeGreaterThan(0);
    expect(JSON.stringify(data)).not.toContain("secret");
  });

  it("search_meetings rejects an empty query", async () => {
    const db = { collection: jest.fn() } as any;
    await expect(run(db, "search_meetings", { query: "   " })).rejects.toBeInstanceOf(
      McpToolCallError
    );
  });

  it("get_meeting returns the meeting without recording ids or transcript", async () => {
    const findOne = jest.fn(async () => ({
      _id: "meeting-1",
      workspaceId: "workspace-1",
      title: "Roadmap planning",
      summary: "Discussed milestones",
      recordingId: "secret",
      recordingIdHash: "secret-hash",
      originalTranscript: "00:01 - Alex: full transcript body",
      createdAt: new Date("2026-06-01T10:00:00.000Z"),
    }));
    const db = {
      collection: jest.fn(() => ({ findOne })),
    } as any;

    const result = await run(db, "get_meeting", { meetingId: "meeting-1" });
    const meeting = (result.data as any).meeting;

    expect(meeting).toMatchObject({ id: "meeting-1", title: "Roadmap planning" });
    expect(meeting).not.toHaveProperty("recordingId");
    expect(meeting).not.toHaveProperty("recordingIdHash");
    expect(meeting).not.toHaveProperty("originalTranscript");
  });

  it("get_meeting returns null data when the meeting is missing", async () => {
    const db = {
      collection: jest.fn(() => ({ findOne: jest.fn(async () => null) })),
    } as any;

    const result = await run(db, "get_meeting", { meetingId: "ghost" });
    expect((result.data as any).meeting).toBeNull();
    expect(result.summary).toBe("Meeting not found.");
  });

  it("get_transcript_snippets returns bounded snippets, never the raw transcript", async () => {
    const transcript = [
      "00:01 - Alex: We must finish the roadmap deck",
      "00:02 - Blake: Agreed, roadmap first",
      "00:03 - Alex: Unrelated chatter",
    ].join("\n");
    const findOne = jest.fn(async () => ({
      _id: "meeting-1",
      title: "Roadmap planning",
      originalTranscript: transcript,
    }));
    const db = { collection: jest.fn(() => ({ findOne })) } as any;

    const result = await run(db, "get_transcript_snippets", {
      meetingId: "meeting-1",
      query: "roadmap",
      maxSnippets: 1,
    });
    const data = result.data as any;

    expect(data.snippets).toHaveLength(1);
    expect(data.snippets[0].snippet).toContain("roadmap deck");
    expect(data.meeting).toEqual({ id: "meeting-1", title: "Roadmap planning" });
    expect(JSON.stringify(data)).not.toContain("Unrelated chatter");
  });

  it("get_transcript_snippets clamps maxSnippets to the schema maximum", async () => {
    const db = { collection: jest.fn() } as any;
    await expect(
      run(db, "get_transcript_snippets", {
        meetingId: "meeting-1",
        query: "roadmap",
        maxSnippets: 50,
      })
    ).rejects.toBeInstanceOf(McpToolCallError);
  });
});
