import type { ExecutablePrompt, PromptGenerateOptions } from "@genkit-ai/ai";
import { extractJsonValue } from "@/ai/flows/parse-json-output";

const OPENAI_MODEL =
  process.env.OPENAI_MODEL || process.env.OPENAI_FALLBACK_MODEL || "gpt-4.1-mini";
const OPENAI_CHAT_URL =
  process.env.OPENAI_API_URL || "https://api.openai.com/v1/chat/completions";
const OPENAI_RESPONSES_URL =
  process.env.OPENAI_RESPONSES_URL || "https://api.openai.com/v1/responses";

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
  const hasJsonToken = messages.some((message) =>
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
    rendered.messages.forEach((message) => {
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
  return messages.map((message) => ({
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
  options?: PromptGenerateOptions<any, any>
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

  const response = await fetch(OPENAI_RESPONSES_URL, {
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

  if (!response.ok) {
    const payload = await response.text();
    throw new Error(`OpenAI responses fallback failed: ${response.status} ${payload}`);
  }

  const payload = await response.json();
  const text = extractResponsesText(payload);
  const output = expectsJson ? extractJsonValue(undefined, text) : undefined;
  return { text, output, provider: "openai" as const };
};

const runOpenAiCompletion = async (
  rendered: {
    system?: unknown;
    prompt?: unknown;
    messages?: Array<{ role?: string; content?: unknown }>;
    output?: { format?: string; schema?: unknown };
  },
  options?: PromptGenerateOptions<any, any>
) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is required to use the OpenAI fallback."
    );
  }

  const expectsJson = Boolean(rendered.output?.schema || rendered.output?.format === "json");
  const messages = toOpenAIMessages(rendered, expectsJson);
  const model = getOpenAiModel(options);
  const maxTokens =
    typeof (options as { config?: { maxOutputTokens?: number } })?.config?.maxOutputTokens === "number"
      ? (options as { config?: { maxOutputTokens?: number } }).config!.maxOutputTokens!
      : 2048;

  const response = await fetch(OPENAI_CHAT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.2,
      max_tokens: maxTokens,
      response_format: expectsJson ? { type: "json_object" } : undefined,
    }),
  });

  if (!response.ok) {
    const payload = await response.text();
    throw new Error(`OpenAI chat fallback failed: ${response.status} ${payload}`);
  }

  const payload = await response.json();
  const text = String(payload?.choices?.[0]?.message?.content || "");
  const output = expectsJson ? extractJsonValue(undefined, text) : undefined;
  return { text, output, provider: "openai" as const };
};

export async function runPromptWithFallback<I, O, C>(
  prompt: ExecutablePrompt<I, O, C>,
  input?: I,
  options?: PromptGenerateOptions<O, C>
): Promise<{ output?: unknown; text?: string; provider?: LlmProvider }> {
  const rendered = await prompt.render(input, options);
  let lastFallbackError = "";
  const toMessage = (err: unknown) =>
    String((err as { message?: string }).message || err || "Unknown error");
  try {
    return await runOpenAiResponses(rendered, options);
  } catch (responsesError) {
    lastFallbackError = `OpenAI responses failed: ${toMessage(responsesError)}`;
    console.warn(lastFallbackError);
    try {
      return await runOpenAiCompletion(rendered, options);
    } catch (completionError) {
      lastFallbackError = `OpenAI chat fallback failed: ${toMessage(completionError)}`;
      console.error(lastFallbackError);
      throw new Error(
        `OpenAI request failed. ${lastFallbackError || "Please try again."}`
      );
    }
  }
}
