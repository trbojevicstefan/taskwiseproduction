import { finalizeExistingFathomMeetingReanalysis } from "@/lib/fathom-ingest/existing-meeting-reanalysis";
import { runMeetingIngestionCommand } from "@/lib/services/meeting-ingestion-command";
import { postMeetingAutomationToSlack } from "@/lib/slack-automation";

jest.mock("@/lib/services/meeting-ingestion-command", () => ({
  runMeetingIngestionCommand: jest.fn(),
}));

jest.mock("@/lib/slack-automation", () => ({
  postMeetingAutomationToSlack: jest.fn(),
}));

const mockedRunMeetingIngestionCommand =
  runMeetingIngestionCommand as jest.MockedFunction<typeof runMeetingIngestionCommand>;
const mockedPostMeetingAutomationToSlack =
  postMeetingAutomationToSlack as jest.MockedFunction<typeof postMeetingAutomationToSlack>;

describe("fathom-ingest/existing-meeting-reanalysis", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("updates the existing meeting, planning session, chat session, and side effects", async () => {
    const meetingsUpdateOne = jest.fn().mockResolvedValue({ acknowledged: true });
    const planningInsertOne = jest.fn().mockResolvedValue({ acknowledged: true });
    const chatSessionsUpdateMany = jest.fn().mockResolvedValue({ acknowledged: true });
    const tasksFind = jest.fn().mockReturnValue({
      project: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([{ _id: "task-canonical-1", sourceTaskId: "task-1" }]),
      }),
    });
    const db = {
      collection: jest.fn((name: string) => {
        if (name === "meetings") {
          return { updateOne: meetingsUpdateOne };
        }
        if (name === "planningSessions") {
          return { insertOne: planningInsertOne, updateMany: jest.fn().mockResolvedValue({ acknowledged: true }) };
        }
        if (name === "tasks") {
          return { find: tasksFind };
        }
        if (name === "chatSessions") {
          return { updateMany: chatSessionsUpdateMany };
        }
        throw new Error(`Unexpected collection: ${name}`);
      }),
    } as any;

    const result = await finalizeExistingFathomMeetingReanalysis({
      db,
      user: { autoApproveCompletedTasks: false },
      userId: "user-1",
      existing: {
        _id: "meeting-1",
        title: "Existing title",
        attendees: [{ name: "Existing" }],
        extractedTasks: [{ id: "task-1", title: "Prepare deck" }],
        recordingIdHashes: ["hash-existing"],
        dedupeFingerprints: ["fp-existing"],
        chatSessionId: "chat-1",
        planningSessionId: null,
        workspaceId: "workspace-1",
      },
      connectionId: "connection-1",
      providerSourceId: "provider-1",
      workspaceId: "workspace-1",
      organizerEmailFromPayload: "host@example.com",
      meetingTitle: "Sprint Planning",
      meetingSummary: "Discussed roadmap",
      uniquePeople: [{ name: "Jane Doe", role: "attendee" }],
      finalizedTasks: [{ id: "task-1", title: "Prepare deck" }],
      sanitizedTasks: [{ id: "task-1", title: "Prepare deck" }],
      sanitizedTaskLevels: {
        light: [{ id: "task-1", title: "Prepare deck" }],
        medium: [{ id: "task-1", title: "Prepare deck" }],
        detailed: [{ id: "task-1", title: "Prepare deck" }],
      },
      analysisResult: {
        keyMoments: [{ timestamp: 10, label: "Intro" }],
        overallSentiment: "positive",
        speakerActivity: [{ speaker: "Jane", seconds: 42 }],
        meetingMetadata: { source: "fathom" },
      },
      completionSuggestions: [],
      completionMatchThreshold: 0.6,
      shouldAutoApprove: false,
      recordingUrl: "https://example.com/recording",
      shareUrl: "https://example.com/share",
      startTime: new Date("2026-07-02T09:00:00.000Z"),
      endTime: new Date("2026-07-02T10:00:00.000Z"),
      duration: 3600,
    });

    expect(result).toEqual({ status: "duplicate", meetingId: "meeting-1" });
    expect(meetingsUpdateOne).toHaveBeenCalledWith(
      { _id: "meeting-1" },
      expect.objectContaining({
        $set: expect.objectContaining({
          title: "Existing title",
          summary: "Discussed roadmap",
          attendees: [{ name: "Jane Doe", role: "attendee" }],
          extractedTasks: [{ id: "task-1", title: "Prepare deck" }],
          planningSessionId: expect.any(String),
        }),
      })
    );
    expect(planningInsertOne).toHaveBeenCalledTimes(1);
    expect(chatSessionsUpdateMany).toHaveBeenCalledTimes(1);
    expect(mockedRunMeetingIngestionCommand).toHaveBeenCalledTimes(1);
    expect(mockedPostMeetingAutomationToSlack).toHaveBeenCalledTimes(1);
  });
});
