#!/usr/bin/env node
const dotenv = require("dotenv");
const { MongoClient } = require("mongodb");

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || "taskwise";
const apply = process.argv.includes("--apply");

if (!uri) {
  console.error("MONGODB_URI is not set. Update your .env.local/.env first.");
  process.exit(1);
}

const FIELD_MIGRATIONS = [
  { collection: "meetings", fields: ["userId", "chatSessionId", "planningSessionId"] },
  { collection: "chatSessions", fields: ["userId", "sourceMeetingId"] },
  { collection: "planningSessions", fields: ["userId", "sourceMeetingId"] },
  { collection: "tasks", fields: ["userId", "sourceSessionId", "parentId", "projectId"] },
  {
    collection: "boardItems",
    fields: ["userId", "boardId", "taskId", "taskCanonicalId", "statusId"],
  },
  { collection: "boardStatuses", fields: ["userId", "boardId"] },
  { collection: "boards", fields: ["userId", "workspaceId"] },
  { collection: "people", fields: ["userId"] },
  { collection: "folders", fields: ["userId"] },
  { collection: "projects", fields: ["userId"] },
  { collection: "fathomIntegrationLogs", fields: ["userId"] },
];

const run = async () => {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);
  const mode = apply ? "APPLY" : "DRY RUN";
  console.log(`Connected to '${dbName}' (${mode}).`);

  let totalMatched = 0;
  let totalModified = 0;

  for (const { collection, fields } of FIELD_MIGRATIONS) {
    const coll = db.collection(collection);
    for (const field of fields) {
      const filter = { [field]: { $type: "objectId" } };
      const count = await coll.countDocuments(filter);
      if (!count) continue;

      totalMatched += count;
      if (!apply) {
        console.log(`[DRY] ${collection}.${field}: ${count} document(s) require normalization`);
        continue;
      }

      const result = await coll.updateMany(filter, [
        { $set: { [field]: { $toString: `$${field}` } } },
      ]);
      totalModified += result.modifiedCount || 0;
      console.log(
        `[APPLY] ${collection}.${field}: matched=${result.matchedCount} modified=${result.modifiedCount}`
      );
    }
  }

  if (!totalMatched) {
    console.log("No legacy ObjectId reference fields found.");
  } else if (!apply) {
    console.log(`Dry run complete. ${totalMatched} field instances require normalization.`);
    console.log("Re-run with --apply to execute updates.");
  } else {
    console.log(`Migration complete. Modified ${totalModified} field instances.`);
  }

  await client.close();
};

run().catch((error) => {
  console.error("Identifier normalization failed:", error);
  process.exit(1);
});
