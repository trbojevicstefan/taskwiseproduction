import {
  buildThreadContext,
  resolveThreadFollowUp,
} from "@/lib/chat-thread-context";

describe("chat-thread-context", () => {
  it("resolves ordinal meeting follow-ups from grounded assistant sources", () => {
    const context = buildThreadContext([
      {
        role: "assistant",
        text: "You had 2 meetings this week.",
        sources: [
          {
            sourceType: "meeting",
            sourceId: "m1",
            title: "Kickoff",
            snippet: "Kickoff",
          },
          {
            sourceType: "meeting",
            sourceId: "m2",
            title: "Retro",
            snippet: "Retro",
          },
        ],
      },
    ]);

    expect(resolveThreadFollowUp("Who attended the first one?", context)).toEqual(
      {
        kind: "meeting",
        meetingId: "m1",
      }
    );
  });

  it("resolves person follow-ups into retrieval enrichment", () => {
    const context = buildThreadContext([
      {
        role: "assistant",
        text: "Stefan raised pricing concerns.",
        sources: [
          {
            sourceType: "person",
            sourceId: "p1",
            title: "Stefan Ionescu",
            snippet: "Stefan Ionescu",
          },
        ],
      },
    ]);

    expect(resolveThreadFollowUp("What tasks does he own?", context)).toEqual(
      expect.objectContaining({
        kind: "retrieval_enrichment",
        entityId: "p1",
      })
    );
  });

  it("returns ambiguity instead of guessing when a singular meeting reference has multiple candidates", () => {
    const context = buildThreadContext([
      {
        role: "assistant",
        text: "You had 2 meetings this week.",
        sources: [
          {
            sourceType: "meeting",
            sourceId: "m1",
            title: "Kickoff",
            snippet: "Kickoff",
          },
          {
            sourceType: "meeting",
            sourceId: "m2",
            title: "Retro",
            snippet: "Retro",
          },
        ],
      },
    ]);

    expect(
      resolveThreadFollowUp("What happened in that meeting?", context)
    ).toEqual({ kind: "ambiguous", entityType: "meeting" });
  });
});
