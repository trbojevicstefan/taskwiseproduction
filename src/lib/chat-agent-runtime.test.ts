import { executeRegisteredMcpTool } from "@/lib/mcp-registry";
import { runScopedChatAgent } from "@/lib/chat-agent-runtime";

jest.mock("@/lib/mcp-registry", () => {
  const actual = jest.requireActual("@/lib/mcp-registry");
  return {
    ...actual,
    executeRegisteredMcpTool: jest.fn(),
  };
});

const mockedExecuteRegisteredMcpTool =
  executeRegisteredMcpTool as jest.MockedFunction<
    typeof executeRegisteredMcpTool
  >;
const originalFetch = global.fetch;
const originalApiKey = process.env.OPENAI_API_KEY;
const originalToolTimeout = process.env.OPENAI_CHAT_TOOL_TIMEOUT_MS;

const jsonResponse = (payload: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
    })
  );

const validAnswer = {
  answer: "The pricing concern came up in the kickoff.",
  confidence: "high" as const,
  sources: [
    {
      sourceType: "meeting" as const,
      sourceId: "meeting-1",
      title: "Kickoff",
      snippet: "Pricing concern",
    },
  ],
  suggestedActions: [
    {
      label: "Open kickoff",
      actionType: "open_meeting" as const,
      targetId: "meeting-1",
    },
  ],
};

const runAgent = () =>
  runScopedChatAgent({
    db: {} as any,
    workspaceId: "workspace-1",
    userId: "user-1",
    scope: { type: "workspace" },
    question: "What did we decide about pricing?",
    history: [{ role: "user", text: "Focus on the kickoff." }],
    memorySummary: "Earlier grounded discussion referenced meeting-1.",
    today: "2026-08-11",
  });

describe("runScopedChatAgent", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.OPENAI_API_KEY = "test-key";
    delete process.env.OPENAI_CHAT_TOOL_TIMEOUT_MS;
    mockedExecuteRegisteredMcpTool.mockResolvedValue({
      toolName: "search_workspace_knowledge",
      summary: "Found one meeting.",
      data: { meetings: [{ id: "meeting-1", title: "Kickoff" }] },
    });
  });

  afterAll(() => {
    global.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalApiKey;
    if (originalToolTimeout === undefined) {
      delete process.env.OPENAI_CHAT_TOOL_TIMEOUT_MS;
    } else {
      process.env.OPENAI_CHAT_TOOL_TIMEOUT_MS = originalToolTimeout;
    }
  });

  it("returns null without configuration and never calls the provider", async () => {
    delete process.env.OPENAI_API_KEY;
    global.fetch = jest.fn() as any;

    await expect(runAgent()).resolves.toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("sends a matching function_call_output and validates the final answer", async () => {
    const fetchMock = jest
      .fn()
      .mockImplementationOnce(() =>
        jsonResponse({
          id: "response-1",
          output: [
            {
              type: "function_call",
              call_id: "call-1",
              name: "search_workspace_knowledge",
              arguments: JSON.stringify({
                query: "pricing",
                scopeType: "workspace",
              }),
            },
          ],
        })
      )
      .mockImplementationOnce(() =>
        jsonResponse({
          id: "response-2",
          output: [
            { type: "reasoning", summary: [{ type: "summary_text", text: "hidden" }] },
            {
              type: "message",
              content: [
                { type: "output_text", text: JSON.stringify(validAnswer) },
              ],
            },
          ],
        })
      );
    global.fetch = fetchMock as any;

    await expect(runAgent()).resolves.toEqual(validAnswer);
    expect(mockedExecuteRegisteredMcpTool).toHaveBeenCalledTimes(1);

    const firstBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(firstBody.model).toBe("gpt-4.1-mini");
    expect(firstBody.tools.every((tool: any) => tool.strict === false)).toBe(true);
    expect(firstBody.input).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "developer" }),
        expect.objectContaining({ role: "user" }),
      ])
    );
    expect(JSON.stringify(firstBody.input)).toContain("Earlier grounded discussion");

    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(secondBody.input).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "function_call_output",
          call_id: "call-1",
          output: expect.any(String),
        }),
      ])
    );
  });

  it("filters sources and actions to ids observed in authorized tool output", async () => {
    global.fetch = jest
      .fn()
      .mockImplementationOnce(() =>
        jsonResponse({
          id: "response-1",
          output: [
            {
              type: "function_call",
              call_id: "call-1",
              name: "search_workspace_knowledge",
              arguments: '{"query":"pricing"}',
            },
          ],
        })
      )
      .mockImplementationOnce(() =>
        jsonResponse({
          output_text: JSON.stringify({
            ...validAnswer,
            sources: [
              ...validAnswer.sources,
              {
                sourceType: "meeting",
                sourceId: "fabricated-meeting",
                title: "Fabricated",
                snippet: "Not observed",
              },
            ],
            suggestedActions: [
              ...validAnswer.suggestedActions,
              {
                label: "Open fabricated",
                actionType: "open_meeting",
                targetId: "fabricated-meeting",
              },
            ],
          }),
          output: [],
        })
      ) as any;

    const result = await runAgent();

    expect(result?.sources).toEqual(validAnswer.sources);
    expect(result?.suggestedActions).toEqual(validAnswer.suggestedActions);
  });

  it("returns an unknown tool as a safe output and never executes it", async () => {
    const fetchMock = jest
      .fn()
      .mockImplementationOnce(() =>
        jsonResponse({
          id: "response-1",
          output: [
            {
              type: "function_call",
              call_id: "call-unknown",
              name: "delete_everything",
              arguments: "{}",
            },
          ],
        })
      )
      .mockImplementationOnce(() =>
        jsonResponse({
          output_text: JSON.stringify({
            answer: "I could not access that information.",
            confidence: "low",
            sources: [],
            suggestedActions: [],
          }),
          output: [],
        })
      );
    global.fetch = fetchMock as any;

    await expect(runAgent()).resolves.toMatchObject({ confidence: "low" });
    expect(mockedExecuteRegisteredMcpTool).not.toHaveBeenCalled();
    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    const output = secondBody.input.find(
      (item: any) => item.type === "function_call_output"
    );
    expect(output.call_id).toBe("call-unknown");
    expect(output.output).toContain("tool_not_available");
  });

  it("rejects repeated identical calls", async () => {
    const repeatedCall = {
      type: "function_call",
      name: "search_workspace_knowledge",
      arguments: '{"query":"pricing"}',
    };
    global.fetch = jest
      .fn()
      .mockImplementationOnce(() =>
        jsonResponse({
          id: "response-1",
          output: [{ ...repeatedCall, call_id: "call-1" }],
        })
      )
      .mockImplementationOnce(() =>
        jsonResponse({
          id: "response-2",
          output: [{ ...repeatedCall, call_id: "call-2" }],
        })
      ) as any;

    await expect(runAgent()).resolves.toBeNull();
    expect(mockedExecuteRegisteredMcpTool).toHaveBeenCalledTimes(1);
  });

  it("executes at most twelve calls and six response rounds", async () => {
    const calls = Array.from({ length: 13 }, (_, index) => ({
      type: "function_call",
      call_id: `call-${index}`,
      name: "search_workspace_knowledge",
      arguments: JSON.stringify({ query: `query-${index}` }),
    }));
    global.fetch = jest.fn().mockImplementationOnce(() =>
      jsonResponse({ id: "response-1", output: calls })
    ) as any;

    await expect(runAgent()).resolves.toBeNull();
    expect(mockedExecuteRegisteredMcpTool).toHaveBeenCalledTimes(12);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    const roundFetch = jest.fn();
    for (let index = 0; index < 6; index += 1) {
      roundFetch.mockImplementationOnce(() =>
        jsonResponse({
          id: `response-${index}`,
          output: [
            {
              type: "function_call",
              call_id: `round-call-${index}`,
              name: "search_workspace_knowledge",
              arguments: JSON.stringify({ query: `round-${index}` }),
            },
          ],
        })
      );
    }
    global.fetch = roundFetch as any;
    mockedExecuteRegisteredMcpTool.mockClear();

    await expect(runAgent()).resolves.toBeNull();
    expect(roundFetch).toHaveBeenCalledTimes(6);
    expect(mockedExecuteRegisteredMcpTool).toHaveBeenCalledTimes(6);
  });

  it("caps each tool output at 12,000 chars and aggregate evidence at 40,000", async () => {
    mockedExecuteRegisteredMcpTool.mockImplementation(async (_ctx, _name, args) => ({
      toolName: "search_workspace_knowledge",
      summary: "large",
      data: { id: String(args?.query), text: "x".repeat(20_000) },
    }));
    const fetchMock = jest
      .fn()
      .mockImplementationOnce(() =>
        jsonResponse({
          id: "response-1",
          output: Array.from({ length: 4 }, (_, index) => ({
            type: "function_call",
            call_id: `call-${index}`,
            name: "search_workspace_knowledge",
            arguments: JSON.stringify({ query: `query-${index}` }),
          })),
        })
      )
      .mockImplementationOnce(() =>
        jsonResponse({
          output_text: JSON.stringify({
            answer: "Bounded answer.",
            confidence: "low",
            sources: [],
            suggestedActions: [],
          }),
          output: [],
        })
      );
    global.fetch = fetchMock as any;

    await expect(runAgent()).resolves.toMatchObject({ answer: "Bounded answer." });
    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    const outputs = secondBody.input.filter(
      (item: any) => item.type === "function_call_output"
    );
    expect(outputs).toHaveLength(4);
    expect(outputs.every((item: any) => item.output.length <= 12_000)).toBe(true);
    expect(
      outputs.reduce((total: number, item: any) => total + item.output.length, 0)
    ).toBeLessThanOrEqual(40_000);
  });

  it("turns invalid arguments and tool timeouts into safe outputs", async () => {
    process.env.OPENAI_CHAT_TOOL_TIMEOUT_MS = "5";
    mockedExecuteRegisteredMcpTool.mockImplementation(() => new Promise(() => {}));
    const fetchMock = jest
      .fn()
      .mockImplementationOnce(() =>
        jsonResponse({
          id: "response-1",
          output: [
            {
              type: "function_call",
              call_id: "invalid-call",
              name: "search_workspace_knowledge",
              arguments: "not-json",
            },
            {
              type: "function_call",
              call_id: "timeout-call",
              name: "search_workspace_knowledge",
              arguments: '{"query":"slow"}',
            },
          ],
        })
      )
      .mockImplementationOnce(() =>
        jsonResponse({
          output_text: JSON.stringify({
            answer: "I could not retrieve enough evidence.",
            confidence: "low",
            sources: [],
            suggestedActions: [],
          }),
          output: [],
        })
      );
    global.fetch = fetchMock as any;

    await expect(runAgent()).resolves.toMatchObject({ confidence: "low" });
    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    const outputs = secondBody.input.filter(
      (item: any) => item.type === "function_call_output"
    );
    expect(outputs[0].output).toContain("invalid_arguments");
    expect(outputs[1].output).toContain("tool_timeout");
  });

  it("returns null for provider failures and invalid final output", async () => {
    global.fetch = jest.fn().mockRejectedValueOnce(new Error("network down")) as any;
    await expect(runAgent()).resolves.toBeNull();

    global.fetch = jest.fn().mockImplementationOnce(() =>
      jsonResponse({ output_text: '{"answer":"missing fields"}', output: [] })
    ) as any;
    await expect(runAgent()).resolves.toBeNull();
  });
});
