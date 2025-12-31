const dotenv = require("dotenv");
const { MongoClient } = require("mongodb");
const { randomUUID } = require("crypto");

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || "taskwise";

if (!uri) {
  console.error("MONGODB_URI is not set. Update your .env.local first.");
  process.exit(1);
}

const buildWorkspaceName = (user) => {
  if (user.workspace && user.workspace.name) {
    return user.workspace.name;
  }
  if (user.name) {
    return `${user.name}'s Workspace`;
  }
  if (user.email) {
    return `${user.email.split("@")[0]}'s Workspace`;
  }
  return "My Workspace";
};

const run = async () => {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);
  const users = await db.collection("users").find({}).toArray();

  let updated = 0;

  for (const user of users) {
    const hasWorkspaceId = Boolean(user.workspace && user.workspace.id);
    const workspaceId = hasWorkspaceId ? user.workspace.id : randomUUID();
    const workspaceName = buildWorkspaceName(user);

    if (!hasWorkspaceId || !user.workspace?.name) {
      await db.collection("users").updateOne(
        { _id: user._id },
        {
          $set: {
            workspace: { id: workspaceId, name: workspaceName },
            lastUpdated: new Date(),
          },
        }
      );
      updated += 1;
      console.log(`Updated user ${user.email || user._id} -> workspace ${workspaceId}`);
    }
  }

  console.log(`Done. Updated ${updated} user(s).`);
  await client.close();
};

run().catch((error) => {
  console.error("Workspace seed failed:", error);
  process.exit(1);
});
