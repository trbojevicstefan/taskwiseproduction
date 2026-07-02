import fs from "fs";
import path from "path";
import * as detectModule from "../src/ai/flows/detect-completed-tasks-flow";

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

const { detectCompletedTasks } = detectModule as {
  detectCompletedTasks: (input: {
    transcript: string;
    candidates: Array<{ groupId: string; title: string; assigneeKey?: string }>;
  }) => Promise<{ completed: Array<{ groupId: string }> }>;
};

const datasetArg =
  process.argv[2] || "scripts/benchmarks/completion-detection-gold.json";
const minPrecision = Number(process.env.COMPLETION_BENCH_MIN_PRECISION || 0.85);
const minRecall = Number(process.env.COMPLETION_BENCH_MIN_RECALL || 0.8);

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

if (typeof detectCompletedTasks !== "function") {
  console.error("detectCompletedTasks flow export not found.");
  process.exit(1);
}

const dataset = JSON.parse(fs.readFileSync(datasetPath, "utf8")) as BenchmarkCase[];
if (!Array.isArray(dataset) || dataset.length === 0) {
  console.error("Benchmark dataset is empty.");
  process.exit(1);
}

const metrics = {
  tp: 0,
  fp: 0,
  fn: 0,
};

const run = async () => {
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
    const predicted = new Set(
      (response.completed || []).map((entry) => String(entry.groupId))
    );
    const expected = new Set(item.expectedCompleted.map(String));

    let tp = 0;
    let fp = 0;
    let fn = 0;

    predicted.forEach((groupId) => {
      if (expected.has(groupId)) {
        tp += 1;
      } else {
        fp += 1;
      }
    });
    expected.forEach((groupId) => {
      if (!predicted.has(groupId)) {
        fn += 1;
      }
    });

    metrics.tp += tp;
    metrics.fp += fp;
    metrics.fn += fn;
    rows.push({
      id: item.id,
      expected: expected.size,
      predicted: predicted.size,
      tp,
      fp,
      fn,
    });
  }

  const precision =
    metrics.tp + metrics.fp > 0 ? metrics.tp / (metrics.tp + metrics.fp) : 0;
  const recall =
    metrics.tp + metrics.fn > 0 ? metrics.tp / (metrics.tp + metrics.fn) : 0;
  const f1 =
    precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  console.table(rows);
  console.log(
    `aggregate tp=${metrics.tp} fp=${metrics.fp} fn=${metrics.fn} precision=${precision.toFixed(
      3
    )} recall=${recall.toFixed(3)} f1=${f1.toFixed(3)}`
  );

  if (precision < minPrecision || recall < minRecall) {
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
