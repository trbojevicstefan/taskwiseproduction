import { spawnSync } from "node:child_process";
import path from "node:path";

export const CHAT_RAG_EVAL_CASE_IDS = [
  "serbian-and-english-routing",
  "all-meeting-comparison",
  "meeting-confinement",
  "same-name-client-person-collision",
  "person-task-ownership",
  "planner-deadlines",
  "contradictory-meetings",
  "no-evidence-abstention",
  "long-thread-reference",
  "repeated-tool-call-stop",
  "cross-workspace-denial",
  "ambiguous-multi-task-zero-write",
] as const;

export const runChatRagEval = (): number => {
  const jestBin = path.join(process.cwd(), "node_modules", "jest", "bin", "jest.js");
  const result = spawnSync(
    process.execPath,
    [jestBin, "--runInBand", "src/lib/chat-rag-eval.test.ts"],
    {
      cwd: process.cwd(),
      env: { ...process.env, NODE_ENV: "test" },
      stdio: "inherit",
    }
  );
  if (result.error) {
    console.error(`Chat RAG eval could not start: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
};

const invokedPath = process.argv[1] || "";
if (/(?:^|[\\/])eval-chat-rag\.(?:ts|js)$/.test(invokedPath)) {
  process.exitCode = runChatRagEval();
}
