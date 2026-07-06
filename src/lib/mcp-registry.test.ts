import { z } from "zod";
import {
  executeRegisteredMcpTool,
  getMcpPromptDefinition,
  getMcpResourceDefinition,
  getMcpToolDefinition,
  listRegisteredMcpPrompts,
  listRegisteredMcpResources,
  listRegisteredMcpTools,
  readRegisteredMcpResource,
  registerMcpPrompts,
  registerMcpResources,
  registerMcpTools,
  resetMcpRegistryForTests,
  resolveToolScope,
  type McpToolDefinition,
} from "@/lib/mcp-registry";
import { McpToolCallError } from "@/lib/mcp-read-tools";

const buildToolDefinition = (
  overrides: Partial<McpToolDefinition> = {}
): McpToolDefinition => ({
  name: "example.tool",
  description: "Example tool",
  scope: "mcp:read",
  inputSchema: z.object({ value: z.string().trim().min(1).max(10) }),
  jsonSchema: {
    type: "object",
    additionalProperties: false,
    required: ["value"],
    properties: { value: { type: "string" } },
  },
  handler: jest.fn(async (_ctx, args) => ({
    toolName: "example.tool",
    summary: "ok",
    data: { echoed: args.value },
  })),
  ...overrides,
});

const ctx = { db: {} as any, workspaceId: "workspace-1" };

describe("mcp-registry", () => {
  beforeEach(() => {
    resetMcpRegistryForTests();
  });

  it("registers tools and resolves them by canonical name and alias", () => {
    registerMcpTools([
      buildToolDefinition({ name: "people.list", aliases: ["attendees.list"] }),
    ]);

    expect(getMcpToolDefinition("people.list")?.name).toBe("people.list");
    expect(getMcpToolDefinition("attendees.list")?.name).toBe("people.list");
    expect(getMcpToolDefinition("missing.tool")).toBeNull();
  });

  it("lists only canonical tools, never aliases", () => {
    registerMcpTools([
      buildToolDefinition({ name: "people.list", aliases: ["attendees.list"] }),
      buildToolDefinition({ name: "meetings.list" }),
    ]);

    const names = listRegisteredMcpTools().map((tool) => tool.name);
    expect(names).toEqual(["people.list", "meetings.list"]);
    expect(names).not.toContain("attendees.list");
  });

  it("resolves scope through aliases and returns null for unknown names", () => {
    registerMcpTools([
      buildToolDefinition({
        name: "tasks.update",
        scope: "mcp:write",
        aliases: ["tasks.update_alias"],
      }),
    ]);

    expect(resolveToolScope("tasks.update")).toBe("mcp:write");
    expect(resolveToolScope("tasks.update_alias")).toBe("mcp:write");
    expect(resolveToolScope("nope")).toBeNull();
  });

  it("executes a registered tool with parsed args", async () => {
    const definition = buildToolDefinition();
    registerMcpTools([definition]);

    const result = await executeRegisteredMcpTool(ctx, "example.tool", {
      value: "  hi  ",
    });

    expect(result.data).toEqual({ echoed: "hi" });
    expect(definition.handler).toHaveBeenCalledWith(ctx, { value: "hi" });
  });

  it("throws tool_not_found for unregistered tools", async () => {
    await expect(
      executeRegisteredMcpTool(ctx, "ghost.tool", {})
    ).rejects.toMatchObject({ code: "tool_not_found" });
  });

  it("throws invalid_arguments when zod validation fails", async () => {
    registerMcpTools([buildToolDefinition()]);

    const error = await executeRegisteredMcpTool(ctx, "example.tool", {
      value: "",
    }).catch((caught) => caught);

    expect(error).toBeInstanceOf(McpToolCallError);
    expect(error.code).toBe("invalid_arguments");
    expect(error.details).toBeDefined();
  });

  it("rejects destructive tools without confirm: true and runs them with it", async () => {
    const definition = buildToolDefinition({
      name: "danger.tool",
      destructive: true,
      inputSchema: z.object({
        value: z.string(),
        confirm: z.boolean().optional(),
      }),
    });
    registerMcpTools([definition]);

    await expect(
      executeRegisteredMcpTool(ctx, "danger.tool", { value: "x" })
    ).rejects.toMatchObject({ code: "invalid_arguments" });
    expect(definition.handler).not.toHaveBeenCalled();

    await executeRegisteredMcpTool(ctx, "danger.tool", {
      value: "x",
      confirm: true,
    });
    expect(definition.handler).toHaveBeenCalledTimes(1);
  });

  it("registers resources and matches exact and parameterized URIs", async () => {
    registerMcpResources([
      {
        uri: "taskwise://tasks",
        name: "Tasks",
        description: "Open tasks",
        mimeType: "application/json",
        handler: async () => ({ text: "{\"tasks\":[]}" }),
      },
      {
        uri: "taskwise://meetings/{meetingId}/transcript",
        name: "Transcript",
        description: "Meeting transcript",
        mimeType: "text/plain",
        matchesUri: (uri) => /^taskwise:\/\/meetings\/[a-z0-9-]+\/transcript$/.test(uri),
        handler: async (_ctx, uri) => ({ text: `transcript for ${uri}` }),
      },
    ]);

    expect(listRegisteredMcpResources().map((resource) => resource.uri)).toEqual([
      "taskwise://tasks",
      "taskwise://meetings/{meetingId}/transcript",
    ]);
    expect(getMcpResourceDefinition("taskwise://tasks")?.name).toBe("Tasks");
    expect(
      getMcpResourceDefinition("taskwise://meetings/meeting-1/transcript")?.name
    ).toBe("Transcript");
    expect(getMcpResourceDefinition("taskwise://nothing")).toBeNull();

    const contents = await readRegisteredMcpResource(
      ctx,
      "taskwise://meetings/meeting-1/transcript"
    );
    expect(contents).toEqual({
      uri: "taskwise://meetings/meeting-1/transcript",
      mimeType: "text/plain",
      text: "transcript for taskwise://meetings/meeting-1/transcript",
    });
  });

  it("returns null from readRegisteredMcpResource for unknown URIs", async () => {
    await expect(readRegisteredMcpResource(ctx, "taskwise://ghost")).resolves.toBeNull();
  });

  it("lets a resource handler override the mimeType", async () => {
    registerMcpResources([
      {
        uri: "taskwise://mixed",
        name: "Mixed",
        description: "Mixed content",
        mimeType: "application/json",
        handler: async () => ({ text: "plain", mimeType: "text/plain" }),
      },
    ]);

    const contents = await readRegisteredMcpResource(ctx, "taskwise://mixed");
    expect(contents?.mimeType).toBe("text/plain");
  });

  it("registers and lists prompts", async () => {
    registerMcpPrompts([
      {
        name: "example_prompt",
        description: "Example prompt",
        arguments: [{ name: "topic", required: true }],
        handler: async (_ctx, args) => ({
          description: "Example prompt",
          messages: [
            { role: "user", content: { type: "text", text: `about ${args.topic}` } },
          ],
        }),
      },
    ]);

    expect(listRegisteredMcpPrompts().map((prompt) => prompt.name)).toEqual([
      "example_prompt",
    ]);
    const definition = getMcpPromptDefinition("example_prompt");
    expect(definition?.arguments?.[0]).toMatchObject({ name: "topic", required: true });
    expect(getMcpPromptDefinition("ghost_prompt")).toBeNull();

    const prompt = await definition!.handler(ctx, { topic: "roadmap" });
    expect(prompt.messages[0].content.text).toBe("about roadmap");
  });
});
