import { syncFathomMeetingChatSession } from "@/lib/fathom-ingest/session-linking";

describe("fathom-ingest/session-linking", () => {
  it("updates chat sessions with canonical task ids when source tasks exist", async () => {
    const chatSessionsUpdateMany = jest.fn().mockResolvedValue({ acknowledged: true });
    const tasksFind = jest.fn().mockReturnValue({
      project: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([
          { _id: "task-canonical-1", sourceTaskId: "task-1" },
          { _id: "task-canonical-2", sourceTaskId: "task-2" },
        ]),
      }),
    });
    const db = {
      collection: jest.fn((name: string) => {
        if (name === "tasks") {
          return { find: tasksFind };
        }
        if (name === "chatSessions") {
          return { updateMany: chatSessionsUpdateMany };
        }
        throw new Error(`Unexpected collection: ${name}`);
      }),
    } as any;

    await syncFathomMeetingChatSession({
      db,
      userId: "user-1",
      chatSessionId: "chat-1",
      meetingTitle: "Sprint Planning",
      uniquePeople: [{ name: "Jane Doe", role: "attendee" }],
      finalizedTasks: [
        { id: "task-1", title: "Prepare deck" },
        { id: "task-2", title: "Review notes" },
      ],
      sanitizedTasks: [
        { id: "task-1", title: "Prepare deck" },
        { id: "task-2", title: "Review notes" },
      ],
      sanitizedTaskLevels: {
        light: [],
        medium: [],
        detailed: [],
      },
      meetingMetadata: { source: "fathom" },
      now: new Date("2026-07-02T10:30:00.000Z"),
    });

    expect(tasksFind).toHaveBeenCalledWith({
      userId: "user-1",
      sourceTaskId: { $in: ["task-1", "task-2"] },
    });
    expect(chatSessionsUpdateMany).toHaveBeenCalledWith(
      {
        userId: "user-1",
        $or: [{ _id: "chat-1" }, { id: "chat-1" }],
      },
      expect.objectContaining({
        $set: expect.objectContaining({
          title: 'Chat about "Sprint Planning"',
          suggestedTasks: [
            { id: "task-1", title: "Prepare deck", taskCanonicalId: "task-canonical-1" },
            { id: "task-2", title: "Review notes", taskCanonicalId: "task-canonical-2" },
          ],
          people: [{ name: "Jane Doe", role: "attendee" }],
          lastActivityAt: new Date("2026-07-02T10:30:00.000Z"),
        }),
      })
    );
  });
});
