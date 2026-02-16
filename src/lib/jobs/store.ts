import { randomUUID } from "crypto";
import type { Db } from "mongodb";
import type {
  JobDocument,
  JobPayloadByType,
  JobResult,
  JobType,
} from "@/lib/jobs/types";
import { ensureCorrelationId } from "@/lib/observability";

const JOB_COLLECTION = "jobs";

const getJobsCollection = (db: Db) => db.collection<JobDocument>(JOB_COLLECTION);

export const ensureJobIndexes = async (db: Db) => {
  const collection = getJobsCollection(db);
  await Promise.all([
    collection.createIndex({ userId: 1, createdAt: -1 }),
    collection.createIndex({ status: 1, runAt: 1, createdAt: 1 }),
    collection.createIndex({ type: 1, status: 1 }),
    collection.createIndex({ correlationId: 1, createdAt: -1 }),
  ]);
};

export const enqueueJob = async <TType extends JobType>(
  db: Db,
  input: {
    type: TType;
    userId: string;
    payload: JobPayloadByType[TType];
    maxAttempts?: number;
    runAt?: Date;
    correlationId?: string;
  }
) => {
  const now = new Date();
  const correlationId = ensureCorrelationId(input.correlationId);
  const job: JobDocument<TType> = {
    _id: randomUUID(),
    type: input.type,
    userId: input.userId,
    correlationId,
    payload: input.payload,
    status: "queued",
    attempts: 0,
    maxAttempts: input.maxAttempts ?? 2,
    runAt: input.runAt ?? now,
    createdAt: now,
    updatedAt: now,
  };
  await getJobsCollection(db).insertOne(job as JobDocument);
  return job;
};

export const claimNextJob = async (db: Db) => {
  const now = new Date();
  return getJobsCollection(db).findOneAndUpdate(
    {
      status: "queued",
      runAt: { $lte: now },
    },
    {
      $set: {
        status: "running",
        startedAt: now,
        updatedAt: now,
      },
      $inc: { attempts: 1 },
    },
    {
      sort: { runAt: 1, createdAt: 1 },
      returnDocument: "after",
    }
  );
};

export const claimJobById = async (db: Db, jobId: string) => {
  const now = new Date();
  return getJobsCollection(db).findOneAndUpdate(
    {
      _id: jobId,
      status: "queued",
      runAt: { $lte: now },
    },
    {
      $set: {
        status: "running",
        startedAt: now,
        updatedAt: now,
      },
      $inc: { attempts: 1 },
    },
    {
      returnDocument: "after",
    }
  );
};

export const markJobSucceeded = async (
  db: Db,
  jobId: string,
  result: JobResult
) => {
  const now = new Date();
  await getJobsCollection(db).updateOne(
    { _id: jobId },
    {
      $set: {
        status: "succeeded",
        result,
        finishedAt: now,
        updatedAt: now,
      },
      $unset: {
        error: "",
      },
    }
  );
};

export const markJobFailed = async (
  db: Db,
  job: JobDocument,
  error: unknown
) => {
  const now = new Date();
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  const canRetry = job.attempts < job.maxAttempts;

  if (canRetry) {
    const retryDelayMs = 10_000 * job.attempts;
    await getJobsCollection(db).updateOne(
      { _id: job._id },
      {
        $set: {
          status: "queued",
          runAt: new Date(now.getTime() + retryDelayMs),
          updatedAt: now,
          error: { message, stack },
        },
      }
    );
    return;
  }

  await getJobsCollection(db).updateOne(
    { _id: job._id },
    {
      $set: {
        status: "failed",
        error: { message, stack },
        finishedAt: now,
        updatedAt: now,
      },
    }
  );
};

export const getJobById = async (db: Db, jobId: string) =>
  getJobsCollection(db).findOne({ _id: jobId });

export const getJobByIdForUser = async (db: Db, userId: string, jobId: string) =>
  getJobsCollection(db).findOne({ _id: jobId, userId });

export const getJobQueueSnapshot = async (db: Db) => {
  const collection = getJobsCollection(db);
  const now = new Date();
  const [queuedReady, queuedDelayed, running, failedLast24h] = await Promise.all([
    collection.countDocuments({
      status: "queued",
      runAt: { $lte: now },
    }),
    collection.countDocuments({
      status: "queued",
      runAt: { $gt: now },
    }),
    collection.countDocuments({
      status: "running",
    }),
    collection.countDocuments({
      status: "failed",
      updatedAt: { $gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
    }),
  ]);

  return {
    queuedReady,
    queuedDelayed,
    running,
    failedLast24h,
    checkedAt: now.toISOString(),
  };
};

export const serializeJob = (job: JobDocument | null) => {
  if (!job) return null;
  return {
    id: job._id,
    type: job.type,
    status: job.status,
    userId: job.userId,
    correlationId: job.correlationId || null,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    payload: job.payload,
    result: job.result ?? null,
    error: job.error ?? null,
    runAt: job.runAt?.toISOString?.() || job.runAt,
    createdAt: job.createdAt?.toISOString?.() || job.createdAt,
    updatedAt: job.updatedAt?.toISOString?.() || job.updatedAt,
    startedAt: job.startedAt?.toISOString?.() || null,
    finishedAt: job.finishedAt?.toISOString?.() || null,
  };
};

