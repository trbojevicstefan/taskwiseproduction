#!/usr/bin/env node
const dotenv = require("dotenv");
const { MongoClient } = require("mongodb");

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || "taskwise";
const apply = process.argv.includes("--apply");
const workspaceArg = process.argv.find((arg) => arg.startsWith("--workspace="));
const userArg = process.argv.find((arg) => arg.startsWith("--user="));
const sampleArg = process.argv.find((arg) => arg.startsWith("--sample="));
const sampleLimit = Math.max(
  1,
  Number.parseInt((sampleArg && sampleArg.split("=")[1]) || "10", 10)
);

if (!uri) {
  console.error("MONGODB_URI is not set. Update .env.local/.env first.");
  process.exit(1);
}

const workspaceIdFilter = workspaceArg ? String(workspaceArg.split("=")[1] || "").trim() : "";
const userIdFilter = userArg ? String(userArg.split("=")[1] || "").trim() : "";

const ATTENDEE_OVERLAP_MIN = Math.min(
  1,
  Math.max(
    0,
    Number(process.env.FATHOM_CROSS_NOTETAKER_ATTENDEE_OVERLAP_MIN || 0.5)
  )
);
const START_BUCKET_MS = 5 * 60 * 1000;
const START_DIFF_FALLBACK_MS = 90 * 1000;
const DURATION_DIFF_FALLBACK_SECONDS = 120;

const toDateOrNull = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const toNumberOrNull = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const normalizeTitleKey = (value) => {
  if (typeof value !== "string") return null;
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || null;
};

const normalizeUrlKey = (value) => {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    parsed.hash = "";
    const path = parsed.pathname.replace(/\/+$/, "");
    const search = parsed.searchParams.toString();
    return `${parsed.protocol}//${parsed.host}${path || "/"}${
      search ? `?${search}` : ""
    }`.toLowerCase();
  } catch {
    return raw.replace(/\/+$/, "").toLowerCase();
  }
};

const normalizeAttendeeKey = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;
  if (raw.includes("@")) return raw.toLowerCase();
  const normalized = raw
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || null;
};

const collectAttendeeKeys = (values) => {
  const set = new Set();
  const visit = (value) => {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value === "string" || typeof value === "number") {
      const key = normalizeAttendeeKey(value);
      if (key) set.add(key);
      return;
    }
    if (typeof value === "object") {
      [value.name, value.fullName, value.full_name, value.displayName, value.email].forEach(
        (candidate) => {
          const key = normalizeAttendeeKey(candidate);
          if (key) set.add(key);
        }
      );
    }
  };
  visit(values);
  return Array.from(set);
};

const attendeeOverlapRatio = (a, b) => {
  if (!a.length || !b.length) return 0;
  const aSet = new Set(a);
  const bSet = new Set(b);
  let intersection = 0;
  aSet.forEach((key) => {
    if (bSet.has(key)) intersection += 1;
  });
  return intersection / Math.min(aSet.size, bSet.size);
};

const meetingCompletenessScore = (meeting) => {
  const tasksCount = Array.isArray(meeting.extractedTasks) ? meeting.extractedTasks.length : 0;
  const transcriptScore =
    typeof meeting.originalTranscript === "string" && meeting.originalTranscript.trim()
      ? 100
      : 0;
  const summaryScore =
    typeof meeting.summary === "string" && meeting.summary.trim() ? 10 : 0;
  const attendeeScore = collectAttendeeKeys(meeting.attendees || []).length;
  const activityTime = toDateOrNull(meeting.lastActivityAt || meeting.createdAt);
  const activityScore = activityTime ? activityTime.getTime() / 1_000_000_000_000 : 0;
  return tasksCount * 20 + transcriptScore + summaryScore + attendeeScore + activityScore;
};

const shouldMergeMeetings = (canonical, candidate) => {
  const canonicalShareUrl = normalizeUrlKey(canonical.shareUrl);
  const candidateShareUrl = normalizeUrlKey(candidate.shareUrl);
  if (canonicalShareUrl && candidateShareUrl && canonicalShareUrl === candidateShareUrl) {
    return true;
  }

  const canonicalRecordingUrl = normalizeUrlKey(canonical.recordingUrl);
  const candidateRecordingUrl = normalizeUrlKey(candidate.recordingUrl);
  if (
    canonicalRecordingUrl &&
    candidateRecordingUrl &&
    canonicalRecordingUrl === candidateRecordingUrl
  ) {
    return true;
  }

  const canonicalAttendees = collectAttendeeKeys(canonical.attendees || []);
  const candidateAttendees = collectAttendeeKeys(candidate.attendees || []);
  if (canonicalAttendees.length && candidateAttendees.length) {
    return attendeeOverlapRatio(canonicalAttendees, candidateAttendees) >= ATTENDEE_OVERLAP_MIN;
  }

  const canonicalStart = toDateOrNull(canonical.startTime);
  const candidateStart = toDateOrNull(candidate.startTime);
  const canonicalDuration = toNumberOrNull(canonical.duration);
  const candidateDuration = toNumberOrNull(candidate.duration);

  if (!canonicalStart || !candidateStart) return false;
  if (Math.abs(canonicalStart.getTime() - candidateStart.getTime()) > START_DIFF_FALLBACK_MS) {
    return false;
  }
  if (canonicalDuration === null || candidateDuration === null) return false;
  return (
    Math.abs(canonicalDuration - candidateDuration) <= DURATION_DIFF_FALLBACK_SECONDS
  );
};

const buildCandidateGroupKey = (meeting) => {
  const userId = String(meeting.userId || "");
  const workspaceId = String(meeting.workspaceId || "");
  const titleKey = normalizeTitleKey(meeting.title);
  const startTime = toDateOrNull(meeting.startTime);
  if (!userId || !titleKey || !startTime) return null;
  const bucket = Math.floor(startTime.getTime() / START_BUCKET_MS);
  const durationBucket = Math.round((toNumberOrNull(meeting.duration) || 0) / 60);
  return `${userId}|${workspaceId}|${titleKey}|${bucket}|${durationBucket}`;
};

const gatherHashes = (meeting) => {
  const values = [];
  if (typeof meeting.recordingIdHash === "string" && meeting.recordingIdHash.trim()) {
    values.push(meeting.recordingIdHash.trim());
  }
  if (Array.isArray(meeting.recordingIdHashes)) {
    meeting.recordingIdHashes.forEach((value) => {
      if (typeof value === "string" && value.trim()) values.push(value.trim());
    });
  }
  return Array.from(new Set(values));
};

const gatherFingerprints = (meeting) => {
  const values = [];
  if (Array.isArray(meeting.dedupeFingerprints)) {
    meeting.dedupeFingerprints.forEach((value) => {
      if (typeof value === "string" && value.trim()) values.push(value.trim());
    });
  }
  return Array.from(new Set(values));
};

const sortByCompleteness = (meetings) =>
  [...meetings].sort((a, b) => meetingCompletenessScore(b) - meetingCompletenessScore(a));

const clusterDuplicates = (meetings) => {
  const sorted = sortByCompleteness(meetings);
  const clusters = [];

  sorted.forEach((meeting) => {
    let matchedCluster = null;
    for (const cluster of clusters) {
      if (shouldMergeMeetings(cluster.canonical, meeting)) {
        matchedCluster = cluster;
        break;
      }
    }

    if (!matchedCluster) {
      clusters.push({ canonical: meeting, duplicates: [] });
      return;
    }
    matchedCluster.duplicates.push(meeting);
  });

  return clusters.filter((cluster) => cluster.duplicates.length > 0);
};

const applyClusterMerge = async (db, cluster) => {
  const meetings = db.collection("meetings");
  const planningSessions = db.collection("planningSessions");
  const chatSessions = db.collection("chatSessions");
  const tasks = db.collection("tasks");

  const canonical = cluster.canonical;
  const duplicateIds = cluster.duplicates.map((meeting) => String(meeting._id));
  const canonicalId = String(canonical._id);

  const mergedHashes = Array.from(
    new Set([
      ...gatherHashes(canonical),
      ...cluster.duplicates.flatMap((meeting) => gatherHashes(meeting)),
    ])
  );
  const mergedFingerprints = Array.from(
    new Set([
      ...gatherFingerprints(canonical),
      ...cluster.duplicates.flatMap((meeting) => gatherFingerprints(meeting)),
    ])
  );

  const mergedProviderSourceId =
    canonical.providerSourceId ||
    cluster.duplicates.find((meeting) => meeting.providerSourceId)?.providerSourceId ||
    null;

  await meetings.updateOne(
    { _id: canonicalId },
    {
      $set: {
        recordingIdHash: mergedHashes[0] || canonical.recordingIdHash || null,
        recordingIdHashes: mergedHashes,
        dedupeFingerprints: mergedFingerprints,
        providerSourceId: mergedProviderSourceId,
        updatedAt: new Date(),
      },
      $addToSet: {
        mergedDuplicateMeetingIds: { $each: duplicateIds },
      },
    }
  );

  await Promise.all([
    planningSessions.updateMany(
      { sourceMeetingId: { $in: duplicateIds } },
      { $set: { sourceMeetingId: canonicalId, lastActivityAt: new Date() } }
    ),
    chatSessions.updateMany(
      { sourceMeetingId: { $in: duplicateIds } },
      { $set: { sourceMeetingId: canonicalId, lastActivityAt: new Date() } }
    ),
    tasks.updateMany(
      {
        sourceSessionType: "meeting",
        sourceSessionId: { $in: duplicateIds },
      },
      { $set: { sourceSessionId: canonicalId, lastUpdated: new Date() } }
    ),
  ]);

  await meetings.updateMany(
    { _id: { $in: duplicateIds } },
    {
      $set: {
        isHidden: true,
        mergedIntoMeetingId: canonicalId,
        duplicateCleanupAt: new Date(),
        lastActivityAt: new Date(),
      },
    }
  );

  return {
    canonicalId,
    duplicateIds,
  };
};

const run = async () => {
  const mode = apply ? "APPLY" : "DRY RUN";
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);
  const meetings = db.collection("meetings");

  const baseFilter = {
    ingestSource: "fathom",
    isHidden: { $ne: true },
    title: { $type: "string", $ne: "" },
    startTime: { $type: "date" },
    ...(workspaceIdFilter ? { workspaceId: workspaceIdFilter } : {}),
    ...(userIdFilter ? { userId: userIdFilter } : {}),
  };

  console.log(`Connected to '${dbName}' (${mode}).`);
  console.log(
    `Scanning meetings with filter: workspace=${workspaceIdFilter || "*"} user=${userIdFilter || "*"}`
  );

  const rows = await meetings
    .find(baseFilter)
    .project({
      _id: 1,
      userId: 1,
      workspaceId: 1,
      title: 1,
      startTime: 1,
      endTime: 1,
      duration: 1,
      attendees: 1,
      shareUrl: 1,
      recordingUrl: 1,
      providerSourceId: 1,
      dedupeFingerprints: 1,
      recordingIdHash: 1,
      recordingIdHashes: 1,
      extractedTasks: 1,
      originalTranscript: 1,
      summary: 1,
      createdAt: 1,
      lastActivityAt: 1,
    })
    .toArray();

  const grouped = new Map();
  rows.forEach((meeting) => {
    const key = buildCandidateGroupKey(meeting);
    if (!key) return;
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key).push(meeting);
  });

  const candidateGroups = Array.from(grouped.values()).filter((group) => group.length > 1);
  let duplicateClusters = [];
  candidateGroups.forEach((group) => {
    duplicateClusters = duplicateClusters.concat(clusterDuplicates(group));
  });

  const duplicateDocCount = duplicateClusters.reduce(
    (sum, cluster) => sum + cluster.duplicates.length,
    0
  );

  console.log(
    `Found ${candidateGroups.length} candidate group(s), ${duplicateClusters.length} merge cluster(s), ${duplicateDocCount} duplicate meeting doc(s).`
  );

  if (duplicateClusters.length) {
    console.log("Sample clusters:");
    duplicateClusters.slice(0, sampleLimit).forEach((cluster, index) => {
      console.log(
        `  [${index + 1}] canonical=${cluster.canonical._id} title="${cluster.canonical.title}" start=${cluster.canonical.startTime?.toISOString?.() || cluster.canonical.startTime} duplicates=${cluster.duplicates
          .map((meeting) => String(meeting._id))
          .join(",")}`
      );
    });
  }

  if (!apply) {
    console.log("Dry run complete. Re-run with --apply to merge and hide duplicates.");
    await client.close();
    return;
  }

  let mergedClusters = 0;
  let hiddenDuplicates = 0;
  for (const cluster of duplicateClusters) {
    const result = await applyClusterMerge(db, cluster);
    mergedClusters += 1;
    hiddenDuplicates += result.duplicateIds.length;
  }

  console.log(
    `Applied cleanup: mergedClusters=${mergedClusters} hiddenDuplicateDocs=${hiddenDuplicates}.`
  );

  const remaining = await meetings.countDocuments(baseFilter);
  const stillVisible = await meetings.countDocuments({
    ...baseFilter,
    mergedIntoMeetingId: { $exists: true },
    isHidden: { $ne: true },
  });
  console.log(
    `Post-cleanup visible meetings in scope: ${remaining}. Unexpected visible merged docs: ${stillVisible}.`
  );

  await client.close();
};

run().catch((error) => {
  console.error("cleanup-fathom-meeting-duplicates failed:", error);
  process.exit(1);
});

