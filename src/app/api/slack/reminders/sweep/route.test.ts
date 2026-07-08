import { POST } from "@/app/api/slack/reminders/sweep/route";
import { getDb } from "@/lib/db";
import { kickJobWorker } from "@/lib/jobs/worker";
import { getSessionUserId } from "@/lib/server-auth";
import {
  enqueueReminderSweepJob,
  runReminderSweep,
} from "@/lib/task-reminders";
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

jest.mock("@/lib/task-reminders", () => ({
  runReminderSweep: jest.fn(),
  enqueueReminderSweepJob: jest.fn(),
  REMINDER_SWEEP_INTERVAL_MS: 6 * 60 * 60 * 1000,
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
const mockedRunReminderSweep = runReminderSweep as jest.MockedFunction<
  typeof runReminderSweep
>;
const mockedEnqueueReminderSweepJob =
  enqueueReminderSweepJob as jest.MockedFunction<typeof enqueueReminderSweepJob>;
const mockedKickJobWorker = kickJobWorker as jest.MockedFunction<
  typeof kickJobWorker
>;

const buildRequest = () =>
  new Request("http://localhost/api/slack/reminders/sweep", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });

describe("POST /api/slack/reminders/sweep", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetSessionUserId.mockResolvedValue("user-1");
    mockedResolveWorkspaceScopeForUser.mockResolvedValue({
      workspaceId: "workspace-1",
      workspace: null as any,
      membership: null as any,
      workspaceMemberUserIds: ["user-1"],
    } as any);
  });

  it("returns 401 when there is no session user", async () => {
    mockedGetSessionUserId.mockResolvedValue(null as any);

    const response = await POST(buildRequest());

    expect(response.status).toBe(401);
    expect(mockedRunReminderSweep).not.toHaveBeenCalled();
    expect(mockedEnqueueReminderSweepJob).not.toHaveBeenCalled();
  });

  it("runs the sweep and refreshes the self-perpetuating sweep job when enabled", async () => {
    const db = { collection: jest.fn() } as any;
    mockedGetDb.mockResolvedValue(db);
    mockedRunReminderSweep.mockResolvedValue({
      enrolled: 4,
      canceledStale: 2,
      skipped: 1,
      enabled: true,
      digestSent: false,
    });
    mockedEnqueueReminderSweepJob.mockResolvedValue({
      enqueued: true,
      jobId: "job-1",
    });

    const response = await POST(buildRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      enrolled: 4,
      canceledStale: 2,
      skipped: 1,
      enabled: true,
      digestSent: false,
    });

    expect(mockedRunReminderSweep).toHaveBeenCalledTimes(1);
    expect(mockedRunReminderSweep).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        workspaceId: "workspace-1",
        userId: "user-1",
      })
    );
    expect(mockedEnqueueReminderSweepJob).toHaveBeenCalledTimes(1);
    expect(mockedEnqueueReminderSweepJob).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        workspaceId: "workspace-1",
        userId: "user-1",
        runAt: expect.any(Date),
      })
    );
    // Next sweep lands ~6h out.
    const runAt = mockedEnqueueReminderSweepJob.mock.calls[0][1].runAt as Date;
    expect(runAt.getTime()).toBeGreaterThan(Date.now() + 5 * 60 * 60 * 1000);
    expect(mockedKickJobWorker).toHaveBeenCalledTimes(1);
  });

  it("does not enqueue the next sweep when reminders are disabled", async () => {
    const db = { collection: jest.fn() } as any;
    mockedGetDb.mockResolvedValue(db);
    mockedRunReminderSweep.mockResolvedValue({
      enrolled: 0,
      canceledStale: 0,
      skipped: 0,
      enabled: false,
      digestSent: false,
    });

    const response = await POST(buildRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      enrolled: 0,
      canceledStale: 0,
      skipped: 0,
      enabled: false,
    });
    expect(mockedEnqueueReminderSweepJob).not.toHaveBeenCalled();
  });
});
