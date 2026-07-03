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
