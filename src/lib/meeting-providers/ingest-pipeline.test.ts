import {
  formatProviderTranscriptSegments,
  ingestProviderMeeting,
  upsertMeetingIdempotently,
} from "@/lib/meeting-providers/ingest-pipeline";
import type { NormalizedProviderMeeting } from "@/lib/meeting-providers/types";
import { findUserById } from "@/lib/db/users";
import { hashFathomRecordingId } from "@/lib/fathom";
import { extractFathomMeetingTasks } from "@/lib/fathom-ingest/task-extraction";
import { runMeetingIngestionCommand } from "@/lib/services/meeting-ingestion-command";
import { postMeetingAutomationToSlack } from "@/lib/slack-automation";

jest.mock("@/lib/db/users", () => ({
  findUserById: jest.fn(),
}));

jest.mock("@/lib/fathom", () => ({
  getFathomRecordingHashScope: jest.fn(
    ({ userId, connectionId }: any) =>
      connectionId ? `connection:${connectionId}` : `user:${userId}`
  ),
  hashFathomRecordingId: jest.fn(() => "provider-recording-hash"),
}));

jest.mock("@/lib/fathom-ingest/deduplication", () => ({
  ensureMeetingRecordingHashIndex: jest.fn(),
}));

jest.mock("@/lib/fathom-ingest/task-extraction", () => ({
  extractFathomMeetingTasks: jest.fn(),
}));

jest.mock("@/lib/services/meeting-ingestion-command", () => ({
  runMeetingIngestionCommand: jest.fn(),
}));

jest.mock("@/lib/slack-automation", () => ({
  postMeetingAutomationToSlack: jest.fn(),
}));

const mockedFindUserById = findUserById as jest.MockedFunction<typeof findUserById>;
const mockedHashFathomRecordingId = hashFathomRecordingId as jest.MockedFunction<
  typeof hashFathomRecordingId
>;
const mockedExtractTasks = extractFathomMeetingTasks as jest.MockedFunction<
  typeof extractFathomMeetingTasks
>;
const mockedRunMeetingIngestionCommand =
  runMeetingIngestionCommand as jest.MockedFunction<typeof runMeetingIngestionCommand>;
const mockedPostMeetingAutomationToSlack =
  postMeetingAutomationToSlack as jest.MockedFunction<
    typeof postMeetingAutomationToSlack
  >;

const buildDb = ({
  meetingFindOne = jest.fn().mockResolvedValue(null),
  meetingUpdateOne = jest
    .fn()
    .mockResolvedValue({ acknowledged: true, upsertedId: "meeting-created-1" }),
  meetingInsertOne = jest.fn().mockResolvedValue({ acknowledged: true }),
  planningInsertOne = jest.fn().mockResolvedValue({ acknowledged: true }),
} = {}) => {
  const meetings = {
    findOne: meetingFindOne,
    updateOne: meetingUpdateOne,
    insertOne: meetingInsertOne,
  };
  const planningSessions = { insertOne: planningInsertOne };
  const db = {
    collection: jest.fn((name: string) => {
      if (name === "meetings") return meetings;
      if (name === "planningSessions") return planningSessions;
      return { findOne: jest.fn(), updateOne: jest.fn(), insertOne: jest.fn() };
    }),
  };
  return { db, meetings, planningSessions };
};

const buildMeeting = (
  overrides: Partial<NormalizedProviderMeeting> = {}
): NormalizedProviderMeeting => ({
  externalId: "ff-transcript-1",
  title: "Weekly Sync",
  startTime: new Date("2026-07-01T10:00:00Z"),
  endTime: new Date("2026-07-01T10:30:00Z"),
  durationSeconds: 1800,
  recordingUrl: "https://provider.example/rec/1",
  shareUrl: "https://provider.example/share/1",
  organizerEmail: "host@example.com",
  participants: [{ name: "Jane Doe", email: "jane@example.com" }],
  transcript: "0:01 - Jane Doe: Hello everyone",
  summary: "Provider summary",
  actionItems: ["Follow up with Jane"],
  ...overrides,
});

describe("ingestProviderMeeting", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedHashFathomRecordingId.mockReturnValue("provider-recording-hash");
    mockedFindUserById.mockResolvedValue({
      _id: { toString: () => "user-1" },
      slackAutoShareEnabled: false,
    } as any);
    mockedExtractTasks.mockResolvedValue({
      analysisResult: {
        sessionTitle: "AI Session Title",
        keyMoments: [],
        overallSentiment: null,
        speakerActivity: [],
        meetingMetadata: {},
      },
      allTaskLevels: null,
      sanitizedTasks: [{ id: "task-1", title: "Prepare deck" }],
      sanitizedTaskLevels: null,
      uniquePeople: [
        { name: "Jane Doe", email: "jane@example.com", role: "attendee" },
      ],
      completionMatchThreshold: 0.8,
      completionSuggestions: [],
      finalizedTasks: [{ id: "task-1", title: "Prepare deck" }],
      meetingTitle: "Weekly Sync",
      meetingSummary: "AI summary",
    } as any);
    mockedRunMeetingIngestionCommand.mockResolvedValue({
      people: { created: 0, updated: 0 },
      tasks: { upserted: 0, deleted: 0 },
      boardItemsCreated: 0,
    });
  });

  it("creates a meeting with the provider ingestSource and publishes meeting.ingested", async () => {
    const { db, meetings, planningSessions } = buildDb();

    const result = await ingestProviderMeeting({
      db,
      provider: "fireflies",
      userId: "user-1",
      workspaceId: "workspace-1",
      connectionId: "connection-1",
      meeting: buildMeeting(),
    });

    expect(result).toEqual({ status: "created", meetingId: "meeting-created-1" });

    // The upsert writes the provider discriminator + external id.
    const upsertCall = meetings.updateOne.mock.calls[0];
    const setFields = upsertCall[1].$set;
    expect(setFields.ingestSource).toBe("fireflies");
    expect(setFields.providerSourceId).toBe("ff-transcript-1");
    expect(setFields.recordingIdHash).toBe("provider-recording-hash");
    expect(setFields.originalTranscript).toBe("0:01 - Jane Doe: Hello everyone");
    expect(setFields.providerActionItems).toEqual(["Follow up with Jane"]);
    expect(upsertCall[2]).toEqual({ upsert: true });

    // Companion planning session points at the canonical meeting id.
    expect(planningSessions.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({ sourceMeetingId: "meeting-created-1" })
    );

    // Side effects ride the shared ingestion command (people + task sync).
    expect(mockedRunMeetingIngestionCommand).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        mode: "flagged-event",
        eventType: "meeting.ingested",
        userId: "user-1",
        payload: expect.objectContaining({
          meetingId: "meeting-created-1",
          workspaceId: "workspace-1",
          title: "Weekly Sync",
          extractedTasks: [{ id: "task-1", title: "Prepare deck" }],
        }),
      })
    );
    expect(mockedPostMeetingAutomationToSlack).toHaveBeenCalled();
  });

  it("passes provider participants into the shared task extraction payload", async () => {
    const { db } = buildDb();

    await ingestProviderMeeting({
      db,
      provider: "grain",
      userId: "user-1",
      workspaceId: "workspace-1",
      connectionId: "connection-1",
      meeting: buildMeeting(),
    });

    expect(mockedExtractTasks).toHaveBeenCalledWith(
      expect.objectContaining({
        transcriptText: "0:01 - Jane Doe: Hello everyone",
        summaryText: "Provider summary",
        meetingTitleFromPayload: "Weekly Sync",
        payload: {
          attendees: [
            expect.objectContaining({
              name: "Jane Doe",
              email: "jane@example.com",
              role: "attendee",
            }),
          ],
        },
      })
    );
  });

  it("returns duplicate without re-analyzing and re-emits meeting.updated when tasks exist", async () => {
    const existing = {
      _id: "existing-meeting-1",
      workspaceId: "workspace-1",
      title: "Weekly Sync",
      originalTranscript: "existing transcript",
      summary: "existing summary",
      extractedTasks: [{ id: "task-9", title: "Existing task" }],
      attendees: [{ name: "Jane Doe", role: "attendee" }],
      recordingIdHash: "provider-recording-hash",
      providerSourceId: "ff-transcript-1",
      ingestSource: "fireflies",
    };
    const meetingFindOne = jest.fn().mockResolvedValue(existing);
    const meetingUpdateOne = jest.fn().mockResolvedValue({ acknowledged: true });
    const { db, planningSessions } = buildDb({ meetingFindOne, meetingUpdateOne });

    const result = await ingestProviderMeeting({
      db,
      provider: "fireflies",
      userId: "user-1",
      workspaceId: "workspace-1",
      connectionId: "connection-1",
      meeting: buildMeeting(),
    });

    expect(result).toEqual({
      status: "duplicate",
      meetingId: "existing-meeting-1",
    });
    expect(mockedExtractTasks).not.toHaveBeenCalled();
    expect(planningSessions.insertOne).not.toHaveBeenCalled();
    expect(mockedPostMeetingAutomationToSlack).not.toHaveBeenCalled();
    expect(mockedRunMeetingIngestionCommand).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        eventType: "meeting.updated",
        payload: expect.objectContaining({
          meetingId: "existing-meeting-1",
          extractedTasks: existing.extractedTasks,
        }),
      })
    );
  });

  it("returns no_transcript without extraction when the transcript is empty", async () => {
    const { db, meetings } = buildDb();

    const result = await ingestProviderMeeting({
      db,
      provider: "fireflies",
      userId: "user-1",
      workspaceId: "workspace-1",
      connectionId: "connection-1",
      meeting: buildMeeting({ transcript: "   " }),
    });

    expect(result).toEqual({ status: "no_transcript" });
    expect(mockedExtractTasks).not.toHaveBeenCalled();
    expect(meetings.updateOne).not.toHaveBeenCalled();
    expect(mockedRunMeetingIngestionCommand).not.toHaveBeenCalled();
  });

  it("resolves the canonical meeting id when the upsert loses a race", async () => {
    const meetingFindOne = jest
      .fn()
      .mockResolvedValueOnce(null) // dedupe lookup
      .mockResolvedValueOnce({ _id: "canonical-meeting-1" }); // race resolution
    const meetingUpdateOne = jest.fn().mockRejectedValue(
      Object.assign(new Error("E11000 duplicate key error"), { code: 11000 })
    );
    const { db, planningSessions } = buildDb({ meetingFindOne, meetingUpdateOne });

    const result = await ingestProviderMeeting({
      db,
      provider: "fireflies",
      userId: "user-1",
      workspaceId: "workspace-1",
      connectionId: "connection-1",
      meeting: buildMeeting(),
    });

    expect(result).toEqual({
      status: "duplicate",
      meetingId: "canonical-meeting-1",
    });
    expect(planningSessions.insertOne).not.toHaveBeenCalled();
    expect(mockedRunMeetingIngestionCommand).not.toHaveBeenCalled();
    expect(mockedPostMeetingAutomationToSlack).not.toHaveBeenCalled();
  });

  it("formats transcript segments into M:SS - Speaker: text lines", () => {
    expect(
      formatProviderTranscriptSegments([
        { speaker: "Jane", text: "Hello", offsetSeconds: 61 },
        { speaker: null, text: "Hi there", offsetSeconds: 65 },
        { speaker: "Bob", text: "  ", offsetSeconds: 70 },
        { speaker: "Ann", text: "No offset" },
      ])
    ).toBe("1:01 - Jane: Hello\n1:05 - Speaker: Hi there\nAnn: No offset");
  });
});

describe("upsertMeetingIdempotently", () => {
  it("inserts and returns the upserted id", async () => {
    const meetingsCollection = {
      updateOne: jest
        .fn()
        .mockResolvedValue({ acknowledged: true, upsertedId: "meeting-1" }),
      findOne: jest.fn(),
      insertOne: jest.fn(),
    };
    const result = await upsertMeetingIdempotently({
      meetingsCollection,
      filter: { userId: "user-1" },
      meeting: { _id: "meeting-1", createdAt: new Date(), title: "T" },
    });
    expect(result).toEqual({
      insertedMeeting: true,
      canonicalMeetingId: "meeting-1",
    });
    const [, update] = meetingsCollection.updateOne.mock.calls[0];
    expect(update.$set._id).toBeUndefined();
    expect(update.$set.createdAt).toBeUndefined();
    expect(update.$setOnInsert._id).toBe("meeting-1");
  });

  it("resolves the existing id on duplicate-key races", async () => {
    const meetingsCollection = {
      updateOne: jest.fn().mockRejectedValue({ code: 11000 }),
      findOne: jest.fn().mockResolvedValue({ _id: "existing-1" }),
      insertOne: jest.fn(),
    };
    const result = await upsertMeetingIdempotently({
      meetingsCollection,
      filter: { userId: "user-1" },
      meeting: { _id: "meeting-2", createdAt: new Date() },
    });
    expect(result).toEqual({
      insertedMeeting: false,
      canonicalMeetingId: "existing-1",
    });
    expect(meetingsCollection.insertOne).not.toHaveBeenCalled();
  });
});
