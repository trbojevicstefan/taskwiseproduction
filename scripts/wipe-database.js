const dotenv = require("dotenv");
const { MongoClient } = require("mongodb");

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || "taskwise";
const safeDbNames = new Set(["admin", "local", "config"]);

if (!uri) {
  console.error("MONGODB_URI is not set. Update your .env.local first.");
  process.exit(1);
}

if (safeDbNames.has(dbName)) {
  console.error(`Refusing to drop protected database "${dbName}".`);
  process.exit(1);
}

const hasConfirmFlag = process.argv.includes("--yes") || process.argv.includes("--confirm");
const hasConfirmEnv = process.env.WIPE_DB === "1";

if (!hasConfirmFlag && !hasConfirmEnv) {
  console.error(
    [
      "Database wipe aborted.",
      `Target database: "${dbName}"`,
      "Re-run with --yes or set WIPE_DB=1 to confirm.",
    ].join("\n")
  );
  process.exit(1);
}

const run = async () => {
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db(dbName);
    const result = await db.dropDatabase();
    console.log(`Dropped database "${dbName}".`, result);
  } finally {
    await client.close();
  }
};

run().catch((error) => {
  console.error("Failed to drop database:", error);
  process.exit(1);
});
