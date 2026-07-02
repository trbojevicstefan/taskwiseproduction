import { ingestFathomMeeting } from "@/lib/fathom-ingest";
import { analyzeMeeting } from "@/ai/flows/analyze-meeting-flow";
import { getDb } from "@/lib/db";
import {
  fetchFathomSummary,
  formatFathomTranscript,
  getFathomRecordingHashScope,
  hashFathomRecordingId,
} from "@/lib/fathom";
import { normalizeTask } from "@/lib/data";
import { runMeetingIngestionCommand } from "@/lib/services/meeting-ingestion-command";
import { findFathomConnectionById } from "@/lib/fathom-connections";

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
  getFathomRecordingHashScope: jest.fn(),
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

jest.mock("@/lib/fathom-connections", () => ({
  findFathomConnectionById: jest.fn(),
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
const mockedGetFathomRecordingHashScope =
  getFathomRecordingHashScope as jest.MockedFunction<typeof getFathomRecordingHashScope>;
const mockedHashFathomRecordingId = hashFathomRecordingId as jest.MockedFunction<
  typeof hashFathomRecordingId
>;
const mockedNormalizeTask = normalizeTask as jest.MockedFunction<typeof normalizeTask>;
const mockedRunMeetingIngestionCommand =
  runMeetingIngestionCommand as jest.MockedFunction<
    typeof runMeetingIngestionCommand
  >;
const mockedFindFathomConnectionById =
  findFathomConnectionById as jest.MockedFunction<typeof findFathomConnectionById>;

const createCursor = (rows: any[]) => {
  const cursor: any = {};
  cursor.sort = jest.fn(() => cursor);
  cursor.limit = jest.fn(() => cursor);
  cursor.toArray = jest.fn(async () => rows);
  return cursor;
};

describe("ingestFathomMeeting ingestion parity", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetFathomRecordingHashScope.mockImplementation(
      ({ userId, connectionId }) => connectionId || userId
    );
    mockedHashFathomRecordingId.mockReturnValue("recording-hash");
    mockedFetchFathomSummary.mockResolvedValue("summary payload" as any);
    mockedFormatFathomTranscript.mockReturnValue("Meeting transcript");
    mockedFindFathomConnectionById.mockResolvedValue(null);
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
    const meetingsUpdateOne = jest
      .fn()
      .mockResolvedValue({ acknowledged: true, upsertedId: "meeting-created-1" });
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

  it("prefers the connection workspace when ingesting a connection-scoped meeting", async () => {
    const meetingsFindOne = jest.fn().mockResolvedValue(null);
    const meetingsUpdateOne = jest
      .fn()
      .mockResolvedValue({ acknowledged: true, upsertedId: "meeting-created-2" });
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
    mockedFindFathomConnectionById.mockResolvedValue({
      _id: "connection-1",
      workspaceId: "workspace-connection",
    } as any);

    const user = {
      _id: { toString: () => "user-1" },
      workspace: { id: "workspace-user" },
      activeWorkspaceId: "workspace-user-active",
      autoApproveCompletedTasks: false,
      completionMatchThreshold: 0.6,
      taskGranularityPreference: "medium",
    } as any;

    const result = await ingestFathomMeeting({
      user,
      recordingId: "rec-456",
      connectionId: "connection-1",
      accessToken: "access-token",
      data: {
        transcript: [{ speaker: "Jane", text: "Hello" }],
        summary: "Discussed roadmap",
        title: "Sprint Planning",
      },
    });

    expect(result.status).toBe("created");
    expect(mockedRunMeetingIngestionCommand).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        payload: expect.objectContaining({
          workspaceId: "workspace-connection",
        }),
      })
    );
  });

  it("treats duplicate-key upsert races as duplicate and skips planning/event side effects", async () => {
    const meetingsFindOne = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ _id: "meeting-existing" });
    const meetingsUpdateOne = jest.fn().mockRejectedValue({
      code: 11000,
      message: "E11000 duplicate key error",
    });
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
      recordingId: "rec-race",
      accessToken: "access-token",
      data: {
        transcript: [{ speaker: "Jane", text: "Hello" }],
        summary: "Discussed roadmap",
        title: "Sprint Planning",
      },
    });

    expect(result).toEqual({ status: "duplicate", meetingId: "meeting-existing" });
    expect(planningInsertOne).not.toHaveBeenCalled();
    expect(mockedRunMeetingIngestionCommand).not.toHaveBeenCalled();
  });

  it("dedupes cross-note-taker duplicates by canonical title/time and records hash aliases", async () => {
    mockedHashFathomRecordingId.mockImplementation(
      (scope: string, recordingId: string) => `${scope}:${recordingId}`
    );

    const meetingsFindOne = jest.fn().mockResolvedValueOnce(null);
    const meetingsFind = jest.fn(() =>
      createCursor([
        {
        _id: "meeting-existing",
        userId: "user-1",
        workspaceId: "workspace-1",
        connectionId: "connection-a",
        title: "Roadmap Sync",
        summary: "Already summarized",
        originalTranscript: "Already has transcript",
        recordingIdHash: "connection-a:rec-a",
        recordingIdHashes: ["connection-a:rec-a"],
        attendees: [{ name: "Alex Parker" }, { email: "jane@example.com" }],
        analysisAttemptedAt: new Date("2026-04-16T09:00:00.000Z"),
        state: "tasks_ready",
        extractedTasks: [],
        createdAt: new Date("2026-04-16T09:05:00.000Z"),
      },
      ])
    );
    const meetingsUpdateOne = jest.fn().mockResolvedValue({ acknowledged: true });
    const planningInsertOne = jest.fn().mockResolvedValue({ acknowledged: true });

    const db = {
      collection: jest.fn((name: string) => {
        if (name === "meetings") {
          return {
            findOne: meetingsFindOne,
            find: meetingsFind,
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
    mockedFindFathomConnectionById.mockResolvedValue({
      _id: "connection-b",
      workspaceId: "workspace-1",
    } as any);

    const user = {
      _id: { toString: () => "user-1" },
      workspace: { id: "workspace-1" },
      autoApproveCompletedTasks: false,
      completionMatchThreshold: 0.6,
      taskGranularityPreference: "medium",
    } as any;

    const result = await ingestFathomMeeting({
      user,
      recordingId: "rec-b",
      connectionId: "connection-b",
      accessToken: "access-token",
      data: {
        title: "Roadmap Sync",
        recording_start_time: "2026-04-16T09:00:00.000Z",
        duration: 1800,
        attendees: [{ name: "Alex Parker" }, { email: "other@example.com" }],
      },
    });

    expect(result).toEqual({ status: "duplicate", meetingId: "meeting-existing" });
    expect(meetingsUpdateOne).toHaveBeenCalledWith(
      { _id: "meeting-existing" },
      expect.objectContaining({
        $set: expect.objectContaining({
          recordingIdHashes: expect.arrayContaining(["connection-b:rec-b", "user-1:rec-b"]),
          ingestSource: "fathom",
        }),
      })
    );
    expect(planningInsertOne).not.toHaveBeenCalled();
    expect(mockedRunMeetingIngestionCommand).not.toHaveBeenCalled();
  });

  it("does not merge same-title meetings when attendee overlap is low", async () => {
    mockedHashFathomRecordingId.mockImplementation(
      (scope: string, recordingId: string) => `${scope}:${recordingId}`
    );

    const meetingsFindOne = jest.fn().mockResolvedValueOnce(null);
    const meetingsFind = jest.fn(() =>
      createCursor([
        {
          _id: "meeting-existing",
          userId: "user-1",
          workspaceId: "workspace-1",
          title: "Roadmap Sync",
          startTime: new Date("2026-04-16T09:00:00.000Z"),
          duration: 1800,
          attendees: [{ name: "Different Person" }],
          ingestSource: "fathom",
        },
      ])
    );
    const meetingsUpdateOne = jest
      .fn()
      .mockResolvedValue({ acknowledged: true, upsertedId: "meeting-created-3" });
    const planningInsertOne = jest.fn().mockResolvedValue({ acknowledged: true });

    const db = {
      collection: jest.fn((name: string) => {
        if (name === "meetings") {
          return {
            findOne: meetingsFindOne,
            find: meetingsFind,
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
      recordingId: "rec-c",
      accessToken: "access-token",
      data: {
        title: "Roadmap Sync",
        recording_start_time: "2026-04-16T09:00:00.000Z",
        duration: 1800,
        attendees: [{ name: "Alex Parker" }],
        transcript: [{ speaker: "Alex", text: "Hello" }],
      },
    });

    expect(result.status).toBe("created");
    expect(planningInsertOne).toHaveBeenCalledTimes(1);
    expect(mockedRunMeetingIngestionCommand).toHaveBeenCalledTimes(1);
  });
});
