#!/usr/bin/env node
const { MongoClient } = require("mongodb");
require("dotenv").config({ path: ".env.local" });
require("dotenv").config({ path: ".env" });

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error("MONGODB_URI not set in environment.");
  process.exit(1);
}

const dbName = process.env.MONGODB_DB || "taskwise";
const hours = Math.max(1, Number(process.env.CORE_FIRST_BASELINE_WINDOW_HOURS || 24));

const WEBHOOK_ROUTE = "/api/fathom/webhook";
const WEBHOOK_METHOD = "POST";
const SSE_ROUTE = "/api/realtime/stream";
const SSE_METHOD = "GET";

const webhookP95WarnMs = Number(process.env.CORE_FIRST_WEBHOOK_P95_WARN_MS || 1500);
const webhookP95CriticalMs = Number(process.env.CORE_FIRST_WEBHOOK_P95_CRITICAL_MS || 3000);
const jobFailureWarnRate = Number(process.env.CORE_FIRST_JOB_FAILURE_WARN_RATE || 0.05);
const jobFailureCriticalRate = Number(process.env.CORE_FIRST_JOB_FAILURE_CRITICAL_RATE || 0.1);
const jobRetryWarnRate = Number(process.env.CORE_FIRST_JOB_RETRY_WARN_RATE || 0.1);
const jobRetryCriticalRate = Number(process.env.CORE_FIRST_JOB_RETRY_CRITICAL_RATE || 0.2);
const slowRouteP95WarnMs = Number(process.env.CORE_FIRST_ROUTE_P95_WARN_MS || 1000);
const slowRouteP95CriticalMs = Number(process.env.CORE_FIRST_ROUTE_P95_CRITICAL_MS || 2500);

const shouldCheck = process.argv.includes("--check");

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

const round = (value, digits = 2) =>
  Number(Number(value || 0).toFixed(digits));

const rate = (numerator, denominator) =>
  denominator > 0 ? round(numerator / denominator, 4) : 0;

const computeLatency = (durations) => {
  const sorted = durations
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((a, b) => a - b);
  return {
    sampleSize: sorted.length,
    avg: round(avg(sorted)),
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
  };
};

const statusFromThresholds = (value, warn, critical) => {
  if (!Number.isFinite(value)) return "no_data";
  if (value >= critical) return "critical";
  if (value >= warn) return "warn";
  return "ok";
};

const mergeStatuses = (statuses) => {
  if (statuses.includes("critical")) return "critical";
  if (statuses.includes("warn")) return "warn";
  if (statuses.every((status) => status === "no_data")) return "no_data";
  return "ok";
};

const buildTopSlowRoutes = (routeEntries) => {
  const map = new Map();
  routeEntries.forEach((entry) => {
    const route = String(entry.route || "");
    const method = String(entry.method || "GET");
    if (!route) return;
    const key = `${method} ${route}`;
    if (!map.has(key)) {
      map.set(key, {
        route,
        method,
        durations: [],
        total: 0,
        errors: 0,
      });
    }
    const row = map.get(key);
    row.total += 1;
    if (entry.outcome === "error" || Number(entry.statusCode || 0) >= 400) {
      row.errors += 1;
    }
    if (Number.isFinite(entry.durationMs)) {
      row.durations.push(Number(entry.durationMs));
    }
  });

  return Array.from(map.values())
    .map((row) => {
      const latency = computeLatency(row.durations);
      return {
        route: row.route,
        method: row.method,
        sampleSize: row.total,
        avgMs: latency.avg,
        p95Ms: latency.p95,
        p99Ms: latency.p99,
        errorRate: rate(row.errors, row.total),
      };
    })
    .sort((a, b) => {
      if (b.p95Ms !== a.p95Ms) return b.p95Ms - a.p95Ms;
      if (b.avgMs !== a.avgMs) return b.avgMs - a.avgMs;
      return b.sampleSize - a.sampleSize;
    })
    .slice(0, 10);
};

const run = async () => {
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db(dbName);
    const start = new Date(Date.now() - hours * 60 * 60 * 1000);
    const end = new Date();

    const [routeMetrics, jobStatusCounts, retriedJobCount, totalJobs] =
      await Promise.all([
        db
          .collection("observabilityMetrics")
          .find({
            kind: "route",
            recordedAt: { $gte: start, $lte: end },
          })
          .project({
            route: 1,
            method: 1,
            durationMs: 1,
            statusCode: 1,
            outcome: 1,
            metadata: 1,
          })
          .toArray(),
        db
          .collection("jobs")
          .aggregate([
            { $match: { createdAt: { $gte: start, $lte: end } } },
            { $group: { _id: "$status", count: { $sum: 1 } } },
          ])
          .toArray(),
        db.collection("jobs").countDocuments({
          createdAt: { $gte: start, $lte: end },
          attempts: { $gt: 1 },
        }),
        db.collection("jobs").countDocuments({
          createdAt: { $gte: start, $lte: end },
        }),
      ]);

    const webhookEntries = routeMetrics.filter(
      (entry) => entry.route === WEBHOOK_ROUTE && entry.method === WEBHOOK_METHOD
    );
    const webhookLatency = computeLatency(
      webhookEntries.map((entry) => entry.durationMs)
    );

    const sseEntries = routeMetrics.filter(
      (entry) => entry.route === SSE_ROUTE && entry.method === SSE_METHOD
    );
    const sseLatency = computeLatency(sseEntries.map((entry) => entry.durationMs));
    const updatesDelivered = sseEntries
      .map((entry) => Number(entry.metadata?.updatesDelivered || 0))
      .filter((value) => Number.isFinite(value) && value >= 0)
      .sort((a, b) => a - b);

    const countByStatus = Object.fromEntries(
      jobStatusCounts.map((row) => [String(row._id || "unknown"), Number(row.count || 0)])
    );
    const succeeded = Number(countByStatus.succeeded || 0);
    const failed = Number(countByStatus.failed || 0);
    const running = Number(countByStatus.running || 0);
    const queued = Number(countByStatus.queued || 0);

    const topSlowRoutes = buildTopSlowRoutes(routeMetrics);

    const webhookStatus =
      webhookLatency.sampleSize > 0
        ? statusFromThresholds(
            webhookLatency.p95,
            webhookP95WarnMs,
            webhookP95CriticalMs
          )
        : "no_data";
    const jobFailureStatus =
      totalJobs > 0
        ? statusFromThresholds(
            rate(failed, totalJobs),
            jobFailureWarnRate,
            jobFailureCriticalRate
          )
        : "no_data";
    const jobRetryStatus =
      totalJobs > 0
        ? statusFromThresholds(
            rate(retriedJobCount, totalJobs),
            jobRetryWarnRate,
            jobRetryCriticalRate
          )
        : "no_data";
    const slowRouteStatus =
      topSlowRoutes.length > 0
        ? statusFromThresholds(
            topSlowRoutes[0].p95Ms,
            slowRouteP95WarnMs,
            slowRouteP95CriticalMs
          )
        : "no_data";

    const report = {
      generatedAt: end.toISOString(),
      windowHours: hours,
      from: start.toISOString(),
      to: end.toISOString(),
      baseline: {
        webhookLatencyMs: {
          route: WEBHOOK_ROUTE,
          method: WEBHOOK_METHOD,
          ...webhookLatency,
        },
        jobs: {
          total: totalJobs,
          succeeded,
          failed,
          running,
          queued,
          retried: retriedJobCount,
          successRate: rate(succeeded, totalJobs),
          failureRate: rate(failed, totalJobs),
          retryRate: rate(retriedJobCount, totalJobs),
        },
        sse: {
          route: SSE_ROUTE,
          method: SSE_METHOD,
          connections: sseEntries.length,
          connectionDurationMs: sseLatency,
          updatesDeliveredPerConnection: {
            avg: round(avg(updatesDelivered)),
            p50: percentile(updatesDelivered, 50),
            p95: percentile(updatesDelivered, 95),
          },
          queryCostProxyMs: {
            avg: sseLatency.avg,
            p95: sseLatency.p95,
          },
        },
        topSlowApiRoutes: topSlowRoutes,
      },
      alertStatus: {
        webhookP95: webhookStatus,
        jobFailureRate: jobFailureStatus,
        jobRetryRate: jobRetryStatus,
        topSlowRouteP95: slowRouteStatus,
        overall: mergeStatuses([
          webhookStatus,
          jobFailureStatus,
          jobRetryStatus,
          slowRouteStatus,
        ]),
      },
      coverage: {
        routeMetricSamples: routeMetrics.length,
        webhookMetricSamples: webhookEntries.length,
        sseMetricSamples: sseEntries.length,
      },
      notes: [
        routeMetrics.length === 0
          ? "No route metrics in selected window; webhook/SSE/slow-route baselines are no-data."
          : null,
        totalJobs === 0
          ? "No jobs created in selected window; job rates are no-data."
          : null,
      ].filter(Boolean),
    };

    console.log(JSON.stringify(report, null, 2));

    if (shouldCheck && report.alertStatus.overall === "critical") {
      process.exitCode = 1;
    }
  } finally {
    await client.close();
  }
};

run().catch((error) => {
  console.error("Failed to generate core-first baseline report:", error);
  process.exit(1);
});
