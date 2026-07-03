import { POST } from "@/app/api/integrations/[provider]/sync/route";
import { getDb } from "@/lib/db";
import { enqueueJob } from "@/lib/jobs/store";
import { kickJobWorker } from "@/lib/jobs/worker";
import { findMeetingConnectionForWorkspace } from "@/lib/meeting-connections";
import { getMeetingProviderAdapter } from "@/lib/meeting-providers";
import { getSessionUserId } from "@/lib/server-auth";
import { resolveWorkspaceScopeForUser } from "@/lib/workspace-scope";

jest.mock("@/lib/db", () => ({
  getDb: jest.fn(),
}));

jest.mock("@/lib/server-auth", () => ({
  getSessionUserId: jest.fn(),
}));

jest.mock("@/lib/workspace-scope", () => ({
  resolveWorkspaceScopeForUser: jest.fn(),
}));

jest.mock("@/lib/meeting-connections", () => ({
  findMeetingConnectionForWorkspace: jest.fn(),
}));

jest.mock("@/lib/meeting-providers", () => ({
  getMeetingProviderAdapter: jest.fn(),
}));

jest.mock("@/lib/jobs/store", () => ({
  enqueueJob: jest.fn(),
}));

jest.mock("@/lib/jobs/worker", () => ({
  kickJobWorker: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/lib/observability-metrics", () => ({
  recordRouteMetric: jest.fn(),
}));

const mockedGetDb = getDb as jest.MockedFunction<typeof getDb>;
const mockedGetSessionUserId = getSessionUserId as jest.MockedFunction<
  typeof getSessionUserId
>;
const mockedResolveWorkspaceScopeForUser =
  resolveWorkspaceScopeForUser as jest.MockedFunction<
    typeof resolveWorkspaceScopeForUser
  >;
const mockedFindConnection =
  findMeetingConnectionForWorkspace as jest.MockedFunction<
    typeof findMeetingConnectionForWorkspace
  >;
const mockedGetAdapter = getMeetingProviderAdapter as jest.MockedFunction<
  typeof getMeetingProviderAdapter
>;
const mockedEnqueueJob = enqueueJob as jest.MockedFunction<typeof enqueueJob>;
const mockedKickJobWorker = kickJobWorker as jest.MockedFunction<
  typeof kickJobWorker
>;

const buildRequest = (provider: string, body: unknown = {}) =>
  new Request(`http://localhost/api/integrations/${provider}/sync`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const params = (provider: string) => ({ params: Promise.resolve({ provider }) });

describe("POST /api/integrations/[provider]/sync", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetDb.mockResolvedValue({} as any);
    mockedGetSessionUserId.mockResolvedValue("user-1");
    mockedResolveWorkspaceScopeForUser.mockResolvedValue({
      workspaceId: "workspace-1",
      workspace: null as any,
      membership: null as any,
      workspaceMemberUserIds: ["user-1"],
    } as any);
    mockedGetAdapter.mockReturnValue({
      provider: "fireflies",
      displayName: "Fireflies.ai",
    } as any);
    mockedFindConnection.mockResolvedValue({
      _id: "connection-1",
      provider: "fireflies",
      status: "active",
    } as any);
    mockedEnqueueJob.mockResolvedValue({ _id: "job-1" } as any);
  });

  it("returns 404 for unknown providers and fathom", async () => {
    mockedGetAdapter.mockReturnValueOnce(null);
    const unknown = await POST(buildRequest("otter"), params("otter"));
    expect(unknown.status).toBe(404);

    mockedGetAdapter.mockReturnValueOnce({
      provider: "fathom",
      legacyWebhook: true,
    } as any);
    const fathom = await POST(buildRequest("fathom"), params("fathom"));
    expect(fathom.status).toBe(404);

    expect(mockedEnqueueJob).not.toHaveBeenCalled();
  });

  it("returns 401 without a session user", async () => {
    mockedGetSessionUserId.mockResolvedValue(null as any);

    const response = await POST(buildRequest("fireflies"), params("fireflies"));

    expect(response.status).toBe(401);
    expect(mockedEnqueueJob).not.toHaveBeenCalled();
  });

  it("returns 404 when no active connection exists", async () => {
    mockedFindConnection.mockResolvedValue(null as any);

    const response = await POST(buildRequest("fireflies"), params("fireflies"));

    expect(response.status).toBe(404);
    expect(mockedEnqueueJob).not.toHaveBeenCalled();
  });

  it("returns 404 when the connection is revoked", async () => {
    mockedFindConnection.mockResolvedValue({
      _id: "connection-1",
      provider: "fireflies",
      status: "revoked",
    } as any);

    const response = await POST(buildRequest("fireflies"), params("fireflies"));

    expect(response.status).toBe(404);
    expect(mockedEnqueueJob).not.toHaveBeenCalled();
  });

  it("enqueues the sync job and answers 202", async () => {
    const response = await POST(
      buildRequest("fireflies", { since: "2026-07-01T00:00:00.000Z" }),
      params("fireflies")
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      status: "accepted",
      provider: "fireflies",
      jobId: "job-1",
    });
    expect(mockedEnqueueJob).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: "meeting-provider-sync",
        userId: "user-1",
        payload: {
          provider: "fireflies",
          connectionId: "connection-1",
          since: "2026-07-01T00:00:00.000Z",
        },
      })
    );
    expect(mockedKickJobWorker).toHaveBeenCalled();
  });
});
