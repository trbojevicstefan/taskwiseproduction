import { runMeetingProviderSyncJob } from "@/lib/jobs/handlers/meeting-provider-sync-job";
import { getDb } from "@/lib/db";
import { findMeetingConnectionById } from "@/lib/meeting-connections";
import { getMeetingProviderAdapter } from "@/lib/meeting-providers";
import { ingestProviderMeeting } from "@/lib/meeting-providers/ingest-pipeline";

jest.mock("@/lib/db", () => ({
  getDb: jest.fn(),
}));

jest.mock("@/lib/meeting-connections", () => ({
  findMeetingConnectionById: jest.fn(),
}));

jest.mock("@/lib/meeting-providers", () => ({
  getMeetingProviderAdapter: jest.fn(),
}));

jest.mock("@/lib/meeting-providers/ingest-pipeline", () => ({
  ingestProviderMeeting: jest.fn(),
}));

const mockedGetDb = getDb as jest.MockedFunction<typeof getDb>;
const mockedFindConnectionById = findMeetingConnectionById as jest.MockedFunction<
  typeof findMeetingConnectionById
>;
const mockedGetAdapter = getMeetingProviderAdapter as jest.MockedFunction<
  typeof getMeetingProviderAdapter
>;
const mockedIngestProviderMeeting = ingestProviderMeeting as jest.MockedFunction<
  typeof ingestProviderMeeting
>;

const buildMeeting = (externalId: string) => ({
  externalId,
  title: `Meeting ${externalId}`,
  startTime: null,
  endTime: null,
  durationSeconds: null,
  recordingUrl: null,
  shareUrl: null,
  organizerEmail: null,
  participants: [],
  transcript: "0:01 - Jane: Hello",
});

const buildAdapter = (overrides: Record<string, any> = {}) => ({
  provider: "grain",
  displayName: "Grain",
  verifyWebhookRequest: jest.fn(),
  parseWebhookPayload: jest.fn(),
  listMeetings: jest.fn().mockResolvedValue(["ext-1", "ext-2", "ext-3"]),
  fetchMeeting: jest.fn((_connection: any, externalId: string) =>
    Promise.resolve(buildMeeting(externalId))
  ),
  validateCredentials: jest.fn(),
  ...overrides,
});

const buildConnection = (overrides: Record<string, any> = {}) => ({
  _id: "connection-1",
  workspaceId: "workspace-1",
  userId: "user-1",
  provider: "grain",
  status: "active",
  ...overrides,
});

describe("runMeetingProviderSyncJob", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetDb.mockResolvedValue({} as any);
    mockedFindConnectionById.mockResolvedValue(buildConnection() as any);
    mockedIngestProviderMeeting
      .mockResolvedValueOnce({ status: "created", meetingId: "meeting-1" })
      .mockResolvedValueOnce({ status: "duplicate", meetingId: "meeting-1" })
      .mockResolvedValueOnce({ status: "no_transcript" });
  });

  it("throws for unknown providers", async () => {
    mockedGetAdapter.mockReturnValue(null);

    await expect(
      runMeetingProviderSyncJob({
        userId: "user-1",
        provider: "otter",
        connectionId: "connection-1",
      })
    ).rejects.toThrow("Unknown meeting provider: otter");
  });

  it("throws when the connection is not active", async () => {
    mockedGetAdapter.mockReturnValue(buildAdapter() as any);
    mockedFindConnectionById.mockResolvedValue(
      buildConnection({ status: "revoked" }) as any
    );

    await expect(
      runMeetingProviderSyncJob({
        userId: "user-1",
        provider: "grain",
        connectionId: "connection-1",
      })
    ).rejects.toThrow("Connection is not active.");
  });

  it("lists, fetches and ingests meetings, counting outcomes", async () => {
    const adapter = buildAdapter();
    mockedGetAdapter.mockReturnValue(adapter as any);

    const result = await runMeetingProviderSyncJob({
      userId: "user-1",
      provider: "grain",
      connectionId: "connection-1",
      since: "2026-07-01T00:00:00.000Z",
    });

    expect(adapter.listMeetings).toHaveBeenCalledWith(
      expect.objectContaining({ _id: "connection-1" }),
      expect.objectContaining({
        since: new Date("2026-07-01T00:00:00.000Z"),
        limit: expect.any(Number),
      })
    );
    expect(adapter.fetchMeeting).toHaveBeenCalledTimes(3);
    expect(mockedIngestProviderMeeting).toHaveBeenCalledTimes(3);
    expect(result).toEqual({
      listed: 3,
      created: 1,
      duplicates: 1,
      noTranscript: 1,
      failed: 0,
    });
  });

  it("counts fetch failures without aborting the sweep", async () => {
    const adapter = buildAdapter({
      listMeetings: jest.fn().mockResolvedValue(["ext-1", "ext-2"]),
      fetchMeeting: jest
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(buildMeeting("ext-2")),
    });
    mockedGetAdapter.mockReturnValue(adapter as any);
    mockedIngestProviderMeeting.mockReset();
    mockedIngestProviderMeeting.mockResolvedValue({
      status: "created",
      meetingId: "meeting-2",
    });

    const result = await runMeetingProviderSyncJob({
      userId: "user-1",
      provider: "grain",
      connectionId: "connection-1",
    });

    expect(result).toEqual({
      listed: 2,
      created: 1,
      duplicates: 0,
      noTranscript: 0,
      failed: 1,
    });
  });
});
