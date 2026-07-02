import {
  buildAssigneeKey,
  buildEmbeddingText,
  candidateKeyForTask,
  chunkCandidates,
  cosineSimilarity,
  dedupeCompletionSnippets,
  extractCompletionSnippets,
  jaccardSimilarity,
  normalizeEmail,
  parseTranscriptLine,
  splitSentences,
  toTokenSet,
} from "@/lib/task-completion-helpers";

describe("task-completion-helpers", () => {
  describe("normalizeEmail", () => {
    it("trims and lowercases email addresses", () => {
      expect(normalizeEmail("  Alice@Example.com ")).toBe("alice@example.com");
    });

    it("returns an empty string for missing input", () => {
      expect(normalizeEmail(undefined)).toBe("");
    });
  });

  describe("buildAssigneeKey", () => {
    it("prefers email over name", () => {
      expect(buildAssigneeKey("Alice", "Alice@Example.com")).toBe(
        "email:alice@example.com"
      );
    });

    it("falls back to normalized name", () => {
      expect(buildAssigneeKey(" Alice Smith ", null)).toBe("name:alice smith");
    });

    it("returns unassigned when allowed", () => {
      expect(buildAssigneeKey(null, null, true)).toBe("unassigned");
    });
  });

  describe("splitSentences", () => {
    it("splits on sentence punctuation and trims whitespace", () => {
      expect(splitSentences("Done. Great! Next?")).toEqual(["Done", "Great", "Next?"]);
    });
  });

  describe("parseTranscriptLine", () => {
    it("extracts timestamp, speaker, and text when present", () => {
      expect(parseTranscriptLine("12:03 - Alice: We shipped it")).toEqual({
        timestamp: "12:03",
        speaker: "Alice",
        text: "We shipped it",
      });
    });
  });

  describe("extractCompletionSnippets", () => {
    it("collects completion cues from transcript lines", () => {
      expect(
        extractCompletionSnippets("12:03 - Alice: We shipped it.\n13:10 - Bob: Great, thanks.")
      ).toEqual([
        {
          text: "We shipped it.",
          speaker: "Alice",
          timestamp: "12:03",
        },
      ]);
    });
  });

  describe("dedupeCompletionSnippets", () => {
    it("removes duplicate snippets by normalized title", () => {
      expect(
        dedupeCompletionSnippets([
          { text: "We shipped it", speaker: "Alice" },
          { text: " we shipped it ", speaker: "Bob" },
        ])
      ).toEqual([{ text: "We shipped it", speaker: "Alice" }]);
    });
  });

  describe("buildEmbeddingText", () => {
    it("joins title and description and trims to the configured limit", () => {
      const text = buildEmbeddingText("Title", "Description");
      expect(text).toBe("Title Description");
    });
  });

  describe("toTokenSet", () => {
    it("normalizes tokens into a set", () => {
      expect(toTokenSet("Hello, world!")).toEqual(new Set(["hello", "world"]));
    });
  });

  describe("jaccardSimilarity", () => {
    it("computes overlap across token sets", () => {
      expect(
        jaccardSimilarity(new Set(["a", "b"]), new Set(["b", "c"]))
      ).toBeCloseTo(1 / 3);
    });
  });

  describe("cosineSimilarity", () => {
    it("computes vector similarity", () => {
      expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
    });
  });

  describe("chunkCandidates", () => {
    it("chunks arrays into fixed sizes", () => {
      expect(chunkCandidates([1, 2, 3, 4, 5], 2)).toEqual([
        [1, 2],
        [3, 4],
        [5],
      ]);
    });
  });

  describe("candidateKeyForTask", () => {
    it("builds a stable candidate key", () => {
      expect(candidateKeyForTask(" Fix the bug ", "email:alice@example.com")).toBe(
        "fix the bug|email:alice@example.com"
      );
    });
  });
});
