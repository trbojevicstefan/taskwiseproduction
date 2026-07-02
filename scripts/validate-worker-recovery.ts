import { spawn } from "child_process";
import dotenv from "dotenv";
import { randomUUID } from "crypto";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const totalJobs = Math.max(10, Number(process.env.WORKER_RECOVERY_JOB_COUNT || 300));
const pollIntervalMs = Math.max(10, Number(process.env.WORKER_RECOVERY_POLL_MS || 100));
const firstPhaseTimeoutMs = Math.max(
  1000,
  Number(process.env.WORKER_RECOVERY_FIRST_PHASE_TIMEOUT_MS || 20000)
);
const fullRunTimeoutMs = Math.max(
  10_000,
  Number(process.env.WORKER_RECOVERY_FULL_TIMEOUT_MS || 120000)
);
const workerPollMs = Math.max(10, Number(process.env.WORKER_RECOVERY_WORKER_POLL_MS || 25));
const workerBatch = Math.max(1, Number(process.env.WORKER_RECOVERY_WORKER_BATCH || 25));

type JobCounts = {
  queued: number;
  running: number;
  succeeded: number;
  failed: number;
  total: number;
};

const writeJsonReport = async (report: unknown) => {
  const payload = `${JSON.stringify(report, null, 2)}\n`;
  await new Promise<void>((resolve, reject) => {
    process.stdout.write(payload, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const getWorkerCommand = () =>
  process.platform === "win32"
    ? { command: "cmd.exe", args: ["/c", "npm run jobs:worker"] }
    : { command: "npm", args: ["run", "jobs:worker"] };

const summarizeJobs = async (
  userId: string,
  getDbFn: () => Promise<any>
): Promise<JobCounts> => {
  const db = await getDbFn();
  const rows = await db
    .collection("jobs")
    .aggregate([
      { $match: { userId, type: "domain-event-dispatch" } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ])
    .toArray() as Array<{ _id: string; count: number }>;
  const counts = rows.reduce<Omit<JobCounts, "total">>(
    (acc, row) => {
      const key = String(row._id || "unknown");
      if (key === "queued" || key === "running" || key === "succeeded" || key === "failed") {
        acc[key] = Number(row.count || 0);
      }
      return acc;
    },
    { queued: 0, running: 0, succeeded: 0, failed: 0 } as Omit<JobCounts, "total">
  );

  return {
    ...counts,
    total: counts.queued + counts.running + counts.succeeded + counts.failed,
  };
};

const startWorker = () => {
  const { command, args } = getWorkerCommand();
  const child = spawn(command, args, {
    stdio: "pipe",
    env: {
      ...process.env,
      JOB_WORKER_POLL_MS: String(workerPollMs),
      JOB_WORKER_BATCH: String(workerBatch),
      JOB_WORKER_DISABLE_KICK: "0",
    },
  });
  return child;
};

const stopWorker = async (child: ReturnType<typeof startWorker>) => {
  if (child.killed) return;
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (!child.killed) child.kill("SIGKILL");
      resolve();
    }, 5000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
};

const waitForCondition = async (
  condition: () => Promise<boolean>,
  timeoutMs: number
) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await condition()) return true;
    await sleep(pollIntervalMs);
  }
  return false;
};

const main = async () => {
  const { getDb } = await import("../src/lib/db");
  const { enqueueJob } = await import("../src/lib/jobs/store");
  const clientPromise = (await import("../src/lib/mongodb")).default;
  let appClient: any = null;

  const userId = `worker-recovery-${randomUUID()}`;
  const eventIds: string[] = [];
  const workerLogs: string[] = [];
  const startedAt = Date.now();

  let workerPhase1: ReturnType<typeof startWorker> | null = null;
  let workerPhase2: ReturnType<typeof startWorker> | null = null;

  try {
    appClient = await clientPromise;
    const db = await getDb();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const events = Array.from({ length: totalJobs }).map((_, index) => {
      const eventId = randomUUID();
      eventIds.push(eventId);
      return {
        _id: eventId,
        type: "task.status.changed",
        userId,
        correlationId: `worker-recovery-${index}`,
        payload: {
          taskId: `task-${index}`,
          status: "todo",
        },
        status: "queued",
        createdAt: now,
        updatedAt: now,
        expiresAt,
      };
    });
    await db.collection("domainEvents").insertMany(events);

    for (const eventId of eventIds) {
      await enqueueJob(db as any, {
        type: "domain-event-dispatch",
        userId,
        payload: { eventId },
        maxAttempts: 2,
      });
    }

    const initialCounts = await summarizeJobs(userId, getDb);

    workerPhase1 = startWorker();
    workerPhase1.stdout.on("data", (chunk) => {
      workerLogs.push(String(chunk));
    });
    workerPhase1.stderr.on("data", (chunk) => {
      workerLogs.push(String(chunk));
    });

    const firstPhaseAdvanced = await waitForCondition(async () => {
      const counts = await summarizeJobs(userId, getDb);
      return counts.succeeded > 0;
    }, firstPhaseTimeoutMs);

    if (!firstPhaseAdvanced) {
      throw new Error("Worker did not process any jobs during phase 1.");
    }

    await stopWorker(workerPhase1);

    const countsAfterStop = await summarizeJobs(userId, getDb);
    const interruptedBacklog = countsAfterStop.queued + countsAfterStop.running;

    if (interruptedBacklog <= 0) {
      throw new Error(
        "No queued/running jobs remained after stopping phase 1 worker; interruption test is inconclusive."
      );
    }

    workerPhase2 = startWorker();
    workerPhase2.stdout.on("data", (chunk) => {
      workerLogs.push(String(chunk));
    });
    workerPhase2.stderr.on("data", (chunk) => {
      workerLogs.push(String(chunk));
    });

    const drained = await waitForCondition(async () => {
      const counts = await summarizeJobs(userId, getDb);
      return counts.queued === 0 && counts.running === 0;
    }, fullRunTimeoutMs);

    await stopWorker(workerPhase2);
    const finalCounts = await summarizeJobs(userId, getDb);
    const finishedAt = Date.now();
    const durationMs = finishedAt - startedAt;

    const checks = {
      initialEnqueueCountMatches: initialCounts.total === totalJobs,
      interruptionObserved: interruptedBacklog > 0,
      queueDrainedAfterRestart: drained && finalCounts.queued === 0 && finalCounts.running === 0,
      noFailedJobs: finalCounts.failed === 0,
      allJobsTerminal: finalCounts.succeeded + finalCounts.failed === totalJobs,
    };

    const report = {
      generatedAt: new Date().toISOString(),
      config: {
        totalJobs,
        pollIntervalMs,
        workerPollMs,
        workerBatch,
        firstPhaseTimeoutMs,
        fullRunTimeoutMs,
      },
      summary: {
        durationMs,
        initialCounts,
        countsAfterStop,
        finalCounts,
      },
      checks,
      passed: Object.values(checks).every(Boolean),
      logsPreview: workerLogs.slice(-20),
    };

    await writeJsonReport(report);
    if (!report.passed) {
      throw new Error("Worker recovery validation checks did not pass.");
    }
  } finally {
    if (workerPhase1) {
      await stopWorker(workerPhase1).catch(() => undefined);
    }
    if (workerPhase2) {
      await stopWorker(workerPhase2).catch(() => undefined);
    }

    const db = await getDb().catch(() => null);
    if (db) {
      await Promise.all([
        db.collection("jobs").deleteMany({ userId, type: "domain-event-dispatch" }),
        db.collection("domainEvents").deleteMany({ _id: { $in: eventIds } }),
      ]).catch(() => undefined);
    }
    if (appClient) {
      await appClient.close().catch(() => undefined);
    }
  }
};

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error("Failed to validate worker recovery:", error);
    process.exit(1);
  });
