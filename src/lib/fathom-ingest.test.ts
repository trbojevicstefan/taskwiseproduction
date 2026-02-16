import { ingestFathomMeeting } from "@/lib/fathom-ingest";
import { analyzeMeeting } from "@/ai/flows/analyze-meeting-flow";
import { getDb } from "@/lib/db";
import {
  fetchFathomSummary,
  formatFathomTranscript,
  hashFathomRecordingId,
} from "@/lib/fathom";
import { normalizeTask } from "@/lib/data";
import { runMeetingIngestionCommand } from "@/lib/services/meeting-ingestion-command";

jest.mock("@/ai/flows/analyze-meeting-flow", () => ({
  analyzeMeeting: jest.fn(),
}));

jest.mock("@/lib/db", () => ({
  getDb: jest.fn(),
}));

jest.mock("@/lib/fathom", () => ({
  fetchFathomSummary: jest.fn(),
  fetchFathomTranscript: jest.fn(),
  formatFathomTranscript: jest.fn(),
  hashFathomRecordingId: jest.fn(),
}));

jest.mock("@/lib/data", () => ({
  normalizeTask: jest.fn((task: any) => task),
}));

jest.mock("@/lib/task-completion", () => ({
  applyCompletionTargets: jest.fn(),
  buildCompletionSuggestions: jest.fn().mockResolvedValue([]),
  mergeCompletionSuggestions: jest.fn((tasks: any[]) => tasks),
}));

jest.mock("@/lib/services/meeting-ingestion-command", () => ({
  runMeetingIngestionCommand: jest.fn(),
}));

jest.mock("@/lib/slack-automation", () => ({
  postMeetingAutomationToSlack: jest.fn(),
}));

const mockedAnalyzeMeeting = analyzeMeeting as jest.MockedFunction<
  typeof analyzeMeeting
>;
const mockedGetDb = getDb as jest.MockedFunction<typeof getDb>;
const mockedFetchFathomSummary = fetchFathomSummary as jest.MockedFunction<
  typeof fetchFathomSummary
>;
const mockedFormatFathomTranscript = formatFathomTranscript as jest.MockedFunction<
  typeof formatFathomTranscript
>;
const mockedHashFathomRecordingId = hashFathomRecordingId as jest.MockedFunction<
  typeof hashFathomRecordingId
>;
const mockedNormalizeTask = normalizeTask as jest.MockedFunction<typeof normalizeTask>;
const mockedRunMeetingIngestionCommand =
  runMeetingIngestionCommand as jest.MockedFunction<
    typeof runMeetingIngestionCommand
  >;

describe("ingestFathomMeeting ingestion parity", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedHashFathomRecordingId.mockReturnValue("recording-hash");
    mockedFetchFathomSummary.mockResolvedValue("summary payload" as any);
    mockedFormatFathomTranscript.mockReturnValue("Meeting transcript");
    mockedNormalizeTask.mockImplementation((task: any) => task);
    mockedAnalyzeMeeting.mockResolvedValue({
      allTaskLevels: {
        medium: [{ id: "task-1", title: "Prepare deck", priority: "medium" }],
      },
      attendees: [{ name: "Jane Doe", email: "jane@example.com" }],
      mentionedPeople: [],
      meetingSummary: "Discussed roadmap",
      chatResponseText: "Discussed roadmap",
      sessionTitle: "Sprint Planning",
      keyMoments: [],
      overallSentiment: null,
      speakerActivity: [],
      meetingMetadata: {},
    } as any);
    mockedRunMeetingIngestionCommand.mockResolvedValue({
      people: { created: 0, updated: 0 },
      tasks: { upserted: 0, deleted: 0 },
      boardItemsCreated: 0,
    });
  });

  it("routes Fathom-created meeting side effects through shared ingestion command", async () => {
    const meetingsFindOne = jest.fn().mockResolvedValue(null);
    const meetingsUpdateOne = jest.fn().mockResolvedValue({ acknowledged: true });
    const planningInsertOne = jest.fn().mockResolvedValue({ acknowledged: true });

    const db = {
      collection: jest.fn((name: string) => {
        if (name === "meetings") {
          return {
            findOne: meetingsFindOne,
            updateOne: meetingsUpdateOne,
          };
        }
        if (name === "planningSessions") {
          return {
            insertOne: planningInsertOne,
          };
        }
        throw new Error(`Unexpected collection in test: ${name}`);
      }),
    } as any;
    mockedGetDb.mockResolvedValue(db);

    const user = {
      _id: { toString: () => "user-1" },
      workspace: { id: "workspace-1" },
      autoApproveCompletedTasks: false,
      completionMatchThreshold: 0.6,
      taskGranularityPreference: "medium",
    } as any;

    const result = await ingestFathomMeeting({
      user,
      recordingId: "rec-123",
      accessToken: "access-token",
      data: {
        transcript: [{ speaker: "Jane", text: "Hello" }],
        summary: "Discussed roadmap",
        title: "Sprint Planning",
      },
    });

    expect(result.status).toBe("created");
    expect(mockedRunMeetingIngestionCommand).toHaveBeenCalledTimes(1);
    expect(mockedRunMeetingIngestionCommand).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        mode: "flagged-event",
        userId: "user-1",
        payload: expect.objectContaining({
          meetingId: expect.any(String),
          workspaceId: "workspace-1",
          title: "Sprint Planning",
          attendees: [{ name: "Jane Doe", email: "jane@example.com", role: "attendee" }],
          extractedTasks: [{ id: "task-1", title: "Prepare deck", priority: "medium" }],
        }),
      })
    );
  });
});
