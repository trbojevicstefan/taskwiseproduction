import {
  backfillMeetingSearchChunks,
  buildMeetingSearchChunks,
  deleteMeetingSearchChunksForMeeting,
  indexMeetingSearchChunksForMeeting,
} from "@/lib/meeting-search-chunks";

jest.mock("@/lib/observability-metrics", () => ({
  recordExternalApiFailure: jest.fn(),
}));

const makeCursor = (docs: any[]) => {
  const cursor: any = {
    sort: jest.fn(() => cursor),
    limit: jest.fn(() => cursor),
    toArray: jest.fn(async () => docs),
  };
  return cursor;
};

/** In-memory fake for the meetingSearchChunks collection + meetings lookup. */
const makeDb = ({ meetings = [] as any[] } = {}) => {
  const chunks: any[] = [];
  const collections: Record<string, any> = {
    meetings: {
      findOne: jest.fn(async (filter: any) => {
        const ids = (filter?.$or || []).flatMap((clause: any) =>
          [clause._id, clause.id].filter(Boolean)
        );
        return (
          meetings.find((doc) => ids.map(String).includes(String(doc._id))) ??
          null
        );
      }),
      find: jest.fn(() => makeCursor(meetings)),
    },
    meetingSearchChunks: {
      deleteMany: jest.fn(async (filter: any) => {
        const before = chunks.length;
        for (let i = chunks.length - 1; i >= 0; i -= 1) {
          if (chunks[i].meetingId === filter.meetingId) chunks.splice(i, 1);
        }
        return { deletedCount: before - chunks.length };
      }),
      insertMany: jest.fn(async (docs: any[]) => {
        const existingIds = new Set(chunks.map((doc) => doc._id));
        for (const doc of docs) {
          if (existingIds.has(doc._id)) {
            const error: any = new Error("E11000 duplicate key error");
            error.code = 11000;
            throw error;
          }
        }
        chunks.push(...docs);
        return { insertedCount: docs.length };
      }),
      findOne: jest.fn(async (filter: any) => {
        return chunks.find((doc) => doc.meetingId === filter.meetingId) ?? null;
      }),
      countDocuments: jest.fn(async (filter: any) => {
        return chunks.filter((doc) => doc.meetingId === filter.meetingId).length;
      }),
    },
  };
  const db = {
    collection: jest.fn((name: string) => {
      const collection = collections[name];
      if (!collection) throw new Error(`Unexpected collection: ${name}`);
      return collection;
    }),
  } as any;
  return { db, chunks, collections };
};

const transcriptLine = (minute: number, speaker: string, text: string) =>
  `${minute}:00 - ${speaker}: ${text}`;

const buildMeeting = (overrides: Record<string, any> = {}): Record<string, any> => ({
  _id: "meeting-1",
  userId: "user-1",
  workspaceId: "ws-1",
  title: "Enterprise pricing sync",
  summary: "We agreed on per-seat pricing for the enterprise tier.",
  originalTranscript: [
    transcriptLine(0, "Stefan", "Welcome everyone to the sync."),
    transcriptLine(1, "Ana", "The enterprise tier should be priced per seat."),
    transcriptLine(2, "Stefan", "Agreed, let's finalize the proposal."),
  ].join("\n"),
  ...overrides,
});

const originalFetch = global.fetch;
const originalApiKey = process.env.OPENAI_API_KEY;

const mockEmbeddingsFetch = () => {
  const fetchMock = jest.fn(async (_url: any, init: any) => {
    const body = JSON.parse(init.body);
    const inputs: string[] = body.input;
    return {
      ok: true,
      json: async () => ({
        data: inputs.map(() => ({ embedding: [1, 0, 0] })),
        usage: { total_tokens: inputs.length },
      }),
    };
  });
  global.fetch = fetchMock as any;
  return fetchMock;
};

beforeEach(() => {
  process.env.OPENAI_API_KEY = "test-key";
  process.env.OPENAI_EMBEDDINGS_MODEL = "text-embedding-3-small";
});

afterEach(() => {
  global.fetch = originalFetch;
  if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalApiKey;
  jest.clearAllMocks();
});

describe("buildMeetingSearchChunks", () => {
  it("builds a summary chunk plus speaker-turn transcript chunks with timestamps", () => {
    const chunks = buildMeetingSearchChunks(buildMeeting());
    expect(chunks[0]).toMatchObject({
      chunkType: "summary",
      speaker: null,
      timestamp: null,
    });
    expect(chunks[0].text).toContain("per-seat pricing");

    const transcriptChunks = chunks.filter((c) => c.chunkType === "transcript");
    expect(transcriptChunks.length).toBeGreaterThan(0);
    expect(transcriptChunks[0].timestamp).toBe("0:00");
    expect(transcriptChunks[0].speaker).toBe("Stefan");
    expect(transcriptChunks[0].startOffsetSeconds).toBe(0);
    expect(transcriptChunks[0].text).toContain("priced per seat");
  });

  it("windows long transcripts (~1.5k chars) with a small line overlap", () => {
    const lines = Array.from({ length: 40 }, (_, i) =>
      transcriptLine(i, "Speaker", `Statement number ${i} ${"filler ".repeat(20)}`)
    );
    const chunks = buildMeetingSearchChunks(
      buildMeeting({ summary: "", originalTranscript: lines.join("\n") })
    );
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.chunkType).toBe("transcript");
      expect(chunk.text.length).toBeLessThanOrEqual(1800);
    }
    // Overlap: the first line of chunk N repeats a trailing line of chunk N-1.
    const firstLineOfSecond = chunks[1].text.split("\n")[0];
    expect(chunks[0].text).toContain(firstLineOfSecond);
  });

  it("returns no chunks for meetings without summary or transcript", () => {
    expect(
      buildMeetingSearchChunks(
        buildMeeting({ summary: "", originalTranscript: "" })
      )
    ).toEqual([]);
  });

  it("falls back to transcript artifacts when originalTranscript is missing", () => {
    const chunks = buildMeetingSearchChunks(
      buildMeeting({
        summary: "",
        originalTranscript: "",
        artifacts: [
          { type: "transcript", processedText: "1:00 - Ana: Artifact transcript line." },
        ],
      })
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toContain("Artifact transcript line");
  });
});

describe("indexMeetingSearchChunksForMeeting", () => {
  it("embeds and inserts chunks with scope fields and deterministic ids", async () => {
    const fetchMock = mockEmbeddingsFetch();
    const { db, chunks } = makeDb({ meetings: [buildMeeting()] });

    const result = await indexMeetingSearchChunksForMeeting(db, {
      meetingId: "meeting-1",
      userId: "user-1",
    });

    expect(result.status).toBe("indexed");
    expect(result.chunkCount).toBeGreaterThan(0);
    expect(chunks).toHaveLength(result.chunkCount);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    for (const chunk of chunks) {
      expect(chunk).toMatchObject({
        workspaceId: "ws-1",
        meetingId: "meeting-1",
        userId: "user-1",
        embedding: [1, 0, 0],
        embeddingModel: "text-embedding-3-small",
      });
      expect(chunk._id).toBe(`meeting-1:${chunk.chunkType}:${chunk.chunkIndex}`);
      expect(chunk.createdAt).toBeInstanceOf(Date);
      expect(chunk.updatedAt).toBeInstanceOf(Date);
    }
  });

  it("is idempotent: re-indexing the same meeting never duplicates chunks", async () => {
    const fetchMock = mockEmbeddingsFetch();
    const { db, chunks } = makeDb({ meetings: [buildMeeting()] });

    const first = await indexMeetingSearchChunksForMeeting(db, {
      meetingId: "meeting-1",
      userId: "user-1",
    });
    const countAfterFirst = chunks.length;

    const second = await indexMeetingSearchChunksForMeeting(db, {
      meetingId: "meeting-1",
      userId: "user-1",
    });

    expect(first.status).toBe("indexed");
    // Unchanged content short-circuits — no re-embedding, no rewrite.
    expect(second.status).toBe("skipped_unchanged");
    expect(second.chunkCount).toBe(countAfterFirst);
    expect(chunks).toHaveLength(countAfterFirst);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const ids = chunks.map((chunk) => chunk._id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("re-indexes changed content by replacing chunks (still no duplicates)", async () => {
    mockEmbeddingsFetch();
    const meeting = buildMeeting();
    const { db, chunks } = makeDb({ meetings: [meeting] });

    await indexMeetingSearchChunksForMeeting(db, {
      meetingId: "meeting-1",
      userId: "user-1",
    });
    meeting.summary = "Completely new decisions about the rollout plan.";

    const result = await indexMeetingSearchChunksForMeeting(db, {
      meetingId: "meeting-1",
      userId: "user-1",
    });

    expect(result.status).toBe("indexed");
    const ids = chunks.map((chunk) => chunk._id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(
      chunks.find((chunk) => chunk.chunkType === "summary")?.text
    ).toContain("rollout plan");
  });

  it("skips without writing when no OPENAI_API_KEY is configured", async () => {
    delete process.env.OPENAI_API_KEY;
    const fetchMock = jest.fn();
    global.fetch = fetchMock as any;
    const { db, chunks } = makeDb({ meetings: [buildMeeting()] });

    const result = await indexMeetingSearchChunksForMeeting(db, {
      meetingId: "meeting-1",
      userId: "user-1",
    });

    expect(result).toEqual({ status: "skipped_no_embeddings", chunkCount: 0 });
    expect(chunks).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps existing chunks when the embeddings API fails", async () => {
    mockEmbeddingsFetch();
    const meeting = buildMeeting();
    const { db, chunks } = makeDb({ meetings: [meeting] });
    await indexMeetingSearchChunksForMeeting(db, {
      meetingId: "meeting-1",
      userId: "user-1",
    });
    const countAfterFirst = chunks.length;

    meeting.summary = "Changed summary that will fail to embed.";
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 500,
      statusText: "boom",
      text: async () => "boom",
    })) as any;

    const result = await indexMeetingSearchChunksForMeeting(db, {
      meetingId: "meeting-1",
      userId: "user-1",
    });

    expect(result.status).toBe("skipped_no_embeddings");
    expect(chunks).toHaveLength(countAfterFirst);
  });

  it("deletes chunks for hidden meetings and reports missing meetings", async () => {
    mockEmbeddingsFetch();
    const meeting = buildMeeting();
    const { db, chunks } = makeDb({ meetings: [meeting] });
    await indexMeetingSearchChunksForMeeting(db, {
      meetingId: "meeting-1",
      userId: "user-1",
    });
    expect(chunks.length).toBeGreaterThan(0);

    meeting.isHidden = true;
    const hidden = await indexMeetingSearchChunksForMeeting(db, {
      meetingId: "meeting-1",
      userId: "user-1",
    });
    expect(hidden).toEqual({ status: "deleted_hidden", chunkCount: 0 });
    expect(chunks).toHaveLength(0);

    const missing = await indexMeetingSearchChunksForMeeting(db, {
      meetingId: "no-such-meeting",
      userId: "user-1",
    });
    expect(missing).toEqual({ status: "skipped_missing", chunkCount: 0 });
  });
});

describe("deleteMeetingSearchChunksForMeeting", () => {
  it("removes only the given meeting's chunks", async () => {
    mockEmbeddingsFetch();
    const { db, chunks } = makeDb({
      meetings: [buildMeeting(), buildMeeting({ _id: "meeting-2" })],
    });
    await indexMeetingSearchChunksForMeeting(db, {
      meetingId: "meeting-1",
      userId: "user-1",
    });
    await indexMeetingSearchChunksForMeeting(db, {
      meetingId: "meeting-2",
      userId: "user-1",
    });
    const total = chunks.length;
    const deleted = await deleteMeetingSearchChunksForMeeting(db, "meeting-1");
    expect(deleted).toBeGreaterThan(0);
    expect(chunks).toHaveLength(total - deleted);
    expect(chunks.every((chunk) => chunk.meetingId === "meeting-2")).toBe(true);
  });
});

describe("backfillMeetingSearchChunks", () => {
  it("dry-run reports would-be inserts without embedding or writing", async () => {
    const fetchMock = mockEmbeddingsFetch();
    const { db, chunks } = makeDb({
      meetings: [
        buildMeeting(),
        buildMeeting({ _id: "meeting-2" }),
        buildMeeting({ _id: "meeting-empty", summary: "", originalTranscript: "" }),
        buildMeeting({ _id: "meeting-hidden", isHidden: true }),
      ],
    });

    const counts = await backfillMeetingSearchChunks(db, { apply: false });

    expect(counts).toEqual({
      scanned: 4,
      inserted: 2,
      updated: 0,
      skipped: 2,
      errors: 0,
    });
    expect(chunks).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("apply indexes meetings and a second run skips everything (no duplicates)", async () => {
    mockEmbeddingsFetch();
    const { db, chunks } = makeDb({
      meetings: [
        buildMeeting(),
        buildMeeting({ _id: "meeting-2" }),
        buildMeeting({ _id: "meeting-empty", summary: "", originalTranscript: "" }),
      ],
    });

    const first = await backfillMeetingSearchChunks(db, { apply: true });
    expect(first).toEqual({
      scanned: 3,
      inserted: 2,
      updated: 0,
      skipped: 1,
      errors: 0,
    });
    const countAfterFirst = chunks.length;
    expect(countAfterFirst).toBeGreaterThan(0);

    const second = await backfillMeetingSearchChunks(db, { apply: true });
    expect(second).toEqual({
      scanned: 3,
      inserted: 0,
      updated: 0,
      skipped: 3,
      errors: 0,
    });
    expect(chunks).toHaveLength(countAfterFirst);
    const ids = chunks.map((chunk) => chunk._id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("counts re-indexed meetings as updated when content changed", async () => {
    mockEmbeddingsFetch();
    const meeting = buildMeeting();
    const { db } = makeDb({ meetings: [meeting] });
    await backfillMeetingSearchChunks(db, { apply: true });

    meeting.summary = "New content requiring re-embedding.";
    const counts = await backfillMeetingSearchChunks(db, { apply: true });
    expect(counts).toEqual({
      scanned: 1,
      inserted: 0,
      updated: 1,
      skipped: 0,
      errors: 0,
    });
  });

  it("apply mode aborts up-front without an API key", async () => {
    delete process.env.OPENAI_API_KEY;
    const { db, chunks } = makeDb({ meetings: [buildMeeting()] });
    const counts = await backfillMeetingSearchChunks(db, { apply: true });
    expect(counts).toEqual({
      scanned: 0,
      inserted: 0,
      updated: 0,
      skipped: 0,
      errors: 0,
    });
    expect(chunks).toHaveLength(0);
  });

  it("counts per-meeting failures as errors and keeps going", async () => {
    mockEmbeddingsFetch();
    const { db, collections } = makeDb({
      meetings: [buildMeeting(), buildMeeting({ _id: "meeting-2" })],
    });
    collections.meetingSearchChunks.countDocuments
      .mockRejectedValueOnce(new Error("boom"));

    const counts = await backfillMeetingSearchChunks(db, { apply: true });
    expect(counts.errors).toBe(1);
    expect(counts.inserted).toBe(1);
    expect(counts.scanned).toBe(2);
  });
});
