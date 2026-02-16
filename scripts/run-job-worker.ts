import { processQueuedJobs } from "../src/lib/jobs/worker";
import { createLogger, serializeError } from "../src/lib/observability";

const pollIntervalMs = Number(process.env.JOB_WORKER_POLL_MS || 2000);
const batchSize = Number(process.env.JOB_WORKER_BATCH || 5);
const logger = createLogger({ scope: "jobs.worker.runner" });

let shuttingDown = false;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const run = async () => {
  logger.info("jobs.worker.runner.started", {
    pollIntervalMs,
    batchSize,
  });
  while (!shuttingDown) {
    const processed = await processQueuedJobs(batchSize);
    if (processed === 0) {
      await sleep(pollIntervalMs);
    }
  }
  logger.info("jobs.worker.runner.stopped");
};

process.on("SIGINT", () => {
  shuttingDown = true;
});

process.on("SIGTERM", () => {
  shuttingDown = true;
});

run().catch((error) => {
  logger.error("jobs.worker.runner.crashed", {
    error: serializeError(error),
  });
  process.exit(1);
});
