import { createHash } from "crypto";
import { normalizeTitleKey } from "@/lib/ai-utils";

type CompletionSnippet = {
  text: string;
  speaker?: string;
  timestamp?: string;
};

const UNASSIGNED_LABELS = new Set([
  "unassigned",
  "unknown",
  "none",
  "na",
  "n a",
  "tbd",
  "un assigned",
]);

const TASK_COMPLETION_TITLE_CAP = Math.min(
  120,
  Math.max(60, Number(process.env.TASK_COMPLETION_TITLE_CAP || 96))
);

const COMPLETION_CUE_REGEX =
  /\b(done|complete|completed|finished|resolved|fixed|shipped|delivered|launched|closed|closed out|wrapped up|wrapped|already did|already done|already handled|already taken care of|handled|taken care of|sorted|sorted out|checked off|signed off|approved|submitted|sent|filed|paid|merged|deployed|published|released|live|went live|in prod|in production|rolled out|ready|in place|all set|good to go|bought|purchased|acquired|ordered|booked|scheduled|set up|setup|implemented|configured|installed)\b/i;
const COMPLETION_NEGATION_REGEX =
  /\b(?:not|never|no|hasn't|haven't|didn't|isn't|wasn't|can't|cannot|won't)\b[^.]{0,32}\b(?:done|complete|completed|finished|resolved|fixed|handled|taken care of|bought|purchased|ready|live|shipped|delivered|launched|approved)\b/i;
const GENERIC_COMPLETION_REGEX =
  /\b(?:that|it|this|task)\b.*\b(?:done|complete|completed|finished|resolved|fixed)\b/i;

// EXPLICIT completion cues — a strict subset of COMPLETION_CUE_REGEX. These are
// unambiguous "the work is finished" verbs; implicit signals like "ready",
// "booked", "in place", or "scheduled" are deliberately excluded because they
// often describe state that predates or merely enables the task. Only evidence
// matching this list may drive completion auto-apply (Priority 7 policy).
const EXPLICIT_COMPLETION_REGEX =
  /\b(done|complete|completed|finished|finalized|resolved|closed|closed out|wrapped up|shipped|delivered|deployed|published|released|launched|merged|submitted|signed off|already did|already done|already handled)\b/i;
// Blocker/failure language always disqualifies evidence from auto-apply, even
// when an explicit cue is present ("tried to deploy it but it failed").
const COMPLETION_BLOCKER_REGEX =
  /\b(blocked|blocker|failed|failing|failure|error(?:s|ed)?|broken|stuck|retry(?:ing)?|rolled back|reverted|still need|needs? to|have to|going to|will (?:do|finish|complete|ship|deploy)|next week|tomorrow)\b/i;

/**
 * True only when the evidence snippet explicitly states the work is finished:
 * an explicit completion verb, no negation ("not done yet"), and no
 * blocker/failure/future-intent language. Used to gate completion auto-apply.
 */
export const isExplicitCompletionEvidence = (snippet?: string | null): boolean => {
  const text = typeof snippet === "string" ? snippet.trim() : "";
  if (!text) return false;
  if (!EXPLICIT_COMPLETION_REGEX.test(text)) return false;
  if (COMPLETION_NEGATION_REGEX.test(text)) return false;
  if (COMPLETION_BLOCKER_REGEX.test(text)) return false;
  return true;
};

/**
 * Stable fingerprint for a piece of completion evidence, used as rejection
 * memory: when a reviewer rejects a completion suggestion, the fingerprints of
 * its evidence snippets are stored on the task
 * (`completionRejectedFingerprints`, a DB-internal field like `embedding`) and
 * the same evidence is never suggested again for that task.
 *
 * The fingerprint is a sha256 of the punctuation/case/whitespace-insensitive
 * snippet text (via normalizeTitleKey) — deliberately NOT scoped to a meeting
 * id: the suggestion pipeline runs on some ingest paths before the meeting doc
 * exists (so a meeting-scoped hash could not be recomputed at check time), and
 * re-ingests/duplicate webhooks of the same transcript must hit the same
 * fingerprint. Scoping is provided by storing fingerprints per task.
 */
export const buildCompletionEvidenceFingerprint = (
  snippet?: string | null
): string => {
  const normalized = normalizeTitleKey(
    typeof snippet === "string" ? snippet : ""
  );
  if (!normalized) return "";
  return createHash("sha256").update(normalized).digest("hex");
};

export const normalizeEmail = (value?: string | null) =>
  value ? value.trim().toLowerCase() : "";

export const normalizeAssigneeName = (value?: string | null) => {
  if (!value) return "";
  const normalized = normalizeTitleKey(value);
  if (!normalized) return "";
  if (UNASSIGNED_LABELS.has(normalized)) return "";
  return normalized;
};

export const buildAssigneeKey = (
  name?: string | null,
  email?: string | null,
  allowUnassigned = false
) => {
  const normalizedEmail = normalizeEmail(email);
  if (normalizedEmail) return `email:${normalizedEmail}`;
  const normalizedName = normalizeAssigneeName(name);
  if (normalizedName) return `name:${normalizedName}`;
  return allowUnassigned ? "unassigned" : "";
};

export const toCompactCandidateTitle = (value?: string | null) => {
  const title = typeof value === "string" ? value.trim() : "";
  if (!title) return "";
  if (title.length <= TASK_COMPLETION_TITLE_CAP) return title;
  return `${title.slice(0, TASK_COMPLETION_TITLE_CAP - 3).trim()}...`;
};

export const matchesAttendee = (
  assigneeName?: string | null,
  assigneeEmail?: string | null,
  attendeeNames = new Set<string>(),
  attendeeEmails = new Set<string>(),
  allowUnassigned = false
) => {
  const normalizedEmail = normalizeEmail(assigneeEmail);
  if (normalizedEmail && attendeeEmails.has(normalizedEmail)) return true;
  const normalizedName = normalizeAssigneeName(assigneeName);
  if (normalizedName && attendeeNames.has(normalizedName)) return true;
  if (allowUnassigned && !normalizedEmail && !normalizedName) return true;
  return false;
};

export const chunkCandidates = <T,>(items: T[], size: number): T[][] => {
  if (size <= 0) return [items];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
};

export const splitSentences = (text: string): string[] =>
  text
    .split(/(?:[.!?])\s+/)
    .map((sentence: any) => sentence.trim())
    .filter(Boolean);

export const parseTranscriptLine = (
  line: string
): { text: string; speaker?: string; timestamp?: string } => {
  const match = line.match(
    /^(?:(\d{1,2}:\d{2}(?::\d{2})?)\s*-\s*)?(?:(.+?):\s*)?(.+)$/
  );
  if (!match) {
    return { text: line.trim() };
  }
  return {
    timestamp: match[1],
    speaker: match[2]?.trim(),
    text: match[3]?.trim() || "",
  };
};

export const isGenericCompletion = (text: string) => {
  const normalized = normalizeTitleKey(text);
  if (!normalized) return true;
  const wordCount = normalized.split(" ").filter(Boolean).length;
  return wordCount <= 6 && GENERIC_COMPLETION_REGEX.test(text);
};

export const extractCompletionSnippets = (transcript: string): CompletionSnippet[] => {
  const lines = transcript
    .split(/\r?\n/)
    .map((line: any) => line.trim())
    .filter(Boolean);
  const snippets: CompletionSnippet[] = [];
  const seen = new Set<string>();
  let lastLineText = "";

  for (const line of lines) {
    const parsed = parseTranscriptLine(line);
    if (!parsed.text) {
      lastLineText = "";
      continue;
    }
    const sentences = splitSentences(parsed.text);
    const hasCompletionCue = sentences.some(
      (sentence) =>
        COMPLETION_CUE_REGEX.test(sentence) &&
        !COMPLETION_NEGATION_REGEX.test(sentence)
    );
    if (!hasCompletionCue) {
      lastLineText = parsed.text;
      continue;
    }

    let snippetText = parsed.text;
    if (isGenericCompletion(parsed.text) && lastLineText) {
      snippetText = `${lastLineText} ${parsed.text}`.trim();
    }

    const key = normalizeTitleKey(snippetText);
    if (!key || seen.has(key)) {
      lastLineText = parsed.text;
      continue;
    }
    seen.add(key);
    snippets.push({
      text: snippetText,
      speaker: parsed.speaker,
      timestamp: parsed.timestamp,
    });
    lastLineText = parsed.text;
  }

  return snippets;
};

export const dedupeCompletionSnippets = (snippets: CompletionSnippet[]) => {
  const seen = new Set<string>();
  const deduped: CompletionSnippet[] = [];
  snippets.forEach((snippet: any) => {
    const key = normalizeTitleKey(snippet.text);
    if (!key || seen.has(key)) return;
    seen.add(key);
    deduped.push(snippet);
  });
  return deduped;
};

export const buildEmbeddingText = (title?: string | null, description?: string | null) => {
  const titleText = typeof title === "string" ? title.trim() : "";
  const descriptionText = typeof description === "string" ? description.trim() : "";
  const parts = [titleText, descriptionText].filter(Boolean);
  if (!parts.length) return "";
  const combined = parts.join(" ");
  return combined.length > 800 ? combined.slice(0, 800) : combined;
};

export const toTokenSet = (text: string): Set<string> => {
  const normalized = normalizeTitleKey(text);
  if (!normalized) return new Set();
  return new Set(normalized.split(" ").filter(Boolean));
};

export const jaccardSimilarity = (a: Set<string>, b: Set<string>) => {
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection += 1;
  }
  return intersection / (a.size + b.size - intersection);
};

export const cosineSimilarity = (a: number[], b: number[]) => {
  if (a.length !== b.length || !a.length) return 0;
  let dot = 0;
  let sumA = 0;
  let sumB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const valueA = a[i];
    const valueB = b[i];
    dot += valueA * valueB;
    sumA += valueA * valueA;
    sumB += valueB * valueB;
  }
  if (!sumA || !sumB) return 0;
  return dot / (Math.sqrt(sumA) * Math.sqrt(sumB));
};

export const candidateKeyForTask = (title: string, assigneeKey: string) => {
  const normalizedTitle = normalizeTitleKey(title);
  return `${normalizedTitle}|${assigneeKey}`;
};
