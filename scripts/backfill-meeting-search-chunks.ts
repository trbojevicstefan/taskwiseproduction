/**
 * Backfill `meetingSearchChunks` (semantic meeting search embeddings) for
 * existing meetings. Thin runner around `backfillMeetingSearchChunks`
 * (src/lib/meeting-search-chunks.ts) — chunking, embedding, and idempotency
 * live in the lib module.
 *
 * Usage (add npm scripts as desired, e.g.
 *   "search:chunks:backfill:dry": "npx tsx scripts/backfill-meeting-search-chunks.ts",
 *   "search:chunks:backfill:apply": "npx tsx scripts/backfill-meeting-search-chunks.ts --apply"):
 *
 *   npx tsx scripts/backfill-meeting-search-chunks.ts              # dry-run (default)
 *   npx tsx scripts/backfill-meeting-search-chunks.ts --apply      # write chunks
 *   npx tsx scripts/backfill-meeting-search-chunks.ts --limit=200  # cap scanned meetings
 *
 * Requirements:
 *   - MONGODB_URI (+ optional MONGODB_DB, default "taskwise") in env/.env.local
 *   - OPENAI_API_KEY for --apply (dry-run needs no key)
 *   - Optional: OPENAI_EMBEDDINGS_MODEL / OPENAI_EMBEDDINGS_URL overrides
 *
 * Idempotent: unchanged meetings are skipped via a content sourceHash and
 * re-indexing uses deterministic chunk ids with delete-then-insert, so
 * running twice never duplicates chunks. Logs scanned / inserted / updated /
 * skipped / errors counts.
 */

import dotenv from "dotenv";
import { MongoClient } from "mongodb";
import { backfillMeetingSearchChunks } from "../src/lib/meeting-search-chunks";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || "taskwise";

const parseArgs = (argv: string[]) => {
  const apply = argv.includes("--apply");
  const limitArg = argv.find((arg) => arg.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.split("=")[1]) : 0;
  return { apply, limit: Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 0 };
};

const main = async () => {
  if (!uri) {
    throw new Error("MONGODB_URI is not set.");
  }
  const { apply, limit } = parseArgs(process.argv.slice(2));

  console.log(
    `Backfilling meetingSearchChunks in DB "${dbName}" (${apply ? "APPLY" : "dry-run"}${limit ? `, limit=${limit}` : ""})...`
  );
  if (!apply) {
    console.log("Dry-run: no embeddings will be requested and nothing will be written.");
  }

  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db(dbName);
    const counts = await backfillMeetingSearchChunks(db as any, {
      apply,
      limit,
      log: (message) => console.log(`  ${message}`),
    });
    console.log(
      `Done. scanned=${counts.scanned} inserted=${counts.inserted} updated=${counts.updated} skipped=${counts.skipped} errors=${counts.errors}`
    );
    if (counts.errors > 0) {
      process.exitCode = 1;
    }
  } finally {
    await client.close();
  }
};

main().catch((error) => {
  console.error("Backfill failed:", error);
  process.exitCode = 1;
});
