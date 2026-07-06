import {
  findTranscriptLineIndex,
  normalizeTranscriptText,
  splitTranscriptLines,
  transcriptLineDomId,
} from "@/lib/transcript-navigation";

const TRANSCRIPT = [
  "[00:12] Ana: Welcome everyone, let's get started.",
  "[01:30] Stefan: The pricing feels too high for phase one.",
  "[02:05] Ana: I already sent the updated proposal to legal yesterday.",
  "[03:44] Mia: We should schedule the follow-up demo next week.",
].join("\n");

describe("splitTranscriptLines", () => {
  it("splits on newlines, trims, and drops empty lines", () => {
    const lines = splitTranscriptLines("  a \n\n b\r\n\n  \nc  ");
    expect(lines).toEqual(["a", "b", "c"]);
  });
});

describe("normalizeTranscriptText", () => {
  it("strips timestamps and punctuation and lowercases", () => {
    expect(
      normalizeTranscriptText("[01:30] Stefan: The pricing feels too high!")
    ).toBe("stefan the pricing feels too high");
  });
});

describe("findTranscriptLineIndex", () => {
  const lines = splitTranscriptLines(TRANSCRIPT);

  it("finds a line by exact snippet containment despite timestamps/punctuation", () => {
    expect(
      findTranscriptLineIndex(lines, "pricing feels too high for phase one")
    ).toBe(1);
  });

  it("finds a line when the snippet contains the whole line", () => {
    expect(
      findTranscriptLineIndex(
        lines,
        "Stefan said: [01:30] Stefan: The pricing feels too high for phase one. That was the key concern."
      )
    ).toBe(1);
  });

  it("falls back to token-overlap matching for paraphrased snippets", () => {
    expect(
      findTranscriptLineIndex(lines, "sent updated proposal legal")
    ).toBe(2);
  });

  it("returns -1 when nothing matches confidently", () => {
    expect(
      findTranscriptLineIndex(lines, "quarterly budget forecast spreadsheet review")
    ).toBe(-1);
  });

  it("returns -1 for empty snippets or empty transcripts", () => {
    expect(findTranscriptLineIndex(lines, "")).toBe(-1);
    expect(findTranscriptLineIndex(lines, "  [01:30]  ")).toBe(-1);
    expect(findTranscriptLineIndex([], "pricing")).toBe(-1);
  });
});

describe("transcriptLineDomId", () => {
  it("produces stable ids per line index", () => {
    expect(transcriptLineDomId(0)).toBe("meeting-transcript-line-0");
    expect(transcriptLineDomId(12)).toBe("meeting-transcript-line-12");
  });
});
