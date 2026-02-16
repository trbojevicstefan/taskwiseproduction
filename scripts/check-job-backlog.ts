import dotenv from "dotenv";
import { MongoClient } from "mongodb";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const WARN_THRESHOLD = Math.max(
  1,
  Number(process.env.JOB_BACKLOG_WARN_THRESHOLD || 100)
);
const CRITICAL_THRESHOLD = Math.max(
  WARN_THRESHOLD,
  Number(process.env.JOB_BACKLOG_CRITICAL_THRESHOLD || 500)
);
const dbName = process.env.MONGODB_DB || "taskwise";
const uri = process.env.MONGODB_URI;

const main = async () => {
  if (!uri) {
    throw new Error("MONGODB_URI is not set.");
  }

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);
  const jobs = db.collection("jobs");
  const now = new Date();

  const [queuedReady, queuedDelayed, running, failedLast24h] = await Promise.all([
    jobs.countDocuments({
      status: "queued",
      runAt: { $lte: now },
    }),
    jobs.countDocuments({
      status: "queued",
      runAt: { $gt: now },
    }),
    jobs.countDocuments({
      status: "running",
    }),
    jobs.countDocuments({
      status: "failed",
      updatedAt: { $gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
    }),
  ]);

  const snapshot = {
    queuedReady,
    queuedDelayed,
    running,
    failedLast24h,
    checkedAt: now.toISOString(),
  };
  const queuedTotal = snapshot.queuedReady + snapshot.queuedDelayed;

  const status =
    queuedTotal >= CRITICAL_THRESHOLD
      ? "critical"
      : queuedTotal >= WARN_THRESHOLD
        ? "warn"
        : "ok";

  console.log(
    JSON.stringify(
      {
        status,
        queuedTotal,
        thresholds: {
          warn: WARN_THRESHOLD,
          critical: CRITICAL_THRESHOLD,
        },
        snapshot,
      },
      null,
      2
    )
  );

  await client.close();

  if (status === "critical") {
    process.exitCode = 1;
  }
};

main().catch((error) => {
  console.error("Failed to check job backlog:", error);
  process.exitCode = 1;
});
