#!/usr/bin/env node
const dotenv = require("dotenv");
const { MongoClient } = require("mongodb");

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || "taskwise";
const apply = process.argv.includes("--apply");
const sampleLimitArg = process.argv.find((arg) => arg.startsWith("--sample="));
const sampleLimit = Number.parseInt(sampleLimitArg?.split("=")[1] || "10", 10);

if (!uri) {
  console.error("MONGODB_URI is not set. Update your .env.local/.env first.");
  process.exit(1);
}

const getSummary = async (collection) => {
  const pipeline = [
    { $match: { taskId: { $type: "string", $ne: "" } } },
    { $sort: { updatedAt: -1, createdAt: -1, _id: 1 } },
    {
      $group: {
        _id: {
          userId: "$userId",
          workspaceId: "$workspaceId",
          boardId: "$boardId",
          taskId: "$taskId",
        },
        ids: { $push: "$_id" },
        count: { $sum: 1 },
      },
    },
    { $match: { count: { $gt: 1 } } },
  ];

  const cursor = collection.aggregate(pipeline, { allowDiskUse: true });
  let groupCount = 0;
  let duplicateDocCount = 0;
  const samples = [];

  for await (const row of cursor) {
    groupCount += 1;
    const duplicateIds = (row.ids || []).slice(1);
    duplicateDocCount += duplicateIds.length;
    if (samples.length < Math.max(0, sampleLimit)) {
      samples.push({
        key: row._id,
        keepId: row.ids?.[0],
        duplicateIds,
      });
    }
  }

  return { groupCount, duplicateDocCount, samples };
};

const run = async () => {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);
  const boardItems = db.collection("boardItems");
  const mode = apply ? "APPLY" : "DRY RUN";

  console.log(`Connected to '${dbName}' (${mode}).`);
  console.log("Step 1/2: normalizing taskId from taskCanonicalId where available...");

  const canonicalFilter = {
    taskCanonicalId: { $type: "string", $ne: "" },
    $expr: { $ne: ["$taskId", "$taskCanonicalId"] },
  };

  const canonicalCount = await boardItems.countDocuments(canonicalFilter);
  if (!canonicalCount) {
    console.log("  No taskId normalization needed.");
  } else if (!apply) {
    console.log(`  [DRY] ${canonicalCount} document(s) will update taskId = taskCanonicalId.`);
  } else {
    const normalizeResult = await boardItems.updateMany(canonicalFilter, [
      { $set: { taskId: "$taskCanonicalId" } },
    ]);
    console.log(
      `  [APPLY] normalized taskId fields: matched=${normalizeResult.matchedCount} modified=${normalizeResult.modifiedCount}`
    );
  }

  console.log("Step 2/2: scanning duplicate board projections...");
  const before = await getSummary(boardItems);
  console.log(
    `  Found ${before.groupCount} duplicate key group(s) and ${before.duplicateDocCount} extra document(s).`
  );

  if (before.samples.length) {
    console.log("  Sample duplicates:");
    before.samples.forEach((sample, index) => {
      console.log(
        `    [${index + 1}] key=${JSON.stringify(sample.key)} keep=${sample.keepId} drop=${JSON.stringify(
          sample.duplicateIds
        )}`
      );
    });
  }

  if (!apply) {
    console.log("Dry run complete. Re-run with --apply to delete duplicate records.");
    await client.close();
    return;
  }

  if (!before.groupCount) {
    console.log("No duplicate board item projections found.");
    await client.close();
    return;
  }

  let deleted = 0;
  const duplicateCursor = boardItems.aggregate(
    [
      { $match: { taskId: { $type: "string", $ne: "" } } },
      { $sort: { updatedAt: -1, createdAt: -1, _id: 1 } },
      {
        $group: {
          _id: {
            userId: "$userId",
            workspaceId: "$workspaceId",
            boardId: "$boardId",
            taskId: "$taskId",
          },
          ids: { $push: "$_id" },
          count: { $sum: 1 },
        },
      },
      { $match: { count: { $gt: 1 } } },
    ],
    { allowDiskUse: true }
  );

  for await (const row of duplicateCursor) {
    const duplicateIds = (row.ids || []).slice(1);
    if (!duplicateIds.length) continue;
    const result = await boardItems.deleteMany({ _id: { $in: duplicateIds } });
    deleted += result.deletedCount || 0;
  }

  const after = await getSummary(boardItems);
  console.log(`Deleted ${deleted} duplicate board item document(s).`);
  console.log(
    `Post-cleanup duplicate summary: groups=${after.groupCount}, extraDocs=${after.duplicateDocCount}.`
  );
  if (after.groupCount > 0) {
    console.warn(
      "Some duplicate groups remain. Re-run migration and inspect sample keys before applying unique index."
    );
  } else {
    console.log(
      "Cleanup complete. You can now apply indexes with: npm run db:indexes:perf"
    );
  }

  await client.close();
};

run().catch((error) => {
  console.error("Board item dedupe failed:", error);
  process.exit(1);
});
