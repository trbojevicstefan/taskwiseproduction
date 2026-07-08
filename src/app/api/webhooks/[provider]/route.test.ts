import { POST } from "@/app/api/webhooks/[provider]/route";
import { getDb } from "@/lib/db";
import { enqueueJob } from "@/lib/jobs/store";
import { kickJobWorker } from "@/lib/jobs/worker";
import {
  findMeetingConnectionByWebhookToken,
  listActiveMeetingConnectionsForProvider,
} from "@/lib/meeting-connections";
import { getMeetingProviderAdapter } from "@/lib/meeting-providers";

jest.mock("@/lib/db", () => ({
  getDb: jest.fn(),
}));

jest.mock("@/lib/jobs/store", () => ({
  enqueueJob: jest.fn(),
}));

jest.mock("@/lib/jobs/worker", () => ({
  kickJobWorker: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/lib/meeting-connections", () => ({
  findMeetingConnectionByWebhookToken: jest.fn(),
  listActiveMeetingConnectionsForProvider: jest.fn(),
}));

jest.mock("@/lib/meeting-providers", () => {
  const actual = jest.requireActual("@/lib/meeting-providers/types");
  return {
    getMeetingProviderAdapter: jest.fn(),
    ProviderNotImplementedError: actual.ProviderNotImplementedError,
  };
});

const mockedGetDb = getDb as jest.MockedFunction<typeof getDb>;
const mockedEnqueueJob = enqueueJob as jest.MockedFunction<typeof enqueueJob>;
const mockedKickJobWorker = kickJobWorker as jest.MockedFunction<typeof kickJobWorker>;
const mockedFindByToken = findMeetingConnectionByWebhookToken as jest.MockedFunction<
  typeof findMeetingConnectionByWebhookToken
>;
const mockedListActive =
  listActiveMeetingConnectionsForProvider as jest.MockedFunction<
    typeof listActiveMeetingConnectionsForProvider
  >;
const mockedGetAdapter = getMeetingProviderAdapter as jest.MockedFunction<
  typeof getMeetingProviderAdapter
>;

const buildAdapter = (overrides: Record<string, any> = {}) => ({
  provider: "fireflies",
  displayName: "Fireflies.ai",
  verifyWebhookRequest: jest.fn().mockReturnValue(true),
  parseWebhookPayload: jest
    .fn()
    .mockReturnValue({ kind: "ref", externalMeetingId: "ext-1" }),
  validateCredentials: jest.fn(),
  ...overrides,
});

const buildConnection = (overrides: Record<string, any> = {}) => ({
  _id: "connection-1",
  workspaceId: "workspace-1",
  userId: "user-1",
  provider: "fireflies",
  status: "active",
  apiKey: "key",
  accountName: null,
  webhookSecret: "secret",
  webhookToken: "hook-token",
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const buildRequest = (
  provider: string,
  { token = "hook-token", body = { event: "x" } }: { token?: string | null; body?: unknown } = {}
) =>
  new Request(
    `http://localhost/api/webhooks/${provider}${token ? `?token=${token}` : ""}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }
  );

const callRoute = (provider: string, request: Request) =>
  POST(request, { params: Promise.resolve({ provider }) });

describe("POST /api/webhooks/[provider]", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetDb.mockResolvedValue({} as any);
    mockedFindByToken.mockResolvedValue(buildConnection() as any);
    mockedListActive.mockResolvedValue([buildConnection()] as any);
    mockedEnqueueJob.mockResolvedValue({ _id: "job-1" } as any);
  });

  it("returns 404 for unknown providers", async () => {
    mockedGetAdapter.mockReturnValue(null);

    const response = await callRoute("otter", buildRequest("otter"));

    expect(response.status).toBe(404);
    expect(mockedEnqueueJob).not.toHaveBeenCalled();
  });

  it("returns 404 for fathom (legacy webhook provider)", async () => {
    mockedGetAdapter.mockReturnValue(
      buildAdapter({ provider: "fathom", legacyWebhook: true }) as any
    );

    const response = await callRoute("fathom", buildRequest("fathom"));

    expect(response.status).toBe(404);
    expect(mockedEnqueueJob).not.toHaveBeenCalled();
  });

  it("returns 404 when the webhook token matches no active connection", async () => {
    mockedGetAdapter.mockReturnValue(buildAdapter() as any);
    mockedFindByToken.mockResolvedValue(null as any);

    const response = await callRoute("fireflies", buildRequest("fireflies"));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "Unknown webhook token.",
    });
    expect(mockedEnqueueJob).not.toHaveBeenCalled();
  });

  it("returns 401 when the adapter rejects the signature", async () => {
    const adapter = buildAdapter({
      verifyWebhookRequest: jest.fn().mockResolvedValue(false),
    });
    mockedGetAdapter.mockReturnValue(adapter as any);

    const response = await callRoute("fireflies", buildRequest("fireflies"));

    expect(response.status).toBe(401);
    expect(adapter.verifyWebhookRequest).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Headers),
      "secret"
    );
    expect(mockedEnqueueJob).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid JSON bodies", async () => {
    mockedGetAdapter.mockReturnValue(buildAdapter() as any);

    const response = await callRoute(
      "fireflies",
      buildRequest("fireflies", { body: "not-json{" })
    );

    expect(response.status).toBe(400);
    expect(mockedEnqueueJob).not.toHaveBeenCalled();
  });

  it("returns 200 ignored when the adapter classifies the event as irrelevant", async () => {
    const adapter = buildAdapter({
      parseWebhookPayload: jest
        .fn()
        .mockReturnValue({ kind: "ignore", reason: "unsupported_event" }),
    });
    mockedGetAdapter.mockReturnValue(adapter as any);

    const response = await callRoute("fireflies", buildRequest("fireflies"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ignored",
      reason: "unsupported_event",
    });
    expect(mockedEnqueueJob).not.toHaveBeenCalled();
  });

  it("enqueues the ingest job and answers 202 on the happy path", async () => {
    const adapter = buildAdapter();
    mockedGetAdapter.mockReturnValue(adapter as any);

    const response = await callRoute(
      "fireflies",
      buildRequest("fireflies", { body: { event: "transcript_ready", id: "ext-1" } })
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      status: "accepted",
      jobId: "job-1",
    });
    expect(mockedEnqueueJob).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: "meeting-provider-webhook-ingest",
        userId: "user-1",
        payload: {
          provider: "fireflies",
          connectionId: "connection-1",
          payload: { event: "transcript_ready", id: "ext-1" },
        },
      })
    );
    expect(mockedKickJobWorker).toHaveBeenCalled();
  });

  it("falls back to the single active connection when no token is supplied", async () => {
    const adapter = buildAdapter();
    mockedGetAdapter.mockReturnValue(adapter as any);

    const response = await callRoute(
      "fireflies",
      buildRequest("fireflies", { token: null })
    );

    expect(response.status).toBe(202);
    expect(mockedFindByToken).not.toHaveBeenCalled();
    expect(mockedListActive).toHaveBeenCalledWith(expect.anything(), "fireflies");
  });

  it("returns 404 when no token is supplied and multiple active connections exist", async () => {
    const adapter = buildAdapter();
    mockedGetAdapter.mockReturnValue(adapter as any);
    mockedListActive.mockResolvedValue([
      buildConnection(),
      buildConnection({ _id: "connection-2" }),
    ] as any);

    const response = await callRoute(
      "fireflies",
      buildRequest("fireflies", { token: null })
    );

    expect(response.status).toBe(404);
    expect(mockedEnqueueJob).not.toHaveBeenCalled();
  });

  it("returns 501 when the adapter is not implemented yet", async () => {
    const { ProviderNotImplementedError } = jest.requireActual(
      "@/lib/meeting-providers/types"
    );
    const adapter = buildAdapter({
      verifyWebhookRequest: jest.fn(() => {
        throw new ProviderNotImplementedError("fireflies", "verifyWebhookRequest");
      }),
    });
    mockedGetAdapter.mockReturnValue(adapter as any);

    const response = await callRoute("fireflies", buildRequest("fireflies"));

    expect(response.status).toBe(501);
    expect(mockedEnqueueJob).not.toHaveBeenCalled();
  });
});
