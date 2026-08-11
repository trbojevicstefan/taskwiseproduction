import {
  collectSyntheticEvidenceSourceIds,
  parseSyntheticGroundedAnswer,
  parseSyntheticToolArguments,
} from "./test-openai-mcp-chat-contract";

describe("OpenAI MCP chat live-probe contract", () => {
  const evidence = {
    meetings: [
      {
        id: "synthetic-meeting-en",
        title: "Synthetic renewal review",
        summary: "The team approved the annual renewal.",
      },
    ],
  };

  it("accepts only the single declared read-tool argument", () => {
    expect(parseSyntheticToolArguments('{"query":"renewal"}')).toEqual({
      query: "renewal",
    });
    expect(() =>
      parseSyntheticToolArguments('{"query":"renewal","workspaceId":"other"}')
    ).toThrow(/unexpected tool arguments/i);
  });

  it("parses the exact production answer schema and grounds every source in observed evidence", () => {
    const observed = collectSyntheticEvidenceSourceIds(evidence);
    const answer = {
      answer: "The annual renewal was approved.",
      confidence: "high",
      sources: [
        {
          sourceType: "meeting",
          sourceId: "synthetic-meeting-en",
          title: "Synthetic renewal review",
          snippet: "The team approved the annual renewal.",
        },
      ],
      suggestedActions: [],
    };

    expect(parseSyntheticGroundedAnswer(JSON.stringify(answer), observed)).toEqual(
      answer
    );
    expect(() =>
      parseSyntheticGroundedAnswer(
        JSON.stringify({ answer: "Old probe shape", language: "en", grounded: true }),
        observed
      )
    ).toThrow(/production GeneralChatAnswer/i);
    expect(() =>
      parseSyntheticGroundedAnswer(
        JSON.stringify({
          ...answer,
          sources: [{ ...answer.sources[0], sourceId: "fabricated-meeting" }],
        }),
        observed
      )
    ).toThrow(/not present in synthetic tool evidence/i);
  });
});
