import { runPromptWithFallback } from "@/ai/prompt-fallback";
import { detectCompletedTasks } from "@/ai/flows/detect-completed-tasks-flow";

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

describe("detectCompletedTasks", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("short-circuits with no LLM call when there are no candidates", async () => {
    const result = await detectCompletedTasks({
      transcript: "12:03 - Alice: We shipped it.",
      candidates: [],
    });

    expect(result).toEqual({ completed: [] });
    expect(mockedRunPrompt).not.toHaveBeenCalled();
  });

  it("parses a valid completion payload and passes candidates to the prompt", async () => {
    mockedRunPrompt.mockResolvedValue({
      output: {
        completed: [
          {
            groupId: "cand_1",
            confidence: 0.9,
            evidence: {
              snippet: "We shipped the API patch.",
              speaker: "Elena",
              timestamp: "22:01",
            },
          },
        ],
      },
      text: "",
    } as any);

    const result = await detectCompletedTasks({
      transcript: "22:01 - Elena: We shipped the API patch.",
      candidates: [
        { groupId: "cand_1", title: "Ship API patch", assigneeKey: "name:elena" },
        { groupId: "cand_2", title: "Write postmortem notes" },
      ],
    });

    expect(result.completed).toEqual([
      {
        groupId: "cand_1",
        confidence: 0.9,
        evidence: {
          snippet: "We shipped the API patch.",
          speaker: "Elena",
          timestamp: "22:01",
        },
      },
    ]);

    const [, promptInput] = mockedRunPrompt.mock.calls[0];
    expect((promptInput as any).transcript).toContain("We shipped the API patch");
    expect((promptInput as any).candidatesJson).toContain("cand_1");
    expect((promptInput as any).candidatesJson).toContain("cand_2");
  });

  it("defaults to an empty completed list when the model returns non-schema JSON", async () => {
    mockedRunPrompt.mockResolvedValue({
      output: { something: "else" },
      text: "",
    } as any);

    const result = await detectCompletedTasks({
      transcript: "12:03 - Alice: In progress.",
      candidates: [{ groupId: "cand_1", title: "Ship API patch" }],
    });

    expect(result).toEqual({ completed: [] });
  });
});
