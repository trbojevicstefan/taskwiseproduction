import { randomUUID } from "crypto";
import { getDb } from "@/lib/db";
import {
  createLogger,
  ensureCorrelationId,
  serializeError,
} from "@/lib/observability";

const COLLECTION = "observabilityMetrics";
const TTL_DAYS = 30;
const TTL_SECONDS = TTL_DAYS * 24 * 60 * 60;

type MetricBase = {
  correlationId?: string | null;
  userId?: string | null;
};

type Outcome = "success" | "error";

type MetricDocument = {
  _id: string;
  kind: "route" | "job" | "external_api";
  outcome: Outcome;
  recordedAt: Date;
  correlationId: string;
  userId?: string | null;
  route?: string;
  method?: string;
  statusCode?: number;
  jobId?: string;
  jobType?: string;
  jobStatus?: string;
  provider?: "slack" | "google" | "fathom" | "openai";
  operation?: string;
  durationMs?: number;
  error?: ReturnType<typeof serializeError>;
  metadata?: Record<string, unknown> | null;
};

export type RouteMetricInput = MetricBase & {
  route: string;
  method: string;
  statusCode: number;
  durationMs: number;
  outcome: Outcome;
  metadata?: Record<string, unknown>;
};

export type JobMetricInput = MetricBase & {
  jobId: string;
  jobType: string;
  jobStatus: string;
  durationMs: number;
  outcome: Outcome;
  metadata?: Record<string, unknown>;
};

export type ExternalApiFailureInput = MetricBase & {
  provider: "slack" | "google" | "fathom" | "openai";
  operation: string;
  durationMs?: number;
  statusCode?: number;
  error: unknown;
  metadata?: Record<string, unknown>;
};

const metricsLogger = createLogger({ scope: "observability.metrics" });
let indexesEnsured = false;
let indexesEnsuring: Promise<void> | null = null;

const ensureIndexes = async () => {
  if (indexesEnsured) return;
  if (indexesEnsuring) {
    await indexesEnsuring;
    return;
  }

  indexesEnsuring = (async () => {
    const db = await getDb();
    const collection = db.collection(COLLECTION);
    await Promise.all([
      collection.createIndex({ kind: 1, recordedAt: -1 }),
      collection.createIndex({ correlationId: 1, recordedAt: -1 }),
      collection.createIndex({ route: 1, method: 1, recordedAt: -1 }),
      collection.createIndex({ jobType: 1, jobStatus: 1, recordedAt: -1 }),
      collection.createIndex({ provider: 1, operation: 1, outcome: 1, recordedAt: -1 }),
      collection.createIndex({ recordedAt: 1 }, { expireAfterSeconds: TTL_SECONDS }),
    ]);
    indexesEnsured = true;
    metricsLogger.info("observability.metrics.indexes.ready");
  })()
    .catch((error) => {
      metricsLogger.error("observability.metrics.indexes.failed", {
        error: serializeError(error),
      });
      throw error;
    })
    .finally(() => {
      indexesEnsuring = null;
    });

  await indexesEnsuring;
};

const persistMetric = async (document: MetricDocument) => {
  try {
    await ensureIndexes();
    const db = await getDb();
    await db.collection(COLLECTION).insertOne(document);
  } catch (error) {
    metricsLogger.warn("observability.metrics.persist.failed", {
      kind: document.kind,
      error: serializeError(error),
    });
  }
};

export const recordRouteMetric = async (input: RouteMetricInput) => {
  const correlationId = ensureCorrelationId(input.correlationId);
  await persistMetric({
    _id: randomUUID(),
    kind: "route",
    recordedAt: new Date(),
    outcome: input.outcome,
    correlationId,
    userId: input.userId || null,
    route: input.route,
    method: input.method,
    statusCode: input.statusCode,
    durationMs: input.durationMs,
    metadata: input.metadata || null,
  });
};

export const recordJobMetric = async (input: JobMetricInput) => {
  const correlationId = ensureCorrelationId(input.correlationId);
  await persistMetric({
    _id: randomUUID(),
    kind: "job",
    recordedAt: new Date(),
    outcome: input.outcome,
    correlationId,
    userId: input.userId || null,
    jobId: input.jobId,
    jobType: input.jobType,
    jobStatus: input.jobStatus,
    durationMs: input.durationMs,
    metadata: input.metadata || null,
  });
};

export const recordExternalApiFailure = async (
  input: ExternalApiFailureInput
) => {
  const correlationId = ensureCorrelationId(input.correlationId);
  await persistMetric({
    _id: randomUUID(),
    kind: "external_api",
    recordedAt: new Date(),
    outcome: "error",
    correlationId,
    userId: input.userId || null,
    provider: input.provider,
    operation: input.operation,
    statusCode: input.statusCode,
    durationMs: input.durationMs,
    error: serializeError(input.error),
    metadata: input.metadata || null,
  });
};
