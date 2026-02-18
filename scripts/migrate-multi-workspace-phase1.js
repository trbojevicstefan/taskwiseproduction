#!/usr/bin/env node
const dotenv = require("dotenv");
const { MongoClient } = require("mongodb");
const { randomUUID } = require("crypto");

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || "taskwise";
const apply = process.argv.includes("--apply");
const verbose = process.argv.includes("--verbose");
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const limit = limitArg ? Number.parseInt(limitArg.split("=")[1], 10) : null;

if (!uri) {
  console.error("MONGODB_URI is not set. Update your .env.local/.env first.");
  process.exit(1);
}

const asNonEmptyString = (value) => {
  if (value === null || value === undefined) return null;
  const asString = String(value).trim();
  return asString || null;
};

const buildWorkspaceName = (user) => {
  const explicit = asNonEmptyString(user?.workspace?.name);
  if (explicit) return explicit;
  const displayName = asNonEmptyString(user?.name);
  if (displayName) return `${displayName}'s Workspace`;
  const emailLocal = asNonEmptyString(user?.email)?.split("@")?.[0];
  if (emailLocal) return `${emailLocal}'s Workspace`;
  return "My Workspace";
};

const resolveUserId = (user) =>
  asNonEmptyString(user?._id?.toString?.()) ||
  asNonEmptyString(user?.id) ||
  asNonEmptyString(user?.uid) ||
  null;

const buildUserLookupFilter = (user, userId) => {
  if (user?._id) return { _id: user._id };
  if (asNonEmptyString(user?.id)) return { id: user.id };
  return { _id: userId };
};

const withDryRun = async (isDryRun, action, executor) => {
  if (isDryRun) return action;
  await executor();
  return action;
};

const run = async () => {
  const startedAt = Date.now();
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);
  const usersCollection = db.collection("users");
  const workspacesCollection = db.collection("workspaces");
  const membershipsCollection = db.collection("workspaceMemberships");
  const dryRun = !apply;

  const counters = {
    mode: dryRun ? "dry-run" : "apply",
    usersScanned: 0,
    usersSkippedNoIdentifier: 0,
    usersSkippedNoWorkspaceId: 0,
    malformedLegacyWorkspaceData: 0,
    workspacesCreated: 0,
    membershipsCreated: 0,
    membershipsReactivated: 0,
    membershipsRoleAligned: 0,
    usersSynced: 0,
    conflictsRepaired: 0,
    errors: 0,
  };

  const cursor = usersCollection
    .find({})
    .project({
      _id: 1,
      id: 1,
      uid: 1,
      email: 1,
      name: 1,
      workspace: 1,
      activeWorkspaceId: 1,
    });

  if (Number.isFinite(limit) && limit > 0) {
    cursor.limit(limit);
  }

  for await (const user of cursor) {
    counters.usersScanned += 1;
    try {
      const userId = resolveUserId(user);
      if (!userId) {
        counters.usersSkippedNoIdentifier += 1;
        if (verbose) {
          console.warn(`[skip] user ${String(user?._id || "unknown")} has no resolvable identifier`);
        }
        continue;
      }

      const legacyWorkspaceId =
        asNonEmptyString(user?.workspace?.id) || asNonEmptyString(user?.activeWorkspaceId);
      if (!legacyWorkspaceId) {
        counters.usersSkippedNoWorkspaceId += 1;
        if (verbose) {
          console.warn(`[skip] user ${userId} has no legacy workspace id`);
        }
        continue;
      }

      if (!asNonEmptyString(user?.workspace?.id) || !asNonEmptyString(user?.workspace?.name)) {
        counters.malformedLegacyWorkspaceData += 1;
      }

      const legacyWorkspaceName = buildWorkspaceName(user);
      let workspace = await workspacesCollection.findOne({ _id: legacyWorkspaceId });
      if (!workspace) {
        workspace = {
          _id: legacyWorkspaceId,
          name: legacyWorkspaceName,
          slug: null,
          createdByUserId: userId,
          createdAt: new Date(),
          updatedAt: new Date(),
          status: "active",
          settings: null,
        };
        await withDryRun(
          dryRun,
          `create workspace ${legacyWorkspaceId}`,
          async () => workspacesCollection.insertOne(workspace)
        );
        counters.workspacesCreated += 1;
      }

      const existingMembership = await membershipsCollection.findOne({
        workspaceId: legacyWorkspaceId,
        userId,
      });
      if (!existingMembership) {
        const role = workspace.createdByUserId === userId ? "owner" : "member";
        const now = new Date();
        const membership = {
          _id: randomUUID(),
          workspaceId: legacyWorkspaceId,
          userId,
          role,
          status: "active",
          joinedAt: now,
          createdAt: now,
          updatedAt: now,
          invitedByUserId: null,
        };
        await withDryRun(
          dryRun,
          `create membership ${membership._id}`,
          async () => membershipsCollection.insertOne(membership)
        );
        counters.membershipsCreated += 1;
      } else {
        const shouldReactivate = existingMembership.status !== "active";
        const shouldAlignOwnerRole =
          existingMembership.status === "active" &&
          workspace.createdByUserId === userId &&
          existingMembership.role !== "owner";

        if (shouldReactivate || shouldAlignOwnerRole) {
          const nextRole = shouldAlignOwnerRole ? "owner" : existingMembership.role;
          await withDryRun(
            dryRun,
            `repair membership ${existingMembership._id}`,
            async () =>
              membershipsCollection.updateOne(
                { _id: existingMembership._id },
                {
                  $set: {
                    status: "active",
                    role: nextRole,
                    joinedAt: existingMembership.joinedAt || new Date(),
                    updatedAt: new Date(),
                  },
                }
              )
          );
          if (shouldReactivate) counters.membershipsReactivated += 1;
          if (shouldAlignOwnerRole) counters.membershipsRoleAligned += 1;
          counters.conflictsRepaired += 1;
        }
      }

      let desiredActiveWorkspaceId = asNonEmptyString(user?.activeWorkspaceId) || legacyWorkspaceId;
      if (desiredActiveWorkspaceId !== legacyWorkspaceId) {
        const hasActiveMembership = await membershipsCollection.findOne({
          workspaceId: desiredActiveWorkspaceId,
          userId,
          status: "active",
        });
        if (!hasActiveMembership) {
          desiredActiveWorkspaceId = legacyWorkspaceId;
          counters.conflictsRepaired += 1;
        }
      }

      let activeWorkspace = await workspacesCollection.findOne({ _id: desiredActiveWorkspaceId });
      if (!activeWorkspace || activeWorkspace.status === "deleted") {
        desiredActiveWorkspaceId = legacyWorkspaceId;
        activeWorkspace = workspace;
        counters.conflictsRepaired += 1;
      }

      const desiredWorkspaceSnapshot = {
        id: activeWorkspace._id,
        name: activeWorkspace.name || legacyWorkspaceName,
      };

      const shouldSyncUser =
        asNonEmptyString(user?.activeWorkspaceId) !== desiredActiveWorkspaceId ||
        asNonEmptyString(user?.workspace?.id) !== desiredWorkspaceSnapshot.id ||
        asNonEmptyString(user?.workspace?.name) !== desiredWorkspaceSnapshot.name;

      if (shouldSyncUser) {
        await withDryRun(
          dryRun,
          `sync user ${userId}`,
          async () =>
            usersCollection.updateOne(buildUserLookupFilter(user, userId), {
              $set: {
                activeWorkspaceId: desiredActiveWorkspaceId,
                workspace: desiredWorkspaceSnapshot,
                lastUpdated: new Date(),
              },
            })
        );
        counters.usersSynced += 1;
      }
    } catch (error) {
      counters.errors += 1;
      console.error(`[error] user ${String(user?._id || "unknown")}:`, error);
    }
  }

  counters.durationMs = Date.now() - startedAt;
  console.log(`Multi-workspace phase1 migration (${counters.mode}) complete.`);
  console.log(JSON.stringify(counters, null, 2));
  if (dryRun) {
    console.log("Dry run mode: no writes were applied. Re-run with --apply to persist changes.");
  }

  await client.close();
};

run().catch((error) => {
  console.error("Multi-workspace migration failed:", error);
  process.exit(1);
});
