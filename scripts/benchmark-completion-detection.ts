/**
 * Completion-detection benchmark (Priority 7).
 *
 * Runs the LLM Completion Auditor (src/ai/flows/detect-completed-tasks-flow.ts)
 * over the gold fixture set and reports precision, recall, false positives,
 * and false negatives per case and in aggregate.
 *
 * Usage:
 *   npm run bench:completion                       # default gold dataset
 *   npx tsx scripts/benchmark-completion-detection.ts [dataset.json]
 *   npx tsx scripts/benchmark-completion-detection.ts --help
 *
 * Dataset schema (scripts/benchmarks/completion-detection-gold.json):
 *   [{ id, transcript, candidates: [{ groupId, title, assigneeKey? }],
 *      expectedCompleted: [groupId, ...] }, ...]
 *
 * Environment:
 *   OPENAI_API_KEY                  required — the auditor calls the live model.
 *   COMPLETION_BENCH_MIN_PRECISION  minimum precision gate (default 0.85).
 *     0.85 is the documented floor below which completion auto-apply is not
 *     trustworthy; it matches COMPLETION_AUTO_APPLY_MIN_CONFIDENCE in
 *     src/lib/task-completion-sync.ts — auto-apply is only allowed in the
 *     confidence regime whose precision this gate enforces.
 *   COMPLETION_BENCH_MIN_RECALL     minimum recall gate (default 0.8).
 *
 * Exit codes:
 *   0 — benchmark ran and both gates passed.
 *   1 — precision/recall below the documented minimum, missing dataset or
 *       API key, or a runtime failure. CI can therefore gate on this script.
 */

import fs from "fs";
import path from "path";
import { aggregateMetrics, scoreCase, type CaseScore } from "./benchmarks/completion-metrics";

type BenchmarkCase = {
  id: string;
  transcript: string;
  candidates: Array<{
    groupId: string;
    title: string;
    assigneeKey?: string;
  }>;
  expectedCompleted: string[];
};

/** Default minimum precision before the gate fails (see header). */
const DEFAULT_MIN_PRECISION = 0.85;
/** Default minimum recall before the gate fails (see header). */
const DEFAULT_MIN_RECALL = 0.8;

const USAGE = `Usage: npx tsx scripts/benchmark-completion-detection.ts [dataset.json]

Runs the completion-detection gold benchmark and reports precision, recall,
false positives and false negatives. Exits non-zero when precision drops
below COMPLETION_BENCH_MIN_PRECISION (default ${DEFAULT_MIN_PRECISION}) or recall drops below
COMPLETION_BENCH_MIN_RECALL (default ${DEFAULT_MIN_RECALL}).

Requires OPENAI_API_KEY (the auditor calls the live model).
Default dataset: scripts/benchmarks/completion-detection-gold.json`;

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(USAGE);
  process.exit(0);
}

type DetectCompletedTasksFn = (input: {
  transcript: string;
  candidates: Array<{ groupId: string; title: string; assigneeKey?: string }>;
}) => Promise<{ completed: Array<{ groupId: string }> }>;

const datasetArg =
  process.argv[2] || "scripts/benchmarks/completion-detection-gold.json";
const minPrecision = Number(
  process.env.COMPLETION_BENCH_MIN_PRECISION || DEFAULT_MIN_PRECISION
);
const minRecall = Number(
  process.env.COMPLETION_BENCH_MIN_RECALL || DEFAULT_MIN_RECALL
);

const datasetPath = path.isAbsolute(datasetArg)
  ? datasetArg
  : path.join(process.cwd(), datasetArg);

if (!process.env.OPENAI_API_KEY) {
  console.error("OPENAI_API_KEY is required to run completion benchmark.");
  process.exit(1);
}

if (!fs.existsSync(datasetPath)) {
  console.error(`Dataset not found: ${datasetPath}`);
  process.exit(1);
}

const dataset = JSON.parse(fs.readFileSync(datasetPath, "utf8")) as BenchmarkCase[];
if (!Array.isArray(dataset) || dataset.length === 0) {
  console.error("Benchmark dataset is empty.");
  process.exit(1);
}

const run = async () => {
  // Lazy import: the flow's module graph reaches src/lib/mongodb.ts, which
  // requires MONGODB_URI at load time. Importing here keeps --help and the
  // dataset/env validation above usable without a database.
  const detectModule = await import("../src/ai/flows/detect-completed-tasks-flow");
  const detectCompletedTasks =
    detectModule.detectCompletedTasks as DetectCompletedTasksFn;
  if (typeof detectCompletedTasks !== "function") {
    console.error("detectCompletedTasks flow export not found.");
    process.exit(1);
  }

  const scores: CaseScore[] = [];
  const rows: Array<{
    id: string;
    expected: number;
    predicted: number;
    tp: number;
    fp: number;
    fn: number;
  }> = [];

  for (const item of dataset) {
    const response = await detectCompletedTasks({
      transcript: item.transcript,
      candidates: item.candidates,
    });
    const predicted = (response.completed || []).map((entry) =>
      String(entry.groupId)
    );
    const score = scoreCase(item.expectedCompleted, predicted);
    scores.push(score);
    rows.push({
      id: item.id,
      expected: new Set(item.expectedCompleted.map(String)).size,
      predicted: new Set(predicted).size,
      ...score,
    });
  }

  const metrics = aggregateMetrics(scores);

  console.table(rows);
  console.log(
    `aggregate tp=${metrics.tp} fp=${metrics.fp} fn=${metrics.fn} ` +
      `falsePositives=${metrics.fp} falseNegatives=${metrics.fn} ` +
      `precision=${metrics.precision.toFixed(3)} recall=${metrics.recall.toFixed(
        3
      )} f1=${metrics.f1.toFixed(3)}`
  );

  if (metrics.precision < minPrecision || metrics.recall < minRecall) {
    console.error(
      `Benchmark gate failed (min precision ${minPrecision}, min recall ${minRecall}).`
    );
    process.exit(1);
  }
};

run().catch((error) => {
  console.error("Benchmark failed:", error);
  process.exit(1);
});
