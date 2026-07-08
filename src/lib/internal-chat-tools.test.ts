import { runInternalChatTool } from "@/lib/internal-chat-tools";

jest.mock("@/lib/mcp-workspace-tools", () => ({
  getMcpWorkspaceToolDefinitions: () => [
    {
      name: "get_calendar_agenda",
      handler: jest.fn(async () => ({
        toolName: "get_calendar_agenda",
        summary:
          "Agenda 2026-07-06 -> 2026-07-12: 3 meeting(s), 2 due task(s), 1 reminder(s).",
        data: {
          from: "2026-07-06T00:00:00.000Z",
          to: "2026-07-12T23:59:59.999Z",
          meetings: [
            {
              id: "m1",
              title: "Kickoff",
              startTime: "2026-07-07T10:00:00.000Z",
              attendeeCount: 3,
              isClientMeeting: true,
            },
            {
              id: "m2",
              title: "Retro",
              startTime: "2026-07-08T09:00:00.000Z",
              attendeeCount: 4,
              isClientMeeting: false,
            },
            {
              id: "m3",
              title: "Planning",
              startTime: "2026-07-09T11:00:00.000Z",
              attendeeCount: 2,
              isClientMeeting: false,
            },
          ],
          tasks: [],
          reminders: [],
        },
      })),
    },
  ],
}));

describe("runInternalChatTool", () => {
  it("normalizes calendar agenda output into chat context blocks", async () => {
    const result = await runInternalChatTool({
      db: {} as any,
      workspaceId: "ws-1",
      toolName: "get_calendar_agenda",
      toolArgs: {
        from: "2026-07-06T00:00:00.000Z",
        to: "2026-07-12T23:59:59.999Z",
      },
    });

    expect(result.summary).toContain("3 meeting(s)");
    expect(result.contextBlocks).toContain(
      "AGENDA_RANGE 2026-07-06T00:00:00.000Z | 2026-07-12T23:59:59.999Z"
    );
    expect(result.contextBlocks).toContain(
      "MEETING m1 | Kickoff | 2026-07-07 | attendees=3 | clientMeeting=true"
    );
  });
});
