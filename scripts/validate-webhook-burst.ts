import crypto from "crypto";
import dotenv from "dotenv";
import { MongoClient, ObjectId } from "mongodb";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const uri = process.env.MONGODB_URI;
if (!uri) {
  throw new Error("MONGODB_URI is not set.");
}

const dbName = process.env.MONGODB_DB || "taskwise";
const rounds = Math.max(1, Number(process.env.WEBHOOK_BURST_ROUNDS || 3));
const requestsPerRound = Math.max(
  1,
  Number(process.env.WEBHOOK_BURST_REQUESTS_PER_ROUND || 200)
);
const concurrency = Math.max(
  1,
  Number(process.env.WEBHOOK_BURST_CONCURRENCY || 40)
);
const latencyTargetMs = Math.max(
  1,
  Number(process.env.WEBHOOK_P95_TARGET_MS || 1500)
);
const timeoutThresholdMs = Math.max(
  1,
  Number(process.env.WEBHOOK_TIMEOUT_THRESHOLD_MS || 3000)
);
const stabilitySpreadLimit = Math.max(
  1,
  Number(process.env.WEBHOOK_STABILITY_SPREAD_LIMIT || 1.35)
);

type RoundResult = {
  round: number;
  sampleSize: number;
  p50: number;
  p95: number;
  p99: number;
  avg: number;
  timeoutCount: number;
  statusCounts: Record<string, number>;
  durations: number[];
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

const percentile = (values: number[], p: number) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)
  );
  return sorted[index];
};

const average = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

const summarize = (durations: number[]) => ({
  sampleSize: durations.length,
  p50: percentile(durations, 50),
  p95: percentile(durations, 95),
  p99: percentile(durations, 99),
  avg: Number(average(durations).toFixed(2)),
});

const runBurstRound = async (
  round: number,
  total: number,
  workers: number,
  token: string,
  recordingPrefix: string,
  post: (request: Request) => Promise<Response>
) => {
  let nextIndex = 0;
  const durations: number[] = [];
  const statusCounts = new Map<number, number>();
  let timeoutCount = 0;

  const worker = async () => {
    while (true) {
      const current = nextIndex;
      nextIndex += 1;
      if (current >= total) {
        return;
      }

      const recordingId = `${recordingPrefix}-r${round}-n${current}`;
      const payload = {
        event: "new-meeting-content-ready",
        data: {
          recording_id: recordingId,
        },
      };
      const request = new Request(
        `http://localhost/api/fathom/webhook?token=${encodeURIComponent(token)}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify(payload),
        }
      );

      const startedAt = performance.now();
      const response = await post(request);
      const duration = performance.now() - startedAt;
      durations.push(duration);
      if (duration > timeoutThresholdMs) {
        timeoutCount += 1;
      }
      statusCounts.set(response.status, (statusCounts.get(response.status) || 0) + 1);
    }
  };

  await Promise.all(Array.from({ length: workers }, () => worker()));
  const summary = summarize(durations);

  return {
    round,
    ...summary,
    timeoutCount,
    durations,
    statusCounts: Object.fromEntries(
      [...statusCounts.entries()].map(([status, count]) => [String(status), count])
    ),
  } as RoundResult;
};

const main = async () => {
  process.env.CORE_FIRST_QUEUE_FIRST_WEBHOOK_INGESTION = "1";
  process.env.JOB_WORKER_DISABLE_KICK = "1";
  delete process.env.FATHOM_WEBHOOK_SECRET;

  const { POST } = await import("../src/app/api/fathom/webhook/route");
  const clientPromise = (await import("../src/lib/mongodb")).default;
  let appClient: MongoClient | null = null;

  const token = `burst-token-${crypto.randomUUID()}`;
  const recordingPrefix = `burst-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const client = new MongoClient(uri);
  const userId = new ObjectId();

  try {
    await client.connect();
    appClient = await clientPromise;
    const db = client.db(dbName);

    const testUser = {
      _id: userId,
      email: `burst+${token}@example.com`,
      name: "Webhook Burst Probe",
      passwordHash: "not-used",
      avatarUrl: null,
      sourceSessionIds: [],
      createdAt: new Date(),
      lastUpdated: new Date(),
      lastSeenAt: new Date(),
      onboardingCompleted: true,
      workspace: { id: crypto.randomUUID(), name: "Burst Workspace" },
      firefliesWebhookToken: null,
      fathomWebhookToken: token,
      fathomConnected: true,
    };
    await db.collection("users").insertOne(testUser);

    const perRound: RoundResult[] = [];
    for (let round = 1; round <= rounds; round += 1) {
      const roundResult = await runBurstRound(
        round,
        requestsPerRound,
        concurrency,
        token,
        recordingPrefix,
        POST
      );
      perRound.push(roundResult);
    }
    const requestDurations = perRound.flatMap((round) => round.durations);
    const aggregate = summarize(requestDurations);

    const roundP95s = perRound.map((round) => round.p95).filter((value) => value > 0);
    const minRoundP95 = roundP95s.length ? Math.min(...roundP95s) : 0;
    const maxRoundP95 = roundP95s.length ? Math.max(...roundP95s) : 0;
    const stabilitySpread =
      minRoundP95 > 0 ? Number((maxRoundP95 / minRoundP95).toFixed(3)) : 0;

    const totalRequests = perRound.reduce((sum, round) => sum + round.sampleSize, 0);
    const totalTimeouts = perRound.reduce((sum, round) => sum + round.timeoutCount, 0);
    const statusCounts = perRound.reduce((acc, round) => {
      Object.entries(round.statusCounts).forEach(([status, count]) => {
        acc[status] = (acc[status] || 0) + count;
      });
      return acc;
    }, {} as Record<string, number>);

    const weightedP95 = aggregate.p95;
    const weightedP50 = aggregate.p50;
    const weightedP99 = aggregate.p99;

    const successCount = Number(statusCounts["202"] || 0);
    const errorCount = totalRequests - successCount;

    const checks = {
      p95WithinTarget: weightedP95 <= latencyTargetMs,
      noTimeouts: totalTimeouts === 0,
      allAccepted: errorCount === 0,
      stableP95Spread:
        roundP95s.length <= 1 || (stabilitySpread > 0 && stabilitySpread <= stabilitySpreadLimit),
    };

    const report = {
      generatedAt: new Date().toISOString(),
      config: {
        rounds,
        requestsPerRound,
        concurrency,
        latencyTargetMs,
        timeoutThresholdMs,
        stabilitySpreadLimit,
      },
      summary: {
        totalRequests,
        successCount,
        errorCount,
        timeoutCount: totalTimeouts,
        statusCounts,
        latencyMs: {
          p50: weightedP50,
          p95: weightedP95,
          p99: weightedP99,
        },
        p95Stability: {
          perRound: roundP95s,
          min: minRoundP95,
          max: maxRoundP95,
          spread: stabilitySpread,
        },
      },
      rounds: perRound.map(({ durations, ...round }) => round),
      checks,
      passed: Object.values(checks).every(Boolean),
    };

    await writeJsonReport(report);
    if (!report.passed) {
      throw new Error("Webhook burst validation checks did not pass.");
    }
  } finally {
    const db = client.db(dbName);
    await Promise.all([
      db.collection("users").deleteMany({ _id: userId }),
      db
        .collection("jobs")
        .deleteMany({ userId: userId.toString(), type: "fathom-webhook-ingest" }),
      db.collection("fathomIntegrationLogs").deleteMany({ userId: userId.toString() }),
      db
        .collection<{ _id: string }>("fathomInstallations")
        .deleteMany({ _id: userId.toString() }),
    ]).catch(() => undefined);
    await client.close().catch(() => undefined);
    if (appClient) {
      await appClient.close().catch(() => undefined);
    }
    delete process.env.JOB_WORKER_DISABLE_KICK;
  }
};

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error("Failed to validate webhook burst performance:", error);
    process.exit(1);
  });
