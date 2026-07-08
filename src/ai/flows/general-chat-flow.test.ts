import { runPromptWithFallback } from "@/ai/prompt-fallback";
import {
  answerMeetingQuestion,
  answerWorkspaceQuestion,
  selectRelevantTranscript,
} from "@/ai/flows/general-chat-flow";

jest.mock("@/ai/genkit", () => ({
  ai: {
    definePrompt: jest.fn(() => jest.fn()),
    defineFlow: jest.fn((_config: unknown, handler: unknown) => handler),
  },
}));

jest.mock("@/ai/prompt-fallback", () => ({
  runPromptWithFallback: jest.fn(),
}));

const mockedRunPrompt = runPromptWithFallback as jest.MockedFunction<
  typeof runPromptWithFallback
>;

const meetingInput = {
  question: "What did Stefan say about pricing?",
  meetingId: "m1",
  meetingTitle: "Redesign kickoff",
  meetingDate: "2026-06-28",
  summary: "Scope and pricing discussion.",
  transcript:
    "12:30 - Stefan: The pricing feels too high for phase one.\n12:45 - Ana: Agreed, let's rework it.",
  today: "2026-07-06",
};

describe("answerMeetingQuestion", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns the unified contract when the model answers with valid JSON", async () => {
    mockedRunPrompt.mockResolvedValue({
      output: {
        answer: "Stefan said pricing is too high for phase one.",
        confidence: "high",
        sources: [
          {
            sourceType: "transcript",
            sourceId: "m1",
            title: "Redesign kickoff",
            snippet: "12:30 - Stefan: The pricing feels too high for phase one.",
            timestamp: "12:30",
          },
        ],
        suggestedActions: [
          { label: "Open meeting", actionType: "open_meeting", targetId: "m1" },
        ],
      },
      text: "",
    } as any);

    const result = await answerMeetingQuestion(meetingInput, {
      correlationId: "corr-1",
      userId: "user-1",
    });

    expect(result.answer).toContain("pricing is too high");
    expect(result.confidence).toBe("high");
    expect(result.sources[0]).toMatchObject({
      sourceType: "transcript",
      sourceId: "m1",
      timestamp: "12:30",
    });

    // gpt-4o-mini via runPromptWithFallback, transcript included in the input.
    const [, promptInput, options, meta] = mockedRunPrompt.mock.calls[0];
    expect((promptInput as any).transcript).toContain("Stefan: The pricing");
    expect((options as any).config.model).toBe("gpt-4o-mini");
    expect(meta).toMatchObject({
      operation: "meetingChat",
      correlationId: "corr-1",
      userId: "user-1",
    });
  });

  it("never throws: degrades to a deterministic transcript-cited fallback when the LLM fails", async () => {
    mockedRunPrompt.mockRejectedValue(new Error("model down"));
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    const result = await answerMeetingQuestion(meetingInput, {
      userId: "user-1",
    });

    expect(result.confidence).toBe("low");
    expect(result.answer).toContain("Redesign kickoff");
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]).toMatchObject({
      sourceType: "transcript",
      sourceId: "m1",
    });
    warnSpy.mockRestore();
  });
});

describe("answerWorkspaceQuestion history support", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("passes the trimmed history block to the prompt", async () => {
    mockedRunPrompt.mockResolvedValue({
      output: {
        answer: "ok",
        confidence: "low",
        sources: [],
        suggestedActions: [],
      },
      text: "",
    } as any);

    await answerWorkspaceQuestion(
      {
        question: "who owns it?",
        contextBlocks: "TASK t1 | Send proposal | status=todo | due=none",
        today: "2026-07-06",
        history: "User: which tasks are overdue?\nAssistant: Send proposal.",
      },
      { userId: "user-1" }
    );

    const [, promptInput] = mockedRunPrompt.mock.calls[0];
    expect((promptInput as any).history).toContain(
      "User: which tasks are overdue?"
    );
  });
});

describe("selectRelevantTranscript", () => {
  it("passes short transcripts through untouched", () => {
    const transcript = "00:01 - A: hello\n00:02 - B: world";
    expect(selectRelevantTranscript(transcript, "anything")).toBe(transcript);
  });

  it("reduces long transcripts to question-relevant lines plus neighbors", () => {
    const filler = Array.from(
      { length: 300 },
      (_, index) => `${index}:00 - Speaker: unrelated chatter line ${index}`
    );
    filler[150] = "150:00 - Stefan: the pricing proposal needs another pass";
    const transcript = filler.join("\n");

    const reduced = selectRelevantTranscript(
      transcript,
      "What about the pricing proposal?"
    );

    expect(reduced.length).toBeLessThan(transcript.length);
    expect(reduced).toContain("pricing proposal needs another pass");
    // Neighbor lines are kept for context.
    expect(reduced).toContain("unrelated chatter line 149");
    expect(reduced).toContain("unrelated chatter line 151");
  });
});
