/**
 * Workspace retrieval layer for the General AI Chat (Phase 2; hybrid
 * semantic upgrade in the P2 retrieval pass).
 *
 * Hybrid search/ranking over meetings, transcripts, tasks, and people:
 *
 * - Keyword scoring (title/summary/attendee/task/person token overlap,
 *   phrase bonus) is the always-available baseline and the tie-breaker.
 * - Semantic meeting search embeds the question (OpenAI embeddings, see
 *   src/lib/embeddings.ts) and runs LOCAL cosine similarity against the
 *   pre-embedded `meetingSearchChunks` collection
 *   (src/lib/meeting-search-chunks.ts). Candidates are workspace-scoped and
 *   capped to the CHUNK_CANDIDATE_LIMIT most recently updated chunks (i.e.
 *   the most recently ingested/updated meetings' chunks) so the scan stays
 *   cheap without Atlas Vector Search. To adopt Atlas Vector Search later,
 *   create a cosine vector index on `meetingSearchChunks.embedding` with
 *   `workspaceId`/`userId` filter fields and swap the capped find+cosine in
 *   `retrieveSemanticMeetingHits` for a `$vectorSearch` aggregation — the
 *   rest of the ranking pipeline is unchanged.
 * - Recency boost and the structured intents (overdue tasks, priorities,
 *   clients, assignees) are unchanged.
 *
 * Degradation: when embeddings are unavailable (no OPENAI_API_KEY, embed
 * failure, missing chunk collection) the semantic pass silently yields
 * nothing and results are exactly the previous keyword-only behavior —
 * never worse, never throwing.
 *
 * Scoping mirrors the existing API routes: workspaceId match plus the legacy
 * fallback used by the people routes (docs without a workspaceId owned by a
 * workspace member).
 */

import { embedText, isEmbeddingAvailable } from "@/lib/embeddings";
import { MEETING_SEARCH_CHUNKS_COLLECTION } from "@/lib/meeting-search-chunks";
import { cosineSimilarity } from "@/lib/task-completion-helpers";

export type WorkspaceRetrievalScope = {
  userId: string;
  workspaceId?: string | null;
  memberUserIds?: string[];
};

export type WorkspaceRetrievalOptions = {
  maxMeetings?: number;
  maxTasks?: number;
  maxPeople?: number;
};

export type TranscriptSnippet = {
  timestamp: string | null;
  snippet: string;
  /** Set on semantic (chunk-derived) snippets when the chunk had a speaker. */
  speaker?: string | null;
};

export type RetrievedMeeting = {
  id: string;
  title: string;
  startTime: string | null;
  summarySnippet: string | null;
  transcriptSnippets: TranscriptSnippet[];
  score: number;
  /** Best chunk cosine similarity (0..1) when the semantic pass matched. */
  semanticScore?: number | null;
};

export type RetrievedTask = {
  id: string;
  title: string;
  status: string;
  dueAt: string | null;
  assigneeName: string | null;
  overdue: boolean;
  sourceSessionId: string | null;
  priorityLabel?: string | null;
  priorityScore?: number | null;
  score: number;
};

export type RetrievedPerson = {
  id: string;
  name: string;
  email: string | null;
  personType: "teammate" | "client" | "unknown";
  openTaskCount?: number;
  score: number;
};

export type WorkspaceRetrievalResult = {
  meetings: RetrievedMeeting[];
  tasks: RetrievedTask[];
  people: RetrievedPerson[];
  isEmpty: boolean;
};

export type QuestionTokens = {
  tokens: string[];
  phrases: string[];
};

const DEFAULT_MAX_MEETINGS = 5;
const DEFAULT_MAX_TASKS = 10;
const DEFAULT_MAX_PEOPLE = 5;
const MAX_RESULT_LIMIT = 50;

const MEETING_CANDIDATE_LIMIT = 200;
const TASK_CANDIDATE_LIMIT = 300;
const PEOPLE_CANDIDATE_LIMIT = 300;

const MAX_SNIPPETS_PER_MEETING = 3;
const SNIPPET_MAX_CHARS = 320;
const SUMMARY_SNIPPET_MAX_CHARS = 280;

const TITLE_WEIGHT = 3;
const SUMMARY_WEIGHT = 2;
const ATTENDEE_WEIGHT = 2;
const PHRASE_BONUS = 2;
const RECENT_7D_BOOST = 2;
const RECENT_30D_BOOST = 1;

// Semantic pass: capped local scan over the most recently updated chunks
// (~ the most recent meetings' chunks; documented in the module header).
const CHUNK_CANDIDATE_LIMIT = 500;
const MIN_SEMANTIC_SIMILARITY = 0.3;
// Similarity (0..1) scaled onto the keyword score's integer range so a
// strong semantic hit outranks a weak single-token keyword match, while
// keyword scoring stays the tie-breaker between similar semantic hits.
const SEMANTIC_SCORE_WEIGHT = 10;
const MAX_QUESTION_EMBED_CHARS = 2000;

const TASK_TITLE_WEIGHT = 3;
const TASK_DESCRIPTION_WEIGHT = 1;
const TASK_ASSIGNEE_WEIGHT = 2;

const PERSON_EXACT_NAME_BONUS = 5;
const PERSON_NAME_TOKEN_WEIGHT = 2;
const PERSON_EMAIL_WEIGHT = 3;
const PERSON_ALIAS_WEIGHT = 1;
const PERSON_CLIENT_INTENT_BOOST = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

const OVERDUE_INTENT_REGEX = /\b(overdue|late|deadline|deadlines|due)\b/i;
const CLIENT_INTENT_REGEX = /\bclients?\b/i;
// "What should I do first / work on", "top priority", "most urgent", etc. —
// surfaces top open tasks by priorityScore even without keyword overlap.
const PRIORITY_INTENT_REGEX =
  /\bfirst\b|priorit|\burgent|most important|what should i (?:do|work on)/i;

// Canonical transcript line format: "MM:SS - Speaker: text" (bracketed and
// parenthesized timestamps also appear in normalized transcripts).
const TRANSCRIPT_TIMESTAMP_REGEX = /^\s*[[(]?(\d{1,2}:\d{2}(?::\d{2})?)[\])]?/;

const STOPWORDS = new Set([
  "about",
  "after",
  "again",
  "all",
  "also",
  "and",
  "any",
  "anything",
  "are",
  "back",
  "been",
  "before",
  "being",
  "between",
  "but",
  "can",
  "could",
  "did",
  "does",
  "doing",
  "down",
  "during",
  "each",
  "few",
  "for",
  "from",
  "further",
  "get",
  "got",
  "had",
  "has",
  "have",
  "having",
  "her",
  "here",
  "hers",
  "him",
  "his",
  "how",
  "into",
  "its",
  "just",
  "let",
  "many",
  "mention",
  "mentioned",
  "more",
  "most",
  "much",
  "nor",
  "not",
  "now",
  "off",
  "once",
  "only",
  "other",
  "our",
  "ours",
  "out",
  "over",
  "own",
  "please",
  "said",
  "same",
  "say",
  "says",
  "she",
  "should",
  "show",
  "some",
  "still",
  "such",
  "tell",
  "than",
  "that",
  "the",
  "their",
  "theirs",
  "them",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "through",
  "told",
  "too",
  "under",
  "until",
  "very",
  "was",
  "were",
  "what",
  "when",
  "where",
  "which",
  "while",
  "who",
  "whom",
  "why",
  "will",
  "with",
  "would",
  "you",
  "your",
  "yours",
]);

const normalizeToWords = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

/**
 * Tokenize a user question: lowercase, strip punctuation, drop stopwords and
 * words shorter than 3 chars. Double-quoted spans are kept as phrase tokens
 * (their words are also folded into the regular token list).
 */
export const tokenize = (question: string): QuestionTokens => {
  const phrases: string[] = [];
  const raw = typeof question === "string" ? question : "";
  const withoutPhrases = raw.replace(
    /"([^"]{2,})"|“([^”]{2,})”/g,
    (_match, straight, curly) => {
      const phrase = String(straight || curly || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");
      if (phrase.length >= 3) phrases.push(phrase);
      return ` ${phrase} `;
    }
  );

  const tokens = normalizeToWords(withoutPhrases).filter(
    (word) => word.length >= 3 && !STOPWORDS.has(word)
  );

  return {
    tokens: Array.from(new Set(tokens)),
    phrases: Array.from(new Set(phrases)),
  };
};

/**
 * Count how many distinct query tokens appear in the text. Pure and cheap;
 * text words are NOT stopword-filtered so any query token can match.
 */
export const scoreText = (text: unknown, tokens: string[]): number => {
  if (typeof text !== "string" || !text.trim() || !tokens.length) return 0;
  const words = new Set(normalizeToWords(text));
  let matched = 0;
  for (const token of tokens) {
    if (words.has(token)) matched += 1;
  }
  return matched;
};

const countPhraseMatches = (text: unknown, phrases: string[]): number => {
  if (typeof text !== "string" || !text.trim() || !phrases.length) return 0;
  const lowered = text.toLowerCase();
  let matched = 0;
  for (const phrase of phrases) {
    if (lowered.includes(phrase)) matched += 1;
  }
  return matched;
};

const parseTranscriptLineTimestamp = (line: string): string | null => {
  const match = TRANSCRIPT_TIMESTAMP_REGEX.exec(line);
  return match ? match[1] : null;
};

/**
 * Extract up to `maxSnippets` keyword-matching snippets from a transcript.
 * A snippet is the matching line plus its neighbor line (next line when
 * available, previous line otherwise), capped at 320 chars. The timestamp is
 * parsed from the matching line when present ("MM:SS - Speaker: text").
 */
export const extractTranscriptSnippets = (
  transcript: string | null | undefined,
  query: QuestionTokens,
  maxSnippets: number = MAX_SNIPPETS_PER_MEETING
): TranscriptSnippet[] => {
  if (typeof transcript !== "string" || !transcript.trim()) return [];
  if (!query.tokens.length && !query.phrases.length) return [];

  const lines = transcript
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const snippets: TranscriptSnippet[] = [];
  const consumed = new Set<number>();

  for (let index = 0; index < lines.length; index += 1) {
    if (snippets.length >= maxSnippets) break;
    if (consumed.has(index)) continue;
    const line = lines[index];
    const matches =
      scoreText(line, query.tokens) > 0 ||
      countPhraseMatches(line, query.phrases) > 0;
    if (!matches) continue;

    consumed.add(index);
    const parts = [line];
    const neighborIndex =
      index + 1 < lines.length ? index + 1 : index - 1 >= 0 ? index - 1 : -1;
    if (neighborIndex >= 0 && !consumed.has(neighborIndex)) {
      consumed.add(neighborIndex);
      if (neighborIndex > index) {
        parts.push(lines[neighborIndex]);
      } else {
        parts.unshift(lines[neighborIndex]);
      }
    }

    snippets.push({
      timestamp: parseTranscriptLineTimestamp(line),
      snippet: parts.join("\n").slice(0, SNIPPET_MAX_CHARS),
    });
  }

  return snippets;
};

const toDate = (value: unknown): Date | null => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
};

const toIsoString = (value: unknown): string | null =>
  toDate(value)?.toISOString() ?? null;

const clampLimit = (value: number | undefined, fallback: number): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
    return fallback;
  }
  return Math.min(MAX_RESULT_LIMIT, Math.floor(value));
};

/**
 * Same fallback semantics the people routes use: docs tagged with the
 * workspace id, plus legacy docs without a workspaceId that belong to a
 * workspace member. When no workspaceId is available, scope by user ids only.
 */
const buildScopeFilter = (
  scope: WorkspaceRetrievalScope
): Record<string, any> => {
  const memberUserIds =
    Array.isArray(scope.memberUserIds) && scope.memberUserIds.length
      ? scope.memberUserIds
      : [scope.userId];
  if (scope.workspaceId) {
    return {
      $or: [
        { workspaceId: scope.workspaceId },
        {
          workspaceId: { $exists: false },
          userId: { $in: memberUserIds },
        },
      ],
    };
  }
  return { userId: { $in: memberUserIds } };
};

const MEETING_CANDIDATE_PROJECTION = {
  _id: 1,
  title: 1,
  summary: 1,
  attendees: 1,
  startTime: 1,
  lastActivityAt: 1,
  createdAt: 1,
} as const;

const TASK_CANDIDATE_PROJECTION = {
  _id: 1,
  title: 1,
  description: 1,
  status: 1,
  taskState: 1,
  dueAt: 1,
  assigneeName: 1,
  sourceSessionId: 1,
  lastUpdated: 1,
  priorityScore: 1,
  priorityLabel: 1,
} as const;

const PEOPLE_CANDIDATE_PROJECTION = {
  _id: 1,
  name: 1,
  email: 1,
  aliases: 1,
  personType: 1,
  lastSeenAt: 1,
} as const;

const extractAttendeeNames = (attendees: unknown): string[] => {
  if (!Array.isArray(attendees)) return [];
  return attendees
    .map((attendee) => {
      if (typeof attendee === "string") return attendee;
      if (attendee && typeof (attendee as any).name === "string") {
        return (attendee as any).name as string;
      }
      return "";
    })
    .filter(Boolean);
};

const recencyBoost = (startTime: Date | null, now: Date): number => {
  if (!startTime) return 0;
  const ageMs = now.getTime() - startTime.getTime();
  if (ageMs <= 7 * DAY_MS) return RECENT_7D_BOOST;
  if (ageMs <= 30 * DAY_MS) return RECENT_30D_BOOST;
  return 0;
};

type SemanticChunkHit = {
  text: string;
  speaker: string | null;
  timestamp: string | null;
  similarity: number;
};

type SemanticMeetingHit = {
  meetingId: string;
  similarity: number;
  chunks: SemanticChunkHit[];
};

/**
 * Semantic pass: embed the question and cosine-score it locally against the
 * workspace's most recently updated meeting chunks (capped candidate set —
 * see module header for the Atlas Vector Search migration path). Returns
 * null whenever embeddings are unavailable or anything fails, so callers
 * degrade to the keyword-only path. Never throws.
 */
const retrieveSemanticMeetingHits = async (
  db: any,
  scopeFilter: Record<string, any>,
  question: string
): Promise<Map<string, SemanticMeetingHit> | null> => {
  const trimmed = typeof question === "string" ? question.trim() : "";
  if (!trimmed || !isEmbeddingAvailable()) return null;

  try {
    const questionEmbedding = await embedText(
      trimmed.slice(0, MAX_QUESTION_EMBED_CHARS)
    );
    if (!questionEmbedding) return null;

    const chunks: any[] = await db
      .collection(MEETING_SEARCH_CHUNKS_COLLECTION)
      .find(
        { ...scopeFilter },
        {
          projection: {
            _id: 1,
            meetingId: 1,
            text: 1,
            speaker: 1,
            timestamp: 1,
            embedding: 1,
          },
        }
      )
      .sort({ updatedAt: -1, _id: -1 })
      .limit(CHUNK_CANDIDATE_LIMIT)
      .toArray();

    const hits = new Map<string, SemanticMeetingHit>();
    for (const chunk of chunks) {
      const meetingId = String(chunk?.meetingId ?? "").trim();
      const embedding = Array.isArray(chunk?.embedding) ? chunk.embedding : [];
      const text = typeof chunk?.text === "string" ? chunk.text : "";
      if (!meetingId || !embedding.length || !text.trim()) continue;
      const similarity = cosineSimilarity(questionEmbedding, embedding);
      if (similarity < MIN_SEMANTIC_SIMILARITY) continue;

      const chunkHit: SemanticChunkHit = {
        text,
        speaker: typeof chunk?.speaker === "string" ? chunk.speaker : null,
        timestamp: typeof chunk?.timestamp === "string" ? chunk.timestamp : null,
        similarity,
      };
      const existing = hits.get(meetingId);
      if (existing) {
        existing.similarity = Math.max(existing.similarity, similarity);
        existing.chunks.push(chunkHit);
      } else {
        hits.set(meetingId, {
          meetingId,
          similarity,
          chunks: [chunkHit],
        });
      }
    }

    for (const hit of hits.values()) {
      hit.chunks.sort((a, b) => b.similarity - a.similarity);
      hit.chunks = hit.chunks.slice(0, MAX_SNIPPETS_PER_MEETING);
    }
    return hits;
  } catch {
    // Any failure (missing collection, driver error) degrades to keyword-only.
    return null;
  }
};

const buildSemanticSnippets = (hit: SemanticMeetingHit): TranscriptSnippet[] =>
  hit.chunks.map((chunk) => ({
    timestamp: chunk.timestamp,
    snippet: chunk.text.slice(0, SNIPPET_MAX_CHARS),
    speaker: chunk.speaker,
  }));

const retrieveMeetings = async (
  db: any,
  scopeFilter: Record<string, any>,
  query: QuestionTokens,
  maxMeetings: number,
  now: Date,
  semanticHits: Map<string, SemanticMeetingHit> | null
): Promise<RetrievedMeeting[]> => {
  const hasKeywordSignal = query.tokens.length > 0 || query.phrases.length > 0;
  const hasSemanticSignal = Boolean(semanticHits && semanticHits.size);
  if (!hasKeywordSignal && !hasSemanticSignal) return [];

  const candidates: any[] = hasKeywordSignal
    ? await db
        .collection("meetings")
        .find(
          { ...scopeFilter, isHidden: { $ne: true } },
          { projection: MEETING_CANDIDATE_PROJECTION }
        )
        .sort({ lastActivityAt: -1, _id: -1 })
        .limit(MEETING_CANDIDATE_LIMIT)
        .toArray()
    : [];

  // Semantic hits outside the recent-candidate window still need their
  // meeting metadata; fetch the missing docs by id with the same scope and
  // hidden-filter (so chunks of deleted/hidden meetings can never surface).
  if (hasSemanticSignal) {
    const candidateIds = new Set(
      candidates.map((doc) => String(doc?._id ?? ""))
    );
    const missingIds = Array.from(semanticHits!.keys()).filter(
      (id) => !candidateIds.has(id)
    );
    if (missingIds.length) {
      const extraDocs: any[] = await db
        .collection("meetings")
        .find(
          {
            ...scopeFilter,
            isHidden: { $ne: true },
            _id: { $in: missingIds },
          },
          { projection: MEETING_CANDIDATE_PROJECTION }
        )
        .toArray();
      candidates.push(...extraDocs);
    }
  }

  const scored = candidates
    .map((doc) => {
      const id = String(doc?._id ?? "");
      const title = typeof doc?.title === "string" ? doc.title : "";
      const summary = typeof doc?.summary === "string" ? doc.summary : "";
      const attendeeNames = extractAttendeeNames(doc?.attendees).join(" ");

      const titleScore = scoreText(title, query.tokens) * TITLE_WEIGHT;
      const summaryTokenScore = scoreText(summary, query.tokens);
      const summaryScore = summaryTokenScore * SUMMARY_WEIGHT;
      const attendeeScore =
        scoreText(attendeeNames, query.tokens) * ATTENDEE_WEIGHT;
      const phraseScore =
        (countPhraseMatches(title, query.phrases) +
          countPhraseMatches(summary, query.phrases)) *
        PHRASE_BONUS;
      const summaryMatched =
        summaryTokenScore > 0 || countPhraseMatches(summary, query.phrases) > 0;

      const semanticHit = semanticHits?.get(id) ?? null;
      const semanticComponent = semanticHit
        ? semanticHit.similarity * SEMANTIC_SCORE_WEIGHT
        : 0;

      const baseScore =
        titleScore + summaryScore + attendeeScore + phraseScore + semanticComponent;
      const startTime = toDate(doc?.startTime) ?? toDate(doc?.lastActivityAt);
      const score = baseScore > 0 ? baseScore + recencyBoost(startTime, now) : 0;

      return {
        id,
        title: title.trim() || "Untitled meeting",
        startTime: toIsoString(doc?.startTime),
        summarySnippet: summaryMatched
          ? summary.trim().slice(0, SUMMARY_SNIPPET_MAX_CHARS)
          : null,
        transcriptSnippets: [] as TranscriptSnippet[],
        score,
        semanticScore: semanticHit ? semanticHit.similarity : null,
        semanticHit,
        sortTime: startTime ? startTime.getTime() : 0,
      };
    })
    .filter((meeting) => meeting.id && meeting.score > 0)
    .sort((a, b) => b.score - a.score || b.sortTime - a.sortTime)
    .slice(0, maxMeetings);

  // Semantic chunk snippets come first (they are why the meeting matched);
  // remaining slots are filled with keyword snippets from the transcript.
  for (const meeting of scored) {
    if (meeting.semanticHit) {
      meeting.transcriptSnippets = buildSemanticSnippets(meeting.semanticHit);
    }
  }

  const needsKeywordSnippets = hasKeywordSignal
    ? scored.filter(
        (meeting) => meeting.transcriptSnippets.length < MAX_SNIPPETS_PER_MEETING
      )
    : [];
  if (needsKeywordSnippets.length) {
    // Fetch full transcripts only for the winning meetings — never for the
    // whole candidate pool.
    const transcriptDocs: any[] = await db
      .collection("meetings")
      .find(
        {
          ...scopeFilter,
          _id: { $in: needsKeywordSnippets.map((meeting) => meeting.id) },
        },
        { projection: { _id: 1, originalTranscript: 1 } }
      )
      .toArray();
    const transcriptById = new Map<string, string>(
      transcriptDocs
        .filter((doc) => typeof doc?.originalTranscript === "string")
        .map((doc) => [String(doc._id), doc.originalTranscript as string])
    );
    for (const meeting of needsKeywordSnippets) {
      const keywordSnippets = extractTranscriptSnippets(
        transcriptById.get(meeting.id),
        query,
        MAX_SNIPPETS_PER_MEETING - meeting.transcriptSnippets.length
      );
      const seen = new Set(
        meeting.transcriptSnippets.map((snippet) => snippet.snippet)
      );
      for (const snippet of keywordSnippets) {
        if (seen.has(snippet.snippet)) continue;
        meeting.transcriptSnippets.push(snippet);
      }
    }
  }

  return scored.map((meeting) => ({
    id: meeting.id,
    title: meeting.title,
    startTime: meeting.startTime,
    summarySnippet: meeting.summarySnippet,
    transcriptSnippets: meeting.transcriptSnippets,
    score: meeting.score,
    semanticScore: meeting.semanticScore,
  }));
};

const retrieveTasks = async (
  db: any,
  scopeFilter: Record<string, any>,
  query: QuestionTokens,
  maxTasks: number,
  overdueIntent: boolean,
  priorityIntent: boolean,
  now: Date
): Promise<RetrievedTask[]> => {
  const hasSignal = query.tokens.length > 0 || query.phrases.length > 0;
  if (!hasSignal && !overdueIntent && !priorityIntent) return [];

  const filter: Record<string, any> = {
    ...scopeFilter,
    taskState: { $ne: "archived" },
  };
  if (priorityIntent) {
    // Priority intent surfaces open tasks only, ordered by score. Mongo sorts
    // missing/null fields last on a descending sort, so scored tasks come
    // first; unscored ones are re-ordered in code below.
    filter.status = { $ne: "done" };
  }

  const candidates: any[] = await db
    .collection("tasks")
    .find(filter, { projection: TASK_CANDIDATE_PROJECTION })
    .sort(
      priorityIntent
        ? { priorityScore: -1, lastUpdated: -1, _id: -1 }
        : { lastUpdated: -1, _id: -1 }
    )
    .limit(TASK_CANDIDATE_LIMIT)
    .toArray();

  const scored = candidates
    .map((doc) => {
      const title = typeof doc?.title === "string" ? doc.title : "";
      const description =
        typeof doc?.description === "string" ? doc.description : "";
      const assigneeName =
        typeof doc?.assigneeName === "string" ? doc.assigneeName : "";
      const status = typeof doc?.status === "string" ? doc.status : "todo";
      const dueAt = toDate(doc?.dueAt);
      const overdue =
        Boolean(dueAt) && dueAt!.getTime() < now.getTime() && status !== "done";

      const score =
        scoreText(title, query.tokens) * TASK_TITLE_WEIGHT +
        scoreText(description, query.tokens) * TASK_DESCRIPTION_WEIGHT +
        scoreText(assigneeName, query.tokens) * TASK_ASSIGNEE_WEIGHT +
        (countPhraseMatches(title, query.phrases) +
          countPhraseMatches(description, query.phrases)) *
          PHRASE_BONUS;

      return {
        id: String(doc?._id ?? ""),
        title: title.trim() || "Untitled task",
        status,
        dueAt: toIsoString(doc?.dueAt),
        assigneeName: assigneeName.trim() || null,
        overdue,
        sourceSessionId:
          typeof doc?.sourceSessionId === "string" && doc.sourceSessionId
            ? doc.sourceSessionId
            : null,
        priorityLabel:
          typeof doc?.priorityLabel === "string" && doc.priorityLabel
            ? doc.priorityLabel
            : null,
        priorityScore:
          typeof doc?.priorityScore === "number" &&
          Number.isFinite(doc.priorityScore)
            ? doc.priorityScore
            : null,
        score,
      };
    })
    .filter(
      (task) =>
        task.id &&
        (task.score > 0 ||
          (overdueIntent && task.overdue) ||
          (priorityIntent && task.status !== "done"))
    );

  const compareDueAt = (a: RetrievedTask, b: RetrievedTask): number => {
    const aDue = a.dueAt ? new Date(a.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
    const bDue = b.dueAt ? new Date(b.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
    return aDue - bDue;
  };

  scored.sort((a, b) => {
    if (priorityIntent) {
      // priorityScore desc, scored before unscored; unscored fall back to
      // overdue-first then earliest due date.
      const aScore = typeof a.priorityScore === "number" ? a.priorityScore : null;
      const bScore = typeof b.priorityScore === "number" ? b.priorityScore : null;
      if (aScore !== null || bScore !== null) {
        if (aScore === null) return 1;
        if (bScore === null) return -1;
        if (aScore !== bScore) return bScore - aScore;
      } else {
        if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
        const dueDiff = compareDueAt(a, b);
        if (dueDiff !== 0) return dueDiff;
      }
    }
    if (overdueIntent && a.overdue !== b.overdue) {
      return a.overdue ? -1 : 1;
    }
    if (b.score !== a.score) return b.score - a.score;
    return compareDueAt(a, b);
  });

  return scored.slice(0, maxTasks);
};

const normalizePersonType = (
  value: unknown
): "teammate" | "client" | "unknown" => {
  if (value === "teammate" || value === "client") return value;
  return "unknown";
};

const retrievePeople = async (
  db: any,
  scopeFilter: Record<string, any>,
  question: string,
  query: QuestionTokens,
  maxPeople: number,
  clientIntent: boolean
): Promise<RetrievedPerson[]> => {
  const hasSignal = query.tokens.length > 0 || query.phrases.length > 0;
  if (!hasSignal && !clientIntent) return [];

  const candidates: any[] = await db
    .collection("people")
    .find({ ...scopeFilter }, { projection: PEOPLE_CANDIDATE_PROJECTION })
    .sort({ lastSeenAt: -1, _id: -1 })
    .limit(PEOPLE_CANDIDATE_LIMIT)
    .toArray();

  const questionWords = normalizeToWords(question).join(" ");

  const scored = candidates
    .map((doc) => {
      const name = typeof doc?.name === "string" ? doc.name : "";
      const email = typeof doc?.email === "string" ? doc.email : "";
      const aliases = Array.isArray(doc?.aliases)
        ? doc.aliases.filter((alias: unknown) => typeof alias === "string")
        : [];
      const personType = normalizePersonType(doc?.personType);

      let score = 0;
      const normalizedName = normalizeToWords(name).join(" ");
      if (
        normalizedName &&
        normalizedName.includes(" ") &&
        questionWords.includes(normalizedName)
      ) {
        // Full name appears verbatim in the question — exact match beats
        // partial token overlap.
        score += PERSON_EXACT_NAME_BONUS;
      }
      score += scoreText(name, query.tokens) * PERSON_NAME_TOKEN_WEIGHT;
      score += scoreText(aliases.join(" "), query.tokens) * PERSON_ALIAS_WEIGHT;

      if (email) {
        const emailLower = email.trim().toLowerCase();
        const localPart = emailLower.split("@")[0] || "";
        if (
          query.tokens.includes(emailLower) ||
          (localPart.length >= 3 && query.tokens.includes(localPart))
        ) {
          score += PERSON_EMAIL_WEIGHT;
        }
      }

      if (clientIntent && personType === "client") {
        score += PERSON_CLIENT_INTENT_BOOST;
      }

      return {
        id: String(doc?._id ?? ""),
        name: name.trim() || "Unknown person",
        email: email.trim() || null,
        personType,
        score,
      };
    })
    .filter((person) => person.id && person.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  return scored.slice(0, maxPeople);
};

/**
 * Hybrid retrieval over the workspace's meetings, transcripts, tasks, and
 * people: semantic chunk similarity (when embeddings are available) combined
 * with keyword scoring, recency boost, and structured intents. Returns
 * capped, scored context for the general AI chat. Degrades to keyword-only
 * behavior when embeddings are unavailable — never throws.
 */
export const searchWorkspaceContext = async (
  db: any,
  scope: WorkspaceRetrievalScope,
  question: string,
  opts: WorkspaceRetrievalOptions = {}
): Promise<WorkspaceRetrievalResult> => {
  const query = tokenize(question);
  const rawQuestion = typeof question === "string" ? question : "";
  const overdueIntent = OVERDUE_INTENT_REGEX.test(rawQuestion);
  const clientIntent = CLIENT_INTENT_REGEX.test(rawQuestion);
  const priorityIntent = PRIORITY_INTENT_REGEX.test(rawQuestion);

  const maxMeetings = clampLimit(opts.maxMeetings, DEFAULT_MAX_MEETINGS);
  const maxTasks = clampLimit(opts.maxTasks, DEFAULT_MAX_TASKS);
  const maxPeople = clampLimit(opts.maxPeople, DEFAULT_MAX_PEOPLE);

  const scopeFilter = buildScopeFilter(scope);
  const now = new Date();

  const [meetings, tasks, people] = await Promise.all([
    retrieveSemanticMeetingHits(db, scopeFilter, rawQuestion).then(
      (semanticHits) =>
        retrieveMeetings(db, scopeFilter, query, maxMeetings, now, semanticHits)
    ),
    retrieveTasks(
      db,
      scopeFilter,
      query,
      maxTasks,
      overdueIntent,
      priorityIntent,
      now
    ),
    retrievePeople(db, scopeFilter, rawQuestion, query, maxPeople, clientIntent),
  ]);

  return {
    meetings,
    tasks,
    people,
    isEmpty: !meetings.length && !tasks.length && !people.length,
  };
};
