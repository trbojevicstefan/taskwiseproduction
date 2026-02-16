import crypto from "crypto";
import { POST } from "@/app/api/fathom/webhook/route";
import { getFathomInstallation, getValidFathomAccessToken, hashFathomRecordingId } from "@/lib/fathom";
import { ingestFathomMeeting } from "@/lib/fathom-ingest";
import { findUserByFathomWebhookToken } from "@/lib/db/users";
import { logFathomIntegration } from "@/lib/fathom-logs";
import { getDb } from "@/lib/db";
import { enqueueJob } from "@/lib/jobs/store";
import { kickJobWorker } from "@/lib/jobs/worker";

jest.mock("@/lib/fathom", () => ({
  getFathomInstallation: jest.fn(),
  getValidFathomAccessToken: jest.fn(),
  hashFathomRecordingId: jest.fn(),
}));

jest.mock("@/lib/fathom-ingest", () => ({
  ingestFathomMeeting: jest.fn(),
}));

jest.mock("@/lib/db/users", () => ({
  findUserByFathomWebhookToken: jest.fn(),
}));

jest.mock("@/lib/fathom-logs", () => ({
  logFathomIntegration: jest.fn(),
}));

jest.mock("@/lib/db", () => ({
  getDb: jest.fn(),
}));

jest.mock("@/lib/jobs/store", () => ({
  enqueueJob: jest.fn(),
}));

jest.mock("@/lib/jobs/worker", () => ({
  kickJobWorker: jest.fn(),
}));

const mockedGetFathomInstallation = getFathomInstallation as jest.MockedFunction<
  typeof getFathomInstallation
>;
const mockedGetValidFathomAccessToken =
  getValidFathomAccessToken as jest.MockedFunction<typeof getValidFathomAccessToken>;
const mockedHashFathomRecordingId = hashFathomRecordingId as jest.MockedFunction<
  typeof hashFathomRecordingId
>;
const mockedIngestFathomMeeting = ingestFathomMeeting as jest.MockedFunction<
  typeof ingestFathomMeeting
>;
const mockedFindUserByFathomWebhookToken =
  findUserByFathomWebhookToken as jest.MockedFunction<typeof findUserByFathomWebhookToken>;
const mockedLogFathomIntegration = logFathomIntegration as jest.MockedFunction<
  typeof logFathomIntegration
>;
const mockedGetDb = getDb as jest.MockedFunction<typeof getDb>;
const mockedEnqueueJob = enqueueJob as jest.MockedFunction<typeof enqueueJob>;
const mockedKickJobWorker = kickJobWorker as jest.MockedFunction<typeof kickJobWorker>;

const rawSecret = Buffer.from("test-webhook-secret");
const webhookSecret = `whsec_${rawSecret.toString("base64url")}`;

const buildWebhookRequest = ({
  payload,
  signature,
  timestamp,
}: {
  payload: Record<string, unknown>;
  signature: string;
  timestamp: string;
}) => {
  const rawBody = JSON.stringify(payload);
  return {
    rawBody,
    request: new Request("http://localhost/api/fathom/webhook?token=test-token", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "webhook-signature": `v1,${signature}`,
        "webhook-id": "evt_123",
        "webhook-timestamp": timestamp,
      },
      body: rawBody,
    }),
  };
};

const buildSignature = (rawBody: string, timestamp: string) =>
  crypto
    .createHmac("sha256", rawSecret)
    .update(`evt_123.${timestamp}.${rawBody}`, "utf8")
    .digest("base64");

describe("POST /api/fathom/webhook", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.CORE_FIRST_QUEUE_FIRST_WEBHOOK_INGESTION;
    mockedFindUserByFathomWebhookToken.mockResolvedValue({
      _id: { toString: () => "user-1" },
    } as any);
    mockedGetFathomInstallation.mockResolvedValue({
      webhookSecret,
    } as any);
    mockedGetValidFathomAccessToken.mockResolvedValue("access-token");
    mockedHashFathomRecordingId.mockReturnValue("recording-hash");
    mockedLogFathomIntegration.mockResolvedValue(undefined as never);
    mockedGetDb.mockResolvedValue({} as any);
    mockedEnqueueJob.mockResolvedValue({
      _id: "job-1",
      status: "queued",
      type: "fathom-webhook-ingest",
    } as any);
    mockedKickJobWorker.mockResolvedValue(undefined as never);
  });

  it("rejects invalid webhook signatures", async () => {
    const timestamp = String(Date.now());
    const payload = {
      event: "new-meeting-content-ready",
      data: { recording_id: "rec-123" },
    };
    const { request } = buildWebhookRequest({
      payload,
      signature: "invalid-signature",
      timestamp,
    });

    const response = await POST(request);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      errorCode: "request_error",
      error: "Invalid webhook signature.",
    });
    expect(mockedIngestFathomMeeting).not.toHaveBeenCalled();
  });

  it("returns duplicate status for idempotent repeated meeting ingests", async () => {
    const timestamp = String(Date.now());
    const payload = {
      event: "new_meeting_content_ready",
      data: { recording_id: "rec-123" },
    };
    const { rawBody, request } = buildWebhookRequest({
      payload,
      signature: buildSignature(JSON.stringify(payload), timestamp),
      timestamp,
    });

    // Prevent accidental drift between signed payload and body used in request.
    expect(rawBody).toBe(JSON.stringify(payload));

    mockedIngestFathomMeeting.mockResolvedValue({
      status: "duplicate",
      meetingId: "meeting-1",
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "duplicate",
      meetingId: "meeting-1",
    });
    expect(mockedGetValidFathomAccessToken).toHaveBeenCalledWith("user-1");
    expect(mockedIngestFathomMeeting).toHaveBeenCalledWith(
      expect.objectContaining({
        recordingId: "rec-123",
        accessToken: "access-token",
      })
    );
  });

  it("queues webhook ingest and returns accepted when queue-first flag is enabled", async () => {
    process.env.CORE_FIRST_QUEUE_FIRST_WEBHOOK_INGESTION = "1";
    const timestamp = String(Date.now());
    const payload = {
      event: "new-meeting-content-ready",
      data: { recording_id: "rec-789" },
    };
    const { request } = buildWebhookRequest({
      payload,
      signature: buildSignature(JSON.stringify(payload), timestamp),
      timestamp,
    });

    const response = await POST(request);

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      status: "accepted",
      jobId: "job-1",
    });
    expect(mockedGetValidFathomAccessToken).not.toHaveBeenCalled();
    expect(mockedIngestFathomMeeting).not.toHaveBeenCalled();
    expect(mockedGetDb).toHaveBeenCalled();
    expect(mockedEnqueueJob).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: "fathom-webhook-ingest",
        userId: "user-1",
        payload: expect.objectContaining({
          recordingId: "rec-789",
        }),
      })
    );
    expect(mockedKickJobWorker).toHaveBeenCalled();
  });
});
