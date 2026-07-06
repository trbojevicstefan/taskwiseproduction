/**
 * Semantic meeting search chunks (`meetingSearchChunks` collection).
 *
 * This module owns the collection: chunking, embedding, idempotent
 * (re-)indexing, backfill, and deletion.
 *
 * Document shape:
 *   {
 *     _id: `${meetingId}:${chunkType}:${index}`   // deterministic — re-index
 *     workspaceId: string | null,                 // never duplicates a chunk
 *     meetingId: string,
 *     userId: string,
 *     chunkType: "summary" | "transcript",
 *     chunkIndex: number,
 *     text: string,
 *     speaker: string | null,
 *     timestamp: string | null,                   // "MM:SS" from transcript line
 *     startOffsetSeconds: number | null,
 *     embedding: number[],
 *     embeddingModel: string,
 *     sourceHash: string,                         // hash of summary+transcript+model
 *     createdAt: Date,
 *     updatedAt: Date,
 *   }
 *
 * Chunking: summaries become paragraph/size-bounded chunks; transcripts are
 * chunked on speaker-turn lines ("MM:SS - Speaker: text") into ~1.5k-char
 * windows with a small 2-line overlap so a statement split across a window
 * boundary is still retrievable. Chunk metadata (speaker/timestamp/offset)
 * comes from the first line of the window.
 *
 * Idempotency: re-indexing a meeting is delete-then-insert with
 * deterministic `_id`s, guarded by a `sourceHash` short-circuit so unchanged
 * meetings are skipped (no re-embedding cost). Safe to run twice.
 *
 * Retrieval (see src/lib/workspace-retrieval.ts) uses LOCAL cosine
 * similarity over a capped, workspace-scoped, most-recently-updated
 * candidate set — no Atlas Vector Search required. To move to Atlas Vector
 * Search later: create a vector index on `embedding` (cosine, dimensions of
 * the configured model, filter fields `workspaceId`/`userId`) and replace
 * the local scan with a `$vectorSearch` aggregation stage; the document
 * shape needs no changes.
 *
 * Degradation: when OPENAI_API_KEY is missing or embedding fails, indexing
 * is skipped (status reported, nothing thrown) and search falls back to the
 * existing keyword path.
 */

import { createHash } from "crypto";
import { embedTexts, getEmbeddingModel, isEmbeddingAvailable } from "@/lib/embeddings";

export const MEETING_SEARCH_CHUNKS_COLLECTION = "meetingSearchChunks";

// Transcript windows: target size with a hard per-chunk cap and a small
// speaker-turn overlap between consecutive windows.
const TRANSCRIPT_CHUNK_TARGET_CHARS = 1500;
const TRANSCRIPT_CHUNK_OVERLAP_LINES = 2;
const SUMMARY_CHUNK_MAX_CHARS = 1800;
const MAX_TRANSCRIPT_CHARS = 200_000;
const MAX_CHUNKS_PER_MEETING = 150;

export type MeetingSearchChunkType = "summary" | "transcript";

export type MeetingSearchChunkInput = {
  chunkType: MeetingSearchChunkType;
  text: string;
  speaker: string | null;
  timestamp: string | null;
  startOffsetSeconds: number | null;
};

export type MeetingSearchChunkDoc = MeetingSearchChunkInput & {
  _id: string;
  workspaceId: string | null;
  meetingId: string;
  userId: string;
  chunkIndex: number;
  embedding: number[];
  embeddingModel: string;
  sourceHash: string;
  createdAt: Date;
  updatedAt: Date;
};

export type MeetingSearchIndexStatus =
  | "indexed"
  | "skipped_unchanged"
  | "skipped_no_content"
  | "skipped_no_embeddings"
  | "skipped_missing"
  | "deleted_hidden";

export type MeetingSearchIndexResult = {
  status: MeetingSearchIndexStatus;
  chunkCount: number;
};

// Canonical transcript line: "MM:SS - Speaker: text" (H:MM:SS also appears).
const TRANSCRIPT_LINE_REGEX =
  /^\s*[[(]?(\d{1,2}:\d{2}(?::\d{2})?)[\])]?\s*-?\s*(?:([^:]{1,80}):\s*)?(.*)$/;

const parseTimestampToSeconds = (timestamp: string | null): number | null => {
  if (!timestamp) return null;
  const parts = timestamp.split(":").map((part) => Number(part));
  if (parts.some((part) => !Number.isFinite(part))) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return null;
};

type ParsedTranscriptLine = {
  raw: string;
  speaker: string | null;
  timestamp: string | null;
};

const parseTranscriptLine = (line: string): ParsedTranscriptLine => {
  const match = TRANSCRIPT_LINE_REGEX.exec(line);
  if (!match) {
    // "Speaker: text" without a timestamp.
    const speakerMatch = /^([^:]{1,80}):\s+\S/.exec(line);
    return {
      raw: line,
      speaker: speakerMatch ? speakerMatch[1].trim() : null,
      timestamp: null,
    };
  }
  return {
    raw: line,
    speaker: match[2] ? match[2].trim() : null,
    timestamp: match[1] || null,
  };
};

const chunkSummary = (summary: string): MeetingSearchChunkInput[] => {
  const trimmed = summary.trim();
  if (!trimmed) return [];
  const chunks: MeetingSearchChunkInput[] = [];
  // Greedy paragraph packing, falling back to hard slices for giant blocks.
  const paragraphs = trimmed.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  let current = "";
  const flush = () => {
    if (!current.trim()) return;
    chunks.push({
      chunkType: "summary",
      text: current.trim(),
      speaker: null,
      timestamp: null,
      startOffsetSeconds: null,
    });
    current = "";
  };
  for (const paragraph of paragraphs) {
    if (paragraph.length > SUMMARY_CHUNK_MAX_CHARS) {
      flush();
      for (let i = 0; i < paragraph.length; i += SUMMARY_CHUNK_MAX_CHARS) {
        current = paragraph.slice(i, i + SUMMARY_CHUNK_MAX_CHARS);
        flush();
      }
      continue;
    }
    if (current && current.length + paragraph.length + 2 > SUMMARY_CHUNK_MAX_CHARS) {
      flush();
    }
    current = current ? `${current}\n\n${paragraph}` : paragraph;
  }
  flush();
  return chunks;
};

const chunkTranscript = (transcript: string): MeetingSearchChunkInput[] => {
  const trimmed = transcript.trim().slice(0, MAX_TRANSCRIPT_CHARS);
  if (!trimmed) return [];

  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseTranscriptLine);
  if (!lines.length) return [];

  const chunks: MeetingSearchChunkInput[] = [];
  let window: ParsedTranscriptLine[] = [];
  let windowChars = 0;

  const flush = () => {
    if (!window.length) return;
    const first = window[0];
    chunks.push({
      chunkType: "transcript",
      text: window.map((line) => line.raw).join("\n"),
      speaker: first.speaker,
      timestamp: first.timestamp,
      startOffsetSeconds: parseTimestampToSeconds(first.timestamp),
    });
    // Small speaker-turn overlap so boundary statements stay retrievable.
    const overlap = window.slice(-TRANSCRIPT_CHUNK_OVERLAP_LINES);
    window = window.length > TRANSCRIPT_CHUNK_OVERLAP_LINES ? [...overlap] : [];
    windowChars = window.reduce((sum, line) => sum + line.raw.length + 1, 0);
  };

  for (const line of lines) {
    if (
      window.length &&
      windowChars + line.raw.length + 1 > TRANSCRIPT_CHUNK_TARGET_CHARS
    ) {
      flush();
      if (chunks.length >= MAX_CHUNKS_PER_MEETING) break;
    }
    window.push(line);
    windowChars += line.raw.length + 1;
  }
  if (chunks.length < MAX_CHUNKS_PER_MEETING && window.length) {
    // Do not emit an overlap-only trailing window (its lines are already in
    // the previous chunk).
    const lastChunkText = chunks.length ? chunks[chunks.length - 1].text : "";
    const windowText = window.map((line) => line.raw).join("\n");
    if (!lastChunkText || !lastChunkText.endsWith(windowText)) {
      const first = window[0];
      chunks.push({
        chunkType: "transcript",
        text: windowText,
        speaker: first.speaker,
        timestamp: first.timestamp,
        startOffsetSeconds: parseTimestampToSeconds(first.timestamp),
      });
    }
  }

  return chunks.slice(0, MAX_CHUNKS_PER_MEETING);
};

/** Transcript from originalTranscript or the first transcript artifact. */
const extractMeetingTranscript = (meeting: any): string => {
  const direct =
    typeof meeting?.originalTranscript === "string"
      ? meeting.originalTranscript.trim()
      : "";
  if (direct) return direct;
  const artifacts = Array.isArray(meeting?.artifacts) ? meeting.artifacts : [];
  for (const artifact of artifacts) {
    if (
      artifact &&
      artifact.type === "transcript" &&
      typeof artifact.processedText === "string" &&
      artifact.processedText.trim()
    ) {
      return artifact.processedText.trim();
    }
  }
  return "";
};

/** Pure chunker: summary chunk(s) first, then transcript windows. */
export const buildMeetingSearchChunks = (meeting: any): MeetingSearchChunkInput[] => {
  const summary = typeof meeting?.summary === "string" ? meeting.summary : "";
  const transcript = extractMeetingTranscript(meeting);
  return [...chunkSummary(summary), ...chunkTranscript(transcript)].slice(
    0,
    MAX_CHUNKS_PER_MEETING
  );
};

/** Content fingerprint: re-index only when summary/transcript/model change. */
export const computeMeetingSearchSourceHash = (meeting: any): string => {
  const summary = typeof meeting?.summary === "string" ? meeting.summary : "";
  const transcript = extractMeetingTranscript(meeting).slice(0, MAX_TRANSCRIPT_CHARS);
  return createHash("sha256")
    .update(getEmbeddingModel())
    .update(" ")
    .update(summary)
    .update(" ")
    .update(transcript)
    .digest("hex");
};

export const deleteMeetingSearchChunksForMeeting = async (
  db: any,
  meetingId: string
): Promise<number> => {
  const id = String(meetingId || "").trim();
  if (!id) return 0;
  const result = await db
    .collection(MEETING_SEARCH_CHUNKS_COLLECTION)
    .deleteMany({ meetingId: id });
  return result?.deletedCount ?? 0;
};

const loadMeetingForIndexing = async (db: any, userId: string, meetingId: string) =>
  db.collection("meetings").findOne(
    {
      ...(userId ? { userId } : {}),
      $or: [{ _id: meetingId }, { id: meetingId }],
    },
    {
      projection: {
        _id: 1,
        userId: 1,
        workspaceId: 1,
        isHidden: 1,
        summary: 1,
        originalTranscript: 1,
        artifacts: 1,
      },
    }
  );

/**
 * Index (or re-index) one meeting's search chunks. Idempotent: unchanged
 * content short-circuits; changed content is replaced atomically enough via
 * delete-then-insert with deterministic ids (a crash between the two leaves
 * the meeting un-indexed, and the next ingest/backfill repairs it). Hidden
 * or missing meetings have their chunks removed. Never throws on missing
 * embeddings — reports a skipped status instead.
 */
export const indexMeetingSearchChunksForMeeting = async (
  db: any,
  input: {
    meetingId: string;
    userId: string;
    workspaceId?: string | null;
    /** Pre-loaded meeting doc (backfill); loaded by id when omitted. */
    meeting?: any;
    /** Re-embed even when sourceHash is unchanged. */
    force?: boolean;
  }
): Promise<MeetingSearchIndexResult> => {
  const meetingId = String(input.meetingId || "").trim();
  if (!meetingId) return { status: "skipped_missing", chunkCount: 0 };

  const meeting =
    input.meeting ?? (await loadMeetingForIndexing(db, input.userId, meetingId));
  if (!meeting) {
    await deleteMeetingSearchChunksForMeeting(db, meetingId);
    return { status: "skipped_missing", chunkCount: 0 };
  }
  if (meeting.isHidden) {
    await deleteMeetingSearchChunksForMeeting(db, meetingId);
    return { status: "deleted_hidden", chunkCount: 0 };
  }

  const canonicalMeetingId = String(meeting._id ?? meetingId);
  const chunkInputs = buildMeetingSearchChunks(meeting);
  if (!chunkInputs.length) {
    await deleteMeetingSearchChunksForMeeting(db, canonicalMeetingId);
    return { status: "skipped_no_content", chunkCount: 0 };
  }

  const sourceHash = computeMeetingSearchSourceHash(meeting);
  const collection = db.collection(MEETING_SEARCH_CHUNKS_COLLECTION);

  if (!input.force) {
    const existing = await collection.findOne(
      { meetingId: canonicalMeetingId },
      { projection: { sourceHash: 1 } }
    );
    if (existing && existing.sourceHash === sourceHash) {
      const chunkCount = await collection.countDocuments({
        meetingId: canonicalMeetingId,
      });
      return { status: "skipped_unchanged", chunkCount };
    }
  }

  if (!isEmbeddingAvailable()) {
    return { status: "skipped_no_embeddings", chunkCount: 0 };
  }

  const embeddings = await embedTexts(chunkInputs.map((chunk) => chunk.text));
  if (embeddings.length !== chunkInputs.length) {
    // Embed failure: keep any existing chunks rather than dropping coverage.
    return { status: "skipped_no_embeddings", chunkCount: 0 };
  }

  const now = new Date();
  const embeddingModel = getEmbeddingModel();
  const workspaceId =
    typeof input.workspaceId === "string" && input.workspaceId.trim()
      ? input.workspaceId.trim()
      : typeof meeting.workspaceId === "string" && meeting.workspaceId.trim()
        ? meeting.workspaceId.trim()
        : null;
  const userId =
    String(input.userId || "").trim() || String(meeting.userId || "").trim();

  const docs: MeetingSearchChunkDoc[] = chunkInputs.map((chunk, index) => ({
    _id: `${canonicalMeetingId}:${chunk.chunkType}:${index}`,
    workspaceId,
    meetingId: canonicalMeetingId,
    userId,
    chunkType: chunk.chunkType,
    chunkIndex: index,
    text: chunk.text,
    speaker: chunk.speaker,
    timestamp: chunk.timestamp,
    startOffsetSeconds: chunk.startOffsetSeconds,
    embedding: embeddings[index],
    embeddingModel,
    sourceHash,
    createdAt: now,
    updatedAt: now,
  }));

  await collection.deleteMany({ meetingId: canonicalMeetingId });
  await collection.insertMany(docs, { ordered: false });

  return { status: "indexed", chunkCount: docs.length };
};

export type MeetingSearchBackfillCounts = {
  scanned: number;
  inserted: number;
  updated: number;
  skipped: number;
  errors: number;
};

export type MeetingSearchBackfillOptions = {
  /** Write chunks. Default false = dry-run (no embedding calls, no writes). */
  apply?: boolean;
  /** Max meetings to scan (0 = no limit). */
  limit?: number;
  log?: (message: string) => void;
};

/**
 * Backfill search chunks for existing meetings. Idempotent: unchanged
 * meetings are skipped via sourceHash, so a second run performs no
 * duplicate work and creates no duplicate chunks. Dry-run computes what
 * would happen without embedding or writing.
 */
export const backfillMeetingSearchChunks = async (
  db: any,
  options: MeetingSearchBackfillOptions = {}
): Promise<MeetingSearchBackfillCounts> => {
  const apply = Boolean(options.apply);
  const limit = Math.max(0, Math.floor(options.limit ?? 0));
  const log = options.log ?? (() => undefined);

  const counts: MeetingSearchBackfillCounts = {
    scanned: 0,
    inserted: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
  };

  if (apply && !isEmbeddingAvailable()) {
    log(
      "OPENAI_API_KEY is not set — apply mode cannot embed. Aborting before any writes."
    );
    return counts;
  }

  const chunksCollection = db.collection(MEETING_SEARCH_CHUNKS_COLLECTION);
  let cursor = db
    .collection("meetings")
    .find(
      {},
      {
        projection: {
          _id: 1,
          userId: 1,
          workspaceId: 1,
          isHidden: 1,
          title: 1,
          summary: 1,
          originalTranscript: 1,
          artifacts: 1,
        },
      }
    )
    .sort({ lastActivityAt: -1, _id: -1 });
  if (limit > 0) cursor = cursor.limit(limit);
  const meetings: any[] = await cursor.toArray();

  for (const meeting of meetings) {
    counts.scanned += 1;
    const meetingId = String(meeting._id ?? "");
    try {
      const existingCount = await chunksCollection.countDocuments({ meetingId });

      if (meeting.isHidden) {
        if (existingCount > 0 && apply) {
          await deleteMeetingSearchChunksForMeeting(db, meetingId);
          log(`[cleaned] ${meetingId} hidden meeting — removed ${existingCount} chunks`);
        }
        counts.skipped += 1;
        continue;
      }

      const chunkInputs = buildMeetingSearchChunks(meeting);
      if (!chunkInputs.length) {
        counts.skipped += 1;
        continue;
      }

      const sourceHash = computeMeetingSearchSourceHash(meeting);
      const existing = await chunksCollection.findOne(
        { meetingId },
        { projection: { sourceHash: 1 } }
      );
      if (existing && existing.sourceHash === sourceHash) {
        counts.skipped += 1;
        continue;
      }

      if (!apply) {
        // Dry-run: report what apply mode would do.
        if (existingCount > 0) counts.updated += 1;
        else counts.inserted += 1;
        log(
          `[dry-run] would ${existingCount > 0 ? "update" : "insert"} ${chunkInputs.length} chunks for ${meetingId} (${String(meeting.title || "Untitled meeting")})`
        );
        continue;
      }

      const result = await indexMeetingSearchChunksForMeeting(db, {
        meetingId,
        userId: String(meeting.userId || ""),
        workspaceId: meeting.workspaceId ?? null,
        meeting,
      });
      if (result.status === "indexed") {
        if (existingCount > 0) counts.updated += 1;
        else counts.inserted += 1;
        log(`[indexed] ${meetingId}: ${result.chunkCount} chunks`);
      } else {
        counts.skipped += 1;
        log(`[skipped] ${meetingId}: ${result.status}`);
      }
    } catch (error) {
      counts.errors += 1;
      log(`[error] ${meetingId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return counts;
};
