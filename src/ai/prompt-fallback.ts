import type { ExecutablePrompt, PromptGenerateOptions } from "@genkit-ai/ai";
import { appendFile } from "fs/promises";
import type { ZodTypeAny } from "zod";
import { extractJsonValue } from "@/ai/flows/parse-json-output";
import { recordExternalApiFailure } from "@/lib/observability-metrics";

const OPENAI_MODEL =
  process.env.OPENAI_MODEL || process.env.OPENAI_FALLBACK_MODEL || "gpt-4o-mini";
const OPENAI_RESPONSES_URL =
  process.env.OPENAI_RESPONSES_URL || "https://api.openai.com/v1/responses";
const OPENAI_USAGE_DEBUG = process.env.OPENAI_USAGE_DEBUG === "1";
const OPENAI_USAGE_LOG_FILE = process.env.OPENAI_USAGE_LOG_FILE?.trim() || "";

type PromptUsageContext = {
  promptName: string;
  endpoint: string;
  operation?: string;
  inputChars?: number;
  correlationId?: string;
  userId?: string;
};

let usageFileLoggingErrorPrinted = false;

const toPromptName = (prompt: ExecutablePrompt<any, any, any>): string => {
  const promptAny = prompt as any;
  return (
    promptAny?.name ||
    promptAny?.__action?.name ||
    promptAny?.action?.name ||
    "unknown_prompt"
  );
};

const estimateRenderedChars = (rendered: unknown): number | undefined => {
  try {
    const serialized = JSON.stringify(rendered);
    return typeof serialized === "string" ? serialized.length : undefined;
  } catch {
    return undefined;
  }
};

const appendUsageLogLine = async (line: string) => {
  if (!OPENAI_USAGE_LOG_FILE) return;
  try {
    await appendFile(OPENAI_USAGE_LOG_FILE, `${line}\n`, "utf8");
  } catch (error) {
    if (usageFileLoggingErrorPrinted) return;
    usageFileLoggingErrorPrinted = true;
    console.warn("Failed to append OPENAI usage log file:", error);
  }
};

const logOpenAiUsage = (
  api: "responses",
  model: string,
  usage: any,
  context: PromptUsageContext
) => {
  if (!OPENAI_USAGE_DEBUG || !usage || typeof usage !== "object") return;
  const promptTokens =
    usage.prompt_tokens ??
    usage.input_tokens ??
    usage.promptTokens ??
    usage.inputTokens ??
    null;
  const completionTokens =
    usage.completion_tokens ??
    usage.output_tokens ??
    usage.completionTokens ??
    usage.outputTokens ??
    null;
  const totalTokens =
    usage.total_tokens ??
    usage.totalTokens ??
    (typeof promptTokens === "number" && typeof completionTokens === "number"
      ? promptTokens + completionTokens
      : null);
  const payload = {
    timestamp: new Date().toISOString(),
    api,
    model,
    endpoint: context.endpoint,
    promptName: context.promptName,
    operation: context.operation,
    inputChars: context.inputChars ?? null,
    promptTokens,
    completionTokens,
    totalTokens,
  };
  const line = JSON.stringify(payload);
  console.info("[openai-usage]", line);
  void appendUsageLogLine(line);
};

const getOpenAiModel = (options?: PromptGenerateOptions<any, any>) => {
  const overrideModel = (options as { config?: { model?: string } })?.config?.model;
  return overrideModel || OPENAI_MODEL;
};

type LlmProvider = "openai";

const partToText = (part: unknown): string => {
  if (!part) return "";
  if (typeof part === "string") return part;
  if (typeof part === "object" && "text" in (part as { text?: string })) {
    return String((part as { text?: string }).text || "");
  }
  return "";
};

const contentToText = (content: unknown): string => {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map(partToText).join("").trim();
  }
  return partToText(content);
};

const ensureJsonInstruction = (
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  expectsJson: boolean
) => {
  if (!expectsJson) return messages;
  const hasJsonToken = messages.some((message: any) =>
    message.content.toLowerCase().includes("json")
  );
  if (hasJsonToken) return messages;
  return [
    { role: "system", content: "Respond with valid JSON only." },
    ...messages,
  ];
};

const toOpenAIMessages = (rendered: {
  system?: unknown;
  prompt?: unknown;
  messages?: Array<{ role?: string; content?: unknown }>;
}, expectsJson: boolean) => {
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [];
  const systemText = contentToText(rendered.system);
  if (systemText) {
    messages.push({ role: "system", content: systemText });
  }
  if (rendered.messages?.length) {
    rendered.messages.forEach((message: any) => {
      const role =
        message.role === "assistant" || message.role === "model"
          ? "assistant"
          : message.role === "system"
            ? "system"
            : "user";
      const content = contentToText(message.content);
      if (content) {
        messages.push({ role, content });
      }
    });
  }
  const promptText = contentToText(rendered.prompt);
  if (promptText) {
    messages.push({ role: "user", content: promptText });
  }
  return ensureJsonInstruction(messages, expectsJson);
};

const toOpenAIResponsesInput = (rendered: {
  system?: unknown;
  prompt?: unknown;
  messages?: Array<{ role?: string; content?: unknown }>;
}, expectsJson: boolean) => {
  const messages = toOpenAIMessages(rendered, expectsJson);
  return messages.map((message: any) => ({
    role: message.role,
    content: [
      {
        type: "input_text",
        text: message.content,
      },
    ],
  }));
};

const extractResponsesText = (payload: any): string => {
  if (!payload) return "";
  if (typeof payload.output_text === "string") return payload.output_text;
  const output = Array.isArray(payload.output) ? payload.output : [];
  for (const item of output) {
    if (item?.type === "message" && Array.isArray(item.content)) {
      const text = item.content
        .map((part: any) => (part?.type === "output_text" ? part.text : ""))
        .join("");
      if (text) return text;
    }
  }
  return "";
};

const runOpenAiResponses = async (
  rendered: {
    system?: unknown;
    prompt?: unknown;
    messages?: Array<{ role?: string; content?: unknown }>;
    output?: { format?: string; schema?: unknown };
  },
  options: PromptGenerateOptions<any, any> | undefined,
  usageContext: PromptUsageContext
) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is required to use the OpenAI fallback."
    );
  }

  const expectsJson = Boolean(
    rendered.output?.schema || rendered.output?.format === "json"
  );
  const messages = toOpenAIResponsesInput(rendered, expectsJson);
  const model = getOpenAiModel(options);
  const maxTokens =
    typeof (options as { config?: { maxOutputTokens?: number } })?.config
      ?.maxOutputTokens === "number"
      ? (options as { config?: { maxOutputTokens?: number } }).config!
          .maxOutputTokens!
      : 2048;

  const requestStartedAtMs = Date.now();
  let response: Response;
  try {
    response = await fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: messages,
        temperature: 0.2,
        max_output_tokens: maxTokens,
        text: expectsJson ? { format: { type: "json_object" } } : undefined,
      }),
    });
  } catch (error) {
    void recordExternalApiFailure({
      provider: "openai",
      operation: usageContext.operation || usageContext.promptName,
      correlationId: usageContext.correlationId,
      userId: usageContext.userId,
      durationMs: Date.now() - requestStartedAtMs,
      error,
      metadata: {
        endpoint: usageContext.endpoint,
        model,
      },
    });
    throw error;
  }

  if (!response.ok) {
    const payload = await response.text();
    void recordExternalApiFailure({
      provider: "openai",
      operation: usageContext.operation || usageContext.promptName,
      correlationId: usageContext.correlationId,
      userId: usageContext.userId,
      durationMs: Date.now() - requestStartedAtMs,
      statusCode: response.status,
      error: payload || response.statusText,
      metadata: {
        endpoint: usageContext.endpoint,
        model,
      },
    });
    throw new Error(`OpenAI responses fallback failed: ${response.status} ${payload}`);
  }

  const payload = await response.json();
  logOpenAiUsage("responses", model, payload?.usage, usageContext);
  const text = extractResponsesText(payload);
  const output = expectsJson ? extractJsonValue(undefined, text) : undefined;
  return { text, output, provider: "openai" as const };
};

export async function runPromptWithFallback<
  I,
  O extends ZodTypeAny,
  C extends ZodTypeAny
>(
  prompt: ExecutablePrompt<I, O, C>,
  input?: I,
  options?: PromptGenerateOptions<any, any>,
  context?: {
    endpoint?: string;
    operation?: string;
    promptName?: string;
    correlationId?: string;
    userId?: string;
  }
): Promise<{ output?: unknown; text?: string; provider?: LlmProvider }> {
  const rendered = await prompt.render(input, options);
  const promptName = context?.promptName || toPromptName(prompt as any);
  const usageContext: PromptUsageContext = {
    promptName,
    endpoint: context?.endpoint || promptName,
    operation: context?.operation,
    inputChars: OPENAI_USAGE_DEBUG ? estimateRenderedChars(rendered) : undefined,
    correlationId: context?.correlationId,
    userId: context?.userId,
  };
  let lastFallbackError = "";
  const toMessage = (err: unknown) =>
    String((err as { message?: string }).message || err || "Unknown error");
  try {
    return await runOpenAiResponses(rendered, options, usageContext);
  } catch (responsesError) {
    lastFallbackError = `OpenAI responses failed: ${toMessage(responsesError)}`;
    console.warn(lastFallbackError);
    throw new Error(
      `OpenAI request failed. ${lastFallbackError || "Please try again."}`
    );
  }
}

