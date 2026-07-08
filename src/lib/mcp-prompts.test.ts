import { getMcpPromptDefinitions, sanitizePromptArg } from "@/lib/mcp-prompts";

const ctx = { db: {} as any, workspaceId: "workspace-1" };

const getPrompt = (name: string) => {
  const definition = getMcpPromptDefinitions().find(
    (prompt) => prompt.name === name
  );
  if (!definition) throw new Error(`Prompt not registered: ${name}`);
  return definition;
};

describe("mcp-prompts", () => {
  it("registers exactly the five spec prompts", () => {
    expect(getMcpPromptDefinitions().map((prompt) => prompt.name)).toEqual([
      "summarize_client_commitments",
      "prioritize_open_tasks",
      "prepare_status_update",
      "find_broken_promises",
      "generate_implementation_plan_from_meetings",
    ]);
  });

  it("declares topic as the only required argument across all prompts", () => {
    const requiredArguments = getMcpPromptDefinitions().flatMap((prompt) =>
      (prompt.arguments || [])
        .filter((argument) => argument.required)
        .map((argument) => `${prompt.name}.${argument.name}`)
    );
    expect(requiredArguments).toEqual([
      "generate_implementation_plan_from_meetings.topic",
    ]);
  });

  it("sanitizePromptArg strips control characters, collapses whitespace, and truncates", () => {
    expect(sanitizePromptArg("  hello\u0000\u001f   world  ")).toBe("hello world");
    expect(sanitizePromptArg(undefined)).toBe("");
    expect(sanitizePromptArg("x".repeat(500))).toHaveLength(200);
  });

  it("summarize_client_commitments references the client tools and interpolates safely", async () => {
    const prompt = getPrompt("summarize_client_commitments");
    const result = await prompt.handler(ctx, {
      client: "Acme\u0000\nCorp",
    });

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe("user");
    const text = result.messages[0].content.text;
    expect(text).toContain("list_clients");
    expect(text).toContain("get_client_commitments");
    expect(text).toContain('"Acme Corp"');
    expect(text).not.toContain("\u0000");
  });

  it("prioritize_open_tasks references the prioritization tools", async () => {
    const prompt = getPrompt("prioritize_open_tasks");
    const result = await prompt.handler(ctx, {});
    const text = result.messages[0].content.text;
    expect(text).toContain("prioritize_tasks");
    expect(text).toContain("list_tasks");
    expect(text).toContain("get_calendar_agenda");
  });

  it("prepare_status_update fills audience/timeframe defaults", async () => {
    const prompt = getPrompt("prepare_status_update");
    const result = await prompt.handler(ctx, {});
    const text = result.messages[0].content.text;
    expect(text).toContain("for the team");
    expect(text).toContain("taskwise://workspace/summary");
    expect(text).toContain("get_board_snapshot");
  });

  it("find_broken_promises references overdue detection and transcript evidence", async () => {
    const prompt = getPrompt("find_broken_promises");
    const result = await prompt.handler(ctx, { person: "Alex" });
    const text = result.messages[0].content.text;
    expect(text).toContain('"Alex"');
    expect(text).toContain("get_transcript_snippets");
    expect(text).toContain("get_client_commitments");
  });

  it("generate_implementation_plan_from_meetings uses the topic argument", async () => {
    const prompt = getPrompt("generate_implementation_plan_from_meetings");
    const result = await prompt.handler(ctx, { topic: "billing revamp" });
    const text = result.messages[0].content.text;
    expect(text).toContain('"billing revamp"');
    expect(text).toContain("search_meetings");
    expect(text).toContain("create_task_from_meeting");
  });
});
