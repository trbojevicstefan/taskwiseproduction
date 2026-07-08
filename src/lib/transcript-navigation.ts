// src/lib/transcript-navigation.ts
/**
 * Client-side transcript source navigation (Priority 13).
 *
 * Evidence snippets shown on the meeting detail page (completion suggestions,
 * report sources, key moments) carry a "jump to transcript" affordance. These
 * helpers locate the transcript line that best matches a snippet so the UI can
 * scroll to and highlight it. Matching is best-effort text matching — when no
 * line matches confidently the caller must no-op gracefully.
 */

/** Minimum token-overlap ratio for a fuzzy line match. */
const MIN_TOKEN_OVERLAP_RATIO = 0.6;
/** Reverse containment (snippet contains line) needs a non-trivial line. */
const MIN_REVERSE_CONTAINMENT_CHARS = 12;

/**
 * Split a transcript into the display lines the viewer renders. Matching and
 * rendering must use the same splitter so indexes line up with DOM ids.
 */
export const splitTranscriptLines = (transcript: string): string[] =>
  transcript
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

/** Lowercase, drop timestamps/punctuation, collapse whitespace. */
export const normalizeTranscriptText = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[[(]?\b\d{1,2}:\d{2}(?::\d{2})?\b[\])]?/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Find the transcript line index that best matches an evidence snippet.
 * Strategy: exact normalized containment (either direction) first, then a
 * token-overlap fallback. Returns -1 when nothing matches confidently.
 */
export const findTranscriptLineIndex = (
  lines: string[],
  snippet: string
): number => {
  const target = normalizeTranscriptText(snippet || "");
  if (!target || !lines.length) return -1;

  const normalizedLines = lines.map(normalizeTranscriptText);

  const containmentIndex = normalizedLines.findIndex(
    (line) =>
      Boolean(line) &&
      (line.includes(target) ||
        (line.length >= MIN_REVERSE_CONTAINMENT_CHARS && target.includes(line)))
  );
  if (containmentIndex !== -1) return containmentIndex;

  const targetTokens = new Set(
    target.split(" ").filter((token) => token.length > 2)
  );
  if (!targetTokens.size) return -1;

  let bestIndex = -1;
  let bestScore = 0;
  normalizedLines.forEach((line, index) => {
    if (!line) return;
    const lineTokens = new Set(line.split(" "));
    let hits = 0;
    targetTokens.forEach((token) => {
      if (lineTokens.has(token)) hits += 1;
    });
    const score = hits / targetTokens.size;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });

  return bestScore >= MIN_TOKEN_OVERLAP_RATIO ? bestIndex : -1;
};

/** Stable DOM id for a rendered transcript line. */
export const transcriptLineDomId = (index: number): string =>
  `meeting-transcript-line-${index}`;
