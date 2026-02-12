"use strict";

const fs = require("fs");
const path = require("path");

const defaultLogPath = process.env.OPENAI_USAGE_LOG_FILE || "tmp/openai-usage.ndjson";
const inputPath = process.argv[2] || defaultLogPath;
const hoursArg = Number(process.argv[3] || process.env.OPENAI_USAGE_REPORT_HOURS || 24);
const lookbackHours = Number.isFinite(hoursArg) && hoursArg > 0 ? hoursArg : 24;

const resolvePath = (value) => path.isAbsolute(value) ? value : path.join(process.cwd(), value);

const logPath = resolvePath(inputPath);
if (!fs.existsSync(logPath)) {
  console.error(`Usage log file not found: ${logPath}`);
  process.exit(1);
}

const raw = fs.readFileSync(logPath, "utf8");
const nowMs = Date.now();
const minTimestampMs = nowMs - lookbackHours * 60 * 60 * 1000;

const rows = raw
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  })
  .filter(Boolean)
  .filter((row) => {
    const ts = Date.parse(row.timestamp);
    return Number.isFinite(ts) && ts >= minTimestampMs;
  });

if (!rows.length) {
  console.log(`No usage rows found in the last ${lookbackHours}h.`);
  process.exit(0);
}

const percentile = (values, p) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
};

const promptStats = new Map();
const endpointCounts = new Map();

rows.forEach((row) => {
  const endpoint = String(row.endpoint || "unknown_endpoint");
  const promptName = String(row.promptName || "unknown_prompt");
  const key = `${endpoint}::${promptName}`;
  const totalTokens = Number(row.totalTokens);
  const tokenValue = Number.isFinite(totalTokens) ? totalTokens : 0;
  const callCount = endpointCounts.get(endpoint) || 0;
  endpointCounts.set(endpoint, callCount + 1);

  const existing = promptStats.get(key) || {
    endpoint,
    promptName,
    callCount: 0,
    totalTokens: 0,
    tokenSamples: [],
  };
  existing.callCount += 1;
  existing.totalTokens += tokenValue;
  if (tokenValue > 0) {
    existing.tokenSamples.push(tokenValue);
  }
  promptStats.set(key, existing);
});

const promptRows = Array.from(promptStats.values())
  .map((row) => ({
    endpoint: row.endpoint,
    prompt: row.promptName,
    calls: row.callCount,
    totalTokens: row.totalTokens,
    p95Tokens: percentile(row.tokenSamples, 95),
  }))
  .sort((a, b) => b.totalTokens - a.totalTokens);

const endpointRows = Array.from(endpointCounts.entries())
  .map(([endpoint, calls]) => ({ endpoint, calls }))
  .sort((a, b) => b.calls - a.calls);

const totalCalls = rows.length;
const totalTokens = rows.reduce((sum, row) => {
  const value = Number(row.totalTokens);
  return Number.isFinite(value) ? sum + value : sum;
}, 0);

console.log(`OpenAI usage report (${lookbackHours}h)`);
console.log(`rows=${rows.length} totalCalls=${totalCalls} totalTokens=${totalTokens}`);
console.log("");

console.log("Top prompts by total tokens:");
console.table(promptRows.slice(0, 20));

console.log("Call count per endpoint:");
console.table(endpointRows);
