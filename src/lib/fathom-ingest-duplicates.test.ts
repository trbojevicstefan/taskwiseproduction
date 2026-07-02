import { findCanonicalFathomDuplicate } from "@/lib/fathom-ingest-duplicates";

const makeCursor = (rows: any[]) => ({
  sort: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  toArray: jest.fn().mockResolvedValue(rows),
});

describe("fathom-ingest-duplicates", () => {
  it("returns a strong fingerprint match", async () => {
    const candidate = {
      _id: "meeting-1",
      ingestSource: "fathom",
      dedupeFingerprints: ["recording_url:https://example.com/meeting|t:1"],
    };
    const meetings = {
      find: jest.fn().mockReturnValue(makeCursor([candidate])),
    };
    const db = {
      collection: jest.fn((name: string) => {
        if (name === "meetings") return meetings;
        throw new Error(`Unexpected collection: ${name}`);
      }),
    };

    const result = await findCanonicalFathomDuplicate({
      db: db as any,
      userId: "user-1",
      workspaceId: "workspace-1",
      dedupeFingerprints: ["recording_url:https://example.com/meeting|t:1"],
      incomingAttendeeKeys: [],
      title: "Weekly Sync",
      startTime: new Date("2026-07-02T10:00:00.000Z"),
      durationSeconds: 1800,
    });

    expect(result).toBe(candidate);
    expect(meetings.find).toHaveBeenCalled();
  });

  it("falls back to title/time overlap when fingerprints do not match", async () => {
    const candidate = {
      _id: "meeting-2",
      ingestSource: "fathom",
      title: "Weekly Sync",
      startTime: new Date("2026-07-02T10:01:00.000Z"),
      attendees: [{ name: "Ada Lovelace" }],
    };
    const meetings = {
      find: jest
        .fn()
        .mockReturnValueOnce(makeCursor([]))
        .mockReturnValueOnce(makeCursor([candidate])),
    };
    const db = {
      collection: jest.fn((name: string) => {
        if (name === "meetings") return meetings;
        throw new Error(`Unexpected collection: ${name}`);
      }),
    };

    const result = await findCanonicalFathomDuplicate({
      db: db as any,
      userId: "user-1",
      workspaceId: "workspace-1",
      dedupeFingerprints: ["title:weekly sync|t:1"],
      incomingAttendeeKeys: ["ada lovelace"],
      title: "Weekly Sync",
      startTime: new Date("2026-07-02T10:00:00.000Z"),
      durationSeconds: 1800,
    });

    expect(result).toBe(candidate);
    expect(meetings.find).toHaveBeenCalledTimes(2);
  });

  it("returns null when there is nothing to compare", async () => {
    const db = {
      collection: jest.fn(() => ({
        find: jest.fn(),
      })),
    };

    const result = await findCanonicalFathomDuplicate({
      db: db as any,
      userId: "user-1",
      workspaceId: null,
      dedupeFingerprints: [],
      incomingAttendeeKeys: [],
      title: null,
      startTime: null,
      durationSeconds: null,
    });

    expect(result).toBeNull();
  });
});
