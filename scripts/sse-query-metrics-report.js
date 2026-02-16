#!/usr/bin/env node
const { MongoClient } = require("mongodb");
require("dotenv").config();

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error("MONGODB_URI not set in environment.");
  process.exit(1);
}

const dbName = process.env.MONGODB_DB || "taskwise";
const hours = Math.max(1, Number(process.env.SSE_METRICS_WINDOW_HOURS || 24));

const percentile = (sortedValues, p) => {
  if (!sortedValues.length) return 0;
  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.ceil((p / 100) * sortedValues.length) - 1)
  );
  return sortedValues[index];
};

const avg = (values) => {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const run = async () => {
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db(dbName);
    const start = new Date(Date.now() - hours * 60 * 60 * 1000);

    const metrics = await db
      .collection("observabilityMetrics")
      .find({
        kind: "route",
        route: "/api/realtime/stream",
        method: "GET",
        recordedAt: { $gte: start },
      })
      .project({
        durationMs: 1,
        metadata: 1,
        recordedAt: 1,
      })
      .sort({ recordedAt: 1 })
      .toArray();

    const durations = metrics
      .map((entry) => Number(entry.durationMs || 0))
      .filter((value) => Number.isFinite(value) && value >= 0)
      .sort((a, b) => a - b);
    const delivered = metrics
      .map((entry) => Number(entry.metadata?.updatesDelivered || 0))
      .filter((value) => Number.isFinite(value) && value >= 0);

    const report = {
      windowHours: hours,
      from: start.toISOString(),
      to: new Date().toISOString(),
      sampleSize: metrics.length,
      connectionDurationMs: {
        avg: Number(avg(durations).toFixed(2)),
        p50: percentile(durations, 50),
        p95: percentile(durations, 95),
        p99: percentile(durations, 99),
      },
      updatesDeliveredPerConnection: {
        avg: Number(avg(delivered).toFixed(2)),
        p50: percentile([...delivered].sort((a, b) => a - b), 50),
        p95: percentile([...delivered].sort((a, b) => a - b), 95),
      },
    };

    console.log(JSON.stringify(report, null, 2));
  } finally {
    await client.close();
  }
};

run().catch((error) => {
  console.error("Failed to generate SSE metrics report:", error);
  process.exit(1);
});
