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
  const nextValue = String(value).trim();
  return nextValue || null;
};

const toDate = (value) => {
  if (!value) return null;
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
};

const resolveUserId = (user) =>
  asNonEmptyString(user?._id?.toString?.()) ||
  asNonEmptyString(user?.id) ||
  asNonEmptyString(user?.uid) ||
  null;

const resolveWorkspaceId = (user) =>
  asNonEmptyString(user?.activeWorkspaceId) || asNonEmptyString(user?.workspace?.id);

const buildBaseLabel = (user) => {
  const displayName = asNonEmptyString(user?.name);
  if (displayName) {
    return `${displayName} Fathom`;
  }
  const emailLocal = asNonEmptyString(user?.email)?.split("@")?.[0]?.trim();
  if (emailLocal) {
    return `${emailLocal} Fathom`;
  }
  return "Fathom";
};

const buildUniqueLabel = (connections, baseLabel, existingConnectionId = null) => {
  const normalizedBase = asNonEmptyString(baseLabel) || "Fathom";
  const takenLabels = new Set(
    connections
      .filter((connection) => connection._id !== existingConnectionId)
      .map((connection) => asNonEmptyString(connection.label))
      .filter(Boolean)
  );

  if (!takenLabels.has(normalizedBase)) {
    return normalizedBase;
  }

  let suffix = 2;
  while (takenLabels.has(`${normalizedBase} ${suffix}`)) {
    suffix += 1;
  }
  return `${normalizedBase} ${suffix}`;
};

const mapManagedWebhooks = (webhooks) => {
  if (!Array.isArray(webhooks)) {
    return [];
  }

  return webhooks.map((entry) => ({
    id: asNonEmptyString(entry?.id) || null,
    url: asNonEmptyString(entry?.url) || null,
    createdAt: toDate(entry?.createdAt) || asNonEmptyString(entry?.createdAt) || null,
    includeTranscript:
      typeof entry?.include_transcript === "boolean" ? entry.include_transcript : null,
    includeSummary:
      typeof entry?.include_summary === "boolean" ? entry.include_summary : null,
    includeActionItems:
      typeof entry?.include_action_items === "boolean" ? entry.include_action_items : null,
    includeCrmMatches:
      typeof entry?.include_crm_matches === "boolean" ? entry.include_crm_matches : null,
    triggeredFor: Array.isArray(entry?.triggered_for) ? entry.triggered_for : null,
  }));
};

const normalizeWorkspaceSettings = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return { ...value };
};

const run = async () => {
  const startedAt = Date.now();
  const client = new MongoClient(uri);
  await client.connect();

  const db = client.db(dbName);
  const usersCollection = db.collection("users");
  const workspacesCollection = db.collection("workspaces");
  const installationsCollection = db.collection("fathomInstallations");
  const connectionsCollection = db.collection("fathomConnections");
  const dryRun = !apply;

  const counters = {
    mode: dryRun ? "dry-run" : "apply",
    usersScanned: 0,
    usersSkippedNoId: 0,
    usersSkippedNoWorkspace: 0,
    usersSkippedNoLegacyState: 0,
    connectionsCreated: 0,
    connectionsUpdated: 0,
    workspacesPreferredUpdated: 0,
    errors: 0,
  };

  const installations = await installationsCollection.find({}).toArray();
  const installationsByUserId = new Map(
    installations
      .map((installation) => [asNonEmptyString(installation.userId || installation._id), installation])
      .filter(([userId]) => Boolean(userId))
  );

  const userFilter = {
    $or: [
      { fathomConnected: true },
      { fathomWebhookToken: { $type: "string" } },
      { fathomUserId: { $ne: null } },
      { _id: { $in: installations.map((installation) => installation._id).filter(Boolean) } },
    ],
  };

  const cursor = usersCollection.find(userFilter).project({
    _id: 1,
    id: 1,
    uid: 1,
    email: 1,
    name: 1,
    workspace: 1,
    activeWorkspaceId: 1,
    fathomConnected: 1,
    fathomWebhookToken: 1,
    fathomUserId: 1,
    createdAt: 1,
    lastUpdated: 1,
  });

  if (Number.isFinite(limit) && limit > 0) {
    cursor.limit(limit);
  }

  for await (const user of cursor) {
    counters.usersScanned += 1;

    try {
      const userId = resolveUserId(user);
      if (!userId) {
        counters.usersSkippedNoId += 1;
        continue;
      }

      const workspaceId = resolveWorkspaceId(user);
      if (!workspaceId) {
        counters.usersSkippedNoWorkspace += 1;
        continue;
      }

      const installation = installationsByUserId.get(userId) || null;
      const hasLegacyState =
        Boolean(user?.fathomConnected) ||
        Boolean(asNonEmptyString(user?.fathomWebhookToken)) ||
        Boolean(asNonEmptyString(user?.fathomUserId)) ||
        Boolean(installation);
      if (!hasLegacyState) {
        counters.usersSkippedNoLegacyState += 1;
        continue;
      }

      const existingWorkspaceConnections = await connectionsCollection
        .find({ workspaceId })
        .toArray();
      const existingConnection =
        existingWorkspaceConnections.find((connection) => connection.legacyUserId === userId) ||
        existingWorkspaceConnections.find((connection) => connection.createdByUserId === userId) ||
        null;

      const label =
        existingConnection?.label ||
        buildUniqueLabel(existingWorkspaceConnections, buildBaseLabel(user), null);
      const managedWebhooks = mapManagedWebhooks(installation?.webhooks);
      const status =
        user?.fathomConnected || installation?.accessToken ? "active" : "error";
      const webhookStatus =
        asNonEmptyString(user?.fathomWebhookToken) ||
        asNonEmptyString(installation?.webhookId) ||
        asNonEmptyString(installation?.webhookUrl) ||
        managedWebhooks.length > 0
          ? "active"
          : "not_configured";

      const connectionId = existingConnection?._id || randomUUID();
      const now = new Date();
      const nextConnection = {
        _id: connectionId,
        workspaceId,
        provider: "fathom",
        label,
        status,
        createdByUserId: userId,
        updatedByUserId: userId,
        legacyUserId: userId,
        oauth: {
          accessToken: asNonEmptyString(installation?.accessToken) || null,
          refreshToken: asNonEmptyString(installation?.refreshToken) || null,
          expiresAt:
            typeof installation?.expiresAt === "number" ? installation.expiresAt : null,
          scope: asNonEmptyString(installation?.scope) || null,
          stateId: null,
          connectedAt:
            toDate(installation?.createdAt) || toDate(user?.createdAt) || null,
          lastRefreshedAt:
            toDate(installation?.updatedAt) || toDate(user?.lastUpdated) || null,
          lastError: null,
        },
        webhook: {
          token: asNonEmptyString(user?.fathomWebhookToken) || null,
          secret: asNonEmptyString(installation?.webhookSecret) || null,
          status: webhookStatus,
          webhookId: asNonEmptyString(installation?.webhookId) || null,
          webhookUrl: asNonEmptyString(installation?.webhookUrl) || null,
          webhookEvent: asNonEmptyString(installation?.webhookEvent) || null,
          managedWebhooks,
          lastSyncedAt:
            toDate(installation?.updatedAt) || toDate(user?.lastUpdated) || null,
          lastError: null,
        },
        source: {
          providerUserId:
            asNonEmptyString(installation?.fathomUserId) ||
            asNonEmptyString(user?.fathomUserId) ||
            null,
          providerAccountId: null,
          providerSourceIds: [],
        },
        sync: {
          lastAttemptedAt: null,
          lastSucceededAt:
            toDate(installation?.updatedAt) || toDate(user?.lastUpdated) || null,
          lastError: null,
        },
        migration: {
          migratedFromInstallationId: asNonEmptyString(installation?._id) || userId,
          dualReadUserId: userId,
        },
        createdAt:
          existingConnection?.createdAt ||
          toDate(installation?.createdAt) ||
          toDate(user?.createdAt) ||
          now,
        updatedAt: now,
        revokedAt: null,
      };

      if (existingConnection) {
        if (!dryRun) {
          await connectionsCollection.updateOne(
            { _id: existingConnection._id },
            { $set: { ...nextConnection, updatedAt: now } }
          );
        }
        counters.connectionsUpdated += 1;
      } else {
        if (!dryRun) {
          await connectionsCollection.insertOne(nextConnection);
        }
        counters.connectionsCreated += 1;
      }

      const workspace = await workspacesCollection.findOne({ _id: workspaceId });
      const preferredConnectionId =
        workspace?.settings?.integrations?.preferredFathomConnectionId || null;
      if (!preferredConnectionId && status === "active") {
        if (!dryRun) {
          const nextSettings = normalizeWorkspaceSettings(workspace?.settings);
          const nextIntegrations =
            nextSettings.integrations &&
            typeof nextSettings.integrations === "object" &&
            !Array.isArray(nextSettings.integrations)
              ? { ...nextSettings.integrations }
              : {};
          nextIntegrations.preferredFathomConnectionId = connectionId;
          nextSettings.integrations = nextIntegrations;
          await workspacesCollection.updateOne(
            { _id: workspaceId },
            {
              $set: {
                settings: nextSettings,
                updatedAt: now,
              },
            }
          );
        }
        counters.workspacesPreferredUpdated += 1;
      }

      if (verbose) {
        console.log(
          `[${dryRun ? "dry" : "apply"}] ${existingConnection ? "upsert" : "create"} ${userId} -> ${workspaceId} (${label})`
        );
      }
    } catch (error) {
      counters.errors += 1;
      console.error(`[error] user ${String(user?._id || "unknown")}:`, error);
    }
  }

  counters.durationMs = Date.now() - startedAt;
  console.log(`Legacy Fathom migration (${counters.mode}) complete.`);
  console.log(JSON.stringify(counters, null, 2));
  if (dryRun) {
    console.log("Dry run mode: no writes were applied. Re-run with --apply to persist changes.");
  }

  await client.close();
};

run().catch((error) => {
  console.error("Legacy Fathom migration failed:", error);
  process.exit(1);
});
