import dotenv from "dotenv";
import { MongoClient, type Filter } from "mongodb";
import { randomUUID } from "crypto";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const uri = process.env.MONGODB_URI;
if (!uri) {
  throw new Error("MONGODB_URI is not set.");
}

const dbName = process.env.MONGODB_DB || "taskwise";
const seedEvents = Math.max(500, Number(process.env.SSE_LATENCY_SEED_EVENTS || 5000));
const concurrency = Math.max(1, Number(process.env.SSE_LATENCY_CONCURRENCY || 50));
const iterations = Math.max(1, Number(process.env.SSE_LATENCY_ITERATIONS || 40));
const limit = Math.max(1, Number(process.env.SSE_LATENCY_QUERY_LIMIT || 200));
const p95TargetMs = Math.max(1, Number(process.env.SSE_LATENCY_P95_TARGET_MS || 1100));
const p99TargetMs = Math.max(1, Number(process.env.SSE_LATENCY_P99_TARGET_MS || 1300));

type DomainEventDoc = {
  _id: string;
  type: string;
  userId: string;
  correlationId: string;
  payload: {
    taskId: string;
    status: string;
  };
  status: "queued" | "running" | "handled" | "failed";
  createdAt: Date;
  updatedAt: Date;
  handledAt?: Date;
  expiresAt: Date;
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

const extractWinningPlan = (explain: any): string | null => {
  const plan = explain?.queryPlanner?.winningPlan;
  if (!plan) return null;
  const parts: string[] = [];
  const walk = (node: any) => {
    if (!node || typeof node !== "object") return;
    if (typeof node.stage === "string") parts.push(node.stage);
    if (node.inputStage) walk(node.inputStage);
    if (node.innerStage) walk(node.innerStage);
    if (Array.isArray(node.inputStages)) {
      node.inputStages.forEach(walk);
    }
    if (node.shards && typeof node.shards === "object") {
      Object.values(node.shards).forEach((shard: any) => walk(shard?.winningPlan));
    }
  };
  walk(plan);
  return parts.length ? parts.join(" -> ") : null;
};

const main = async () => {
  const userId = `sse-latency-${randomUUID()}`;
  const client = new MongoClient(uri);
  const eventIds: string[] = [];

  try {
    await client.connect();
    const db = client.db(dbName);
    const collection = db.collection<DomainEventDoc>("domainEvents");

    await Promise.all([
      collection.createIndex(
        { userId: 1, status: 1, createdAt: 1, _id: 1 },
        { name: "domain_events_user_status_created_cursor" }
      ),
      collection.createIndex(
        { userId: 1, type: 1, createdAt: -1 },
        { name: "domain_events_user_type_created" }
      ),
      collection.createIndex(
        { expiresAt: 1 },
        { name: "domain_events_expires_at_ttl", expireAfterSeconds: 0 }
      ),
    ]);

    const now = Date.now();
    const docs: DomainEventDoc[] = Array.from({ length: seedEvents }).map((_, index) => {
      const id = randomUUID();
      eventIds.push(id);
      const createdAt = new Date(now - (seedEvents - index) * 10);
      return {
        _id: id,
        type: "task.status.changed",
        userId,
        correlationId: `sse-${index}`,
        payload: {
          taskId: `task-${index}`,
          status: "todo",
        },
        status: "handled",
        createdAt,
        updatedAt: createdAt,
        handledAt: createdAt,
        expiresAt: new Date(now + 7 * 24 * 60 * 60 * 1000),
      };
    });
    await collection.insertMany(docs);

    const cursorDate = new Date(now - seedEvents * 10 - 1000);
    const cursorId = "";
    const filter: Filter<DomainEventDoc> = {
      userId,
      status: "handled",
      $or: [
        { createdAt: { $gt: cursorDate } },
        { createdAt: cursorDate, _id: { $gt: cursorId } },
      ],
    };
    const projection = { _id: 1, type: 1, payload: 1, createdAt: 1 };
    const sort = { createdAt: 1, _id: 1 } as const;

    const explain = await collection
      .find(filter)
      .project(projection)
      .sort(sort)
      .limit(limit)
      .explain("queryPlanner");

    const durations: number[] = [];
    let totalRows = 0;

    const runOne = async () => {
      const startedAt = performance.now();
      const rows = await collection
        .find(filter)
        .project(projection)
        .sort(sort)
        .limit(limit)
        .toArray();
      const duration = performance.now() - startedAt;
      durations.push(duration);
      totalRows += rows.length;
    };

    for (let iteration = 0; iteration < iterations; iteration += 1) {
      await Promise.all(Array.from({ length: concurrency }, () => runOne()));
    }

    const p50 = percentile(durations, 50);
    const p95 = percentile(durations, 95);
    const p99 = percentile(durations, 99);
    const avg = Number(average(durations).toFixed(2));
    const totalQueries = durations.length;

    const checks = {
      p95WithinTarget: p95 <= p95TargetMs,
      p99WithinTarget: p99 <= p99TargetMs,
      expectedConcurrencyCovered: totalQueries === concurrency * iterations,
      queryPlannerIndexPresent: Boolean(
        JSON.stringify(explain).includes("domain_events_user_status_created_cursor")
      ),
    };

    const report = {
      generatedAt: new Date().toISOString(),
      config: {
        seedEvents,
        concurrency,
        iterations,
        limit,
        p95TargetMs,
        p99TargetMs,
      },
      summary: {
        totalQueries,
        totalRows,
        avgRowsPerQuery: Number((totalRows / Math.max(1, totalQueries)).toFixed(2)),
        latencyMs: {
          avg,
          p50,
          p95,
          p99,
        },
      },
      queryPlan: {
        winningPlanStages: extractWinningPlan(explain),
      },
      checks,
      passed: Object.values(checks).every(Boolean),
    };

    await writeJsonReport(report);
    if (!report.passed) {
      throw new Error("SSE poll latency validation checks did not pass.");
    }
  } finally {
    const db = client.db(dbName);
    await db
      .collection<DomainEventDoc>("domainEvents")
      .deleteMany({ _id: { $in: eventIds } })
      .catch(() => undefined);
    await client.close().catch(() => undefined);
  }
};

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error("Failed to validate SSE poll latency:", error);
    process.exit(1);
  });
