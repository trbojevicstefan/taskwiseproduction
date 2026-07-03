import { runMeetingProviderWebhookIngestJob } from "@/lib/jobs/handlers/meeting-provider-webhook-ingest-job";
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

const normalizedMeeting = {
  externalId: "ext-1",
  title: "Weekly Sync",
  startTime: null,
  endTime: null,
  durationSeconds: null,
  recordingUrl: null,
  shareUrl: null,
  organizerEmail: null,
  participants: [],
  transcript: "0:01 - Jane: Hello",
};

const buildAdapter = (overrides: Record<string, any> = {}) => ({
  provider: "fireflies",
  displayName: "Fireflies.ai",
  verifyWebhookRequest: jest.fn(),
  parseWebhookPayload: jest
    .fn()
    .mockReturnValue({ kind: "ref", externalMeetingId: "ext-1" }),
  fetchMeeting: jest.fn().mockResolvedValue(normalizedMeeting),
  validateCredentials: jest.fn(),
  ...overrides,
});

const buildConnection = (overrides: Record<string, any> = {}) => ({
  _id: "connection-1",
  workspaceId: "workspace-1",
  userId: "user-1",
  provider: "fireflies",
  status: "active",
  ...overrides,
});

describe("runMeetingProviderWebhookIngestJob", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetDb.mockResolvedValue({} as any);
    mockedFindConnectionById.mockResolvedValue(buildConnection() as any);
    mockedIngestProviderMeeting.mockResolvedValue({
      status: "created",
      meetingId: "meeting-1",
    });
  });

  it("throws for unknown providers", async () => {
    mockedGetAdapter.mockReturnValue(null);

    await expect(
      runMeetingProviderWebhookIngestJob({
        userId: "user-1",
        provider: "otter",
        connectionId: "connection-1",
        payload: {},
      })
    ).rejects.toThrow("Unknown meeting provider: otter");
  });

  it("throws when the connection is missing or belongs to another provider", async () => {
    mockedGetAdapter.mockReturnValue(buildAdapter() as any);
    mockedFindConnectionById.mockResolvedValue(
      buildConnection({ provider: "grain" }) as any
    );

    await expect(
      runMeetingProviderWebhookIngestJob({
        userId: "user-1",
        provider: "fireflies",
        connectionId: "connection-1",
        payload: {},
      })
    ).rejects.toThrow("Meeting provider connection not found.");
  });

  it("skips inactive connections", async () => {
    mockedGetAdapter.mockReturnValue(buildAdapter() as any);
    mockedFindConnectionById.mockResolvedValue(
      buildConnection({ status: "revoked" }) as any
    );

    const result = await runMeetingProviderWebhookIngestJob({
      userId: "user-1",
      provider: "fireflies",
      connectionId: "connection-1",
      payload: {},
    });

    expect(result).toEqual({ status: "ignored", reason: "connection_inactive" });
    expect(mockedIngestProviderMeeting).not.toHaveBeenCalled();
  });

  it("returns ignored when the adapter classifies the payload as irrelevant", async () => {
    const adapter = buildAdapter({
      parseWebhookPayload: jest
        .fn()
        .mockReturnValue({ kind: "ignore", reason: "ping" }),
    });
    mockedGetAdapter.mockReturnValue(adapter as any);

    const result = await runMeetingProviderWebhookIngestJob({
      userId: "user-1",
      provider: "fireflies",
      connectionId: "connection-1",
      payload: { type: "ping" },
    });

    expect(result).toEqual({ status: "ignored", reason: "ping" });
    expect(mockedIngestProviderMeeting).not.toHaveBeenCalled();
  });

  it("fetches referenced meetings and runs the shared pipeline", async () => {
    const adapter = buildAdapter();
    mockedGetAdapter.mockReturnValue(adapter as any);

    const result = await runMeetingProviderWebhookIngestJob({
      userId: "user-1",
      provider: "fireflies",
      connectionId: "connection-1",
      payload: { event: "transcript_ready", id: "ext-1" },
    });

    expect(adapter.parseWebhookPayload).toHaveBeenCalledWith({
      event: "transcript_ready",
      id: "ext-1",
    });
    expect(adapter.fetchMeeting).toHaveBeenCalledWith(
      expect.objectContaining({ _id: "connection-1" }),
      "ext-1"
    );
    expect(mockedIngestProviderMeeting).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "fireflies",
        userId: "user-1",
        workspaceId: "workspace-1",
        connectionId: "connection-1",
        meeting: normalizedMeeting,
      })
    );
    expect(result).toEqual({ status: "created", meetingId: "meeting-1" });
  });

  it("ingests inline meeting payloads without fetching", async () => {
    const adapter = buildAdapter({
      parseWebhookPayload: jest
        .fn()
        .mockReturnValue({ kind: "meeting", meeting: normalizedMeeting }),
    });
    mockedGetAdapter.mockReturnValue(adapter as any);

    const result = await runMeetingProviderWebhookIngestJob({
      userId: "user-1",
      provider: "fireflies",
      connectionId: "connection-1",
      payload: { transcript: "..." },
    });

    expect(adapter.fetchMeeting).not.toHaveBeenCalled();
    expect(result).toEqual({ status: "created", meetingId: "meeting-1" });
  });

  it("returns not_found when a referenced meeting cannot be fetched", async () => {
    const adapter = buildAdapter({
      fetchMeeting: jest.fn().mockResolvedValue(null),
    });
    mockedGetAdapter.mockReturnValue(adapter as any);

    const result = await runMeetingProviderWebhookIngestJob({
      userId: "user-1",
      provider: "fireflies",
      connectionId: "connection-1",
      payload: {},
    });

    expect(result).toEqual({ status: "not_found", externalMeetingId: "ext-1" });
    expect(mockedIngestProviderMeeting).not.toHaveBeenCalled();
  });
});
