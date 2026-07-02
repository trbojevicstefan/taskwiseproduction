import { ensureMeetingRecordingHashIndex } from "@/lib/fathom-ingest/deduplication";

describe("fathom-ingest/deduplication", () => {
  it("creates the ingest dedupe indexes once", async () => {
    const createIndex = jest
      .fn()
      .mockResolvedValue(undefined)
      .mockResolvedValue(undefined)
      .mockResolvedValue(undefined)
      .mockResolvedValue(undefined);
    const db = {
      collection: jest.fn(() => ({
        createIndex,
      })),
    } as any;

    await ensureMeetingRecordingHashIndex(db);
    await ensureMeetingRecordingHashIndex(db);

    expect(db.collection).toHaveBeenCalledWith("meetings");
    expect(createIndex).toHaveBeenCalledTimes(4);
    expect(createIndex).toHaveBeenNthCalledWith(
      1,
      { userId: 1, recordingIdHash: 1 },
      expect.objectContaining({
        unique: true,
        name: "meetings_user_recording_hash_unique",
      })
    );
    expect(createIndex).toHaveBeenNthCalledWith(
      2,
      { userId: 1, recordingIdHashes: 1 },
      expect.objectContaining({
        name: "meetings_user_recording_hashes_idx",
        sparse: true,
      })
    );
    expect(createIndex).toHaveBeenNthCalledWith(
      3,
      { userId: 1, workspaceId: 1, startTime: -1, ingestSource: 1 },
      expect.objectContaining({
        name: "meetings_user_workspace_start_ingest_idx",
      })
    );
    expect(createIndex).toHaveBeenNthCalledWith(
      4,
      { userId: 1, dedupeFingerprints: 1 },
      expect.objectContaining({
        name: "meetings_user_dedupe_fingerprints_idx",
        sparse: true,
      })
    );
  });
});
