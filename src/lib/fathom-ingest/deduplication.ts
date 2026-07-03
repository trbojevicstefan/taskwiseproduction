let meetingRecordingHashIndexPromise: Promise<void> | null = null;

export const ensureMeetingRecordingHashIndex = async (db: any) => {
  if (meetingRecordingHashIndexPromise) {
    await meetingRecordingHashIndexPromise;
    return;
  }

  meetingRecordingHashIndexPromise = (async () => {
    const meetings = db.collection("meetings");
    if (!meetings || typeof meetings.createIndex !== "function") {
      return;
    }

    try {
      await meetings.createIndex(
        { userId: 1, recordingIdHash: 1 },
        {
          unique: true,
          name: "meetings_user_recording_hash_unique",
          partialFilterExpression: { recordingIdHash: { $type: "string" } },
        }
      );
    } catch (error) {
      // Keep ingestion available even if index creation fails (e.g. existing dupes).
      console.warn("Failed to ensure meeting recording hash unique index:", error);
    }

    try {
      await meetings.createIndex(
        { userId: 1, recordingIdHashes: 1 },
        {
          name: "meetings_user_recording_hashes_idx",
          sparse: true,
          partialFilterExpression: { recordingIdHashes: { $exists: true } },
        }
      );
    } catch (error) {
      console.warn("Failed to ensure meeting recording hash aliases index:", error);
    }

    try {
      await meetings.createIndex(
        { userId: 1, workspaceId: 1, startTime: -1, ingestSource: 1 },
        { name: "meetings_user_workspace_start_ingest_idx" }
      );
    } catch (error) {
      console.warn("Failed to ensure meeting start-time dedupe index:", error);
    }

    try {
      await meetings.createIndex(
        { userId: 1, dedupeFingerprints: 1 },
        {
          name: "meetings_user_dedupe_fingerprints_idx",
          sparse: true,
          partialFilterExpression: { dedupeFingerprints: { $exists: true } },
        }
      );
    } catch (error) {
      console.warn("Failed to ensure meeting dedupe fingerprint index:", error);
    }
  })();

  await meetingRecordingHashIndexPromise;
};
