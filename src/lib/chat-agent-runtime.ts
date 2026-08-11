import type { Db } from "mongodb";
import { extractJsonValue } from "@/ai/flows/parse-json-output";
import {
  executeScopedMcpTool,
  getOpenAiReadToolsForScope,
  prepareScopedMcpToolCall,
} from "@/lib/openai-responses-tools";
import {
  GeneralChatAnswerSchema,
  type ChatHistoryEntry,
  type ChatScope,
  type GeneralChatAnswer,
  type GeneralChatSourceType,
} from "@/types/general-chat";

const OPENAI_RESPONSES_URL =
  process.env.OPENAI_RESPONSES_URL || "https://api.openai.com/v1/responses";
const DEFAULT_OPENAI_MODEL = "gpt-4.1-mini";
const MAX_RESPONSE_ROUNDS = 6;
const MAX_TOOL_CALLS = 12;
const MAX_TOOL_OUTPUT_CHARS = 12_000;
const MAX_AGGREGATE_TOOL_OUTPUT_CHARS = 40_000;
const DEFAULT_PROVIDER_TIMEOUT_MS = 25_000;
const DEFAULT_TOOL_TIMEOUT_MS = 8_000;
const MAX_MEMORY_SUMMARY_CHARS = 6_000;
const MAX_HISTORY_TURNS = 12;
const MAX_HISTORY_ENTRY_CHARS = 2_000;

type OpenAiFunctionCall = {
  type: "function_call";
  call_id: string;
  name: string;
  arguments: unknown;
};

type EvidenceIds = Record<GeneralChatSourceType, Set<string>>;

const newEvidenceIds = (): EvidenceIds => ({
  meeting: new Set<string>(),
  transcript: new Set<string>(),
  task: new Set<string>(),
  person: new Set<string>(),
  client: new Set<string>(),
});

const parsePositiveInt = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
};

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

const safeArguments = (
  value: unknown
): { ok: true; args: Record<string, unknown> } | { ok: false } => {
  if (typeof value !== "string") return { ok: false };
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false };
    }
    return { ok: true, args: parsed as Record<string, unknown> };
  } catch {
    return { ok: false };
  }
};

const extractResponseText = (payload: any): string => {
  if (typeof payload?.output_text === "string") return payload.output_text;
  const output = Array.isArray(payload?.output) ? payload.output : [];
  for (const item of output) {
    if (item?.type !== "message" || !Array.isArray(item.content)) continue;
    const text = item.content
      .filter((part: any) => part?.type === "output_text")
      .map((part: any) => String(part.text || ""))
      .join("");
    if (text) return text;
  }
  return "";
};

const asStringId = (value: unknown): string | null => {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const id = String(value).trim();
  return id || null;
};

const addEntityIds = (
  evidence: EvidenceIds,
  sourceType: GeneralChatSourceType,
  value: unknown
) => {
  const values = Array.isArray(value) ? value : [value];
  for (const entry of values) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const id = asStringId(record.id ?? record._id);
    if (!id) continue;
    if (sourceType === "meeting" || sourceType === "transcript") {
      evidence.meeting.add(id);
      evidence.transcript.add(id);
    } else {
      evidence[sourceType].add(id);
    }
  }
};

const collectEvidenceIds = (value: unknown, evidence: EvidenceIds) => {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item) => collectEvidenceIds(item, evidence));
    return;
  }

  const record = value as Record<string, unknown>;
  const citedType = record.sourceType;
  const citedId = asStringId(record.sourceId);
  if (
    citedId &&
    (citedType === "meeting" ||
      citedType === "transcript" ||
      citedType === "task" ||
      citedType === "person" ||
      citedType === "client")
  ) {
    evidence[citedType].add(citedId);
    if (citedType === "meeting" || citedType === "transcript") {
      evidence.meeting.add(citedId);
      evidence.transcript.add(citedId);
    }
  }

  addEntityIds(evidence, "meeting", record.meeting);
  addEntityIds(evidence, "meeting", record.meetings);
  addEntityIds(evidence, "task", record.task);
  addEntityIds(evidence, "task", record.tasks);
  addEntityIds(evidence, "task", record.actionItems);
  addEntityIds(evidence, "task", record.commitments);
  addEntityIds(evidence, "task", record.items);
  addEntityIds(evidence, "person", record.person);
  addEntityIds(evidence, "person", record.people);
  addEntityIds(evidence, "client", record.client);
  addEntityIds(evidence, "client", record.clients);

  Object.values(record).forEach((item) => collectEvidenceIds(item, evidence));
};

const filterGroundedAnswer = (
  answer: GeneralChatAnswer,
  evidence: EvidenceIds
): GeneralChatAnswer => {
  const sources = answer.sources.filter((source) =>
    evidence[source.sourceType].has(source.sourceId)
  );
  const allObservedIds = new Set([
    ...evidence.meeting,
    ...evidence.task,
    ...evidence.person,
    ...evidence.client,
  ]);
  const suggestedActions = answer.suggestedActions.filter((action) => {
    switch (action.actionType) {
      case "none":
        return false;
      case "open_meeting":
        return Boolean(action.targetId && evidence.meeting.has(action.targetId));
      case "open_task":
        return Boolean(action.targetId && evidence.task.has(action.targetId));
      case "create_task":
      case "schedule_slack_reminder":
        return !action.targetId || allObservedIds.has(action.targetId);
    }
  });

  if (answer.sources.length > 0 && sources.length === 0) {
    return {
      ...answer,
      answer: `${answer.answer.trim()} Note: I could not verify the cited sources against the authorized tool evidence, so treat this answer with caution.`,
      confidence: "low",
      sources,
      suggestedActions,
    };
  }
  return { ...answer, sources, suggestedActions };
};

const serializeBoundedOutput = (value: unknown, maxChars: number): string => {
  if (maxChars <= 0) return "";
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    serialized = JSON.stringify({
      ok: false,
      error: { code: "tool_error", message: "Tool output was not serializable." },
    });
  }
  if (serialized.length <= maxChars) return serialized;
  if (maxChars < 80) return serialized.slice(0, maxChars);
  const prefix = '{"ok":true,"truncated":true,"preview":"';
  const suffix = '"}';
  const preview = serialized
    .slice(0, Math.max(0, maxChars - prefix.length - suffix.length - 20))
    .replace(/["\\\r\n]/g, " ");
  return `${prefix}${preview}${suffix}`.slice(0, maxChars);
};

const withTimeout = async <T>(
  operation: Promise<T>,
  timeoutMs: number
): Promise<{ ok: true; value: T } | { ok: false }> => {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation.then((value) => ({ ok: true as const, value })),
      new Promise<{ ok: false }>((resolve) => {
        timeout = setTimeout(() => resolve({ ok: false }), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};

const requestOpenAiResponse = async (params: {
  apiKey: string;
  input: unknown[];
  tools: ReturnType<typeof getOpenAiReadToolsForScope>;
}): Promise<any | null> => {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    parsePositiveInt(
      process.env.OPENAI_CHAT_PROVIDER_TIMEOUT_MS,
      DEFAULT_PROVIDER_TIMEOUT_MS
    )
  );
  try {
    const response = await fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${params.apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model:
          process.env.OPENAI_MODEL ||
          process.env.OPENAI_FALLBACK_MODEL ||
          DEFAULT_OPENAI_MODEL,
        store: false,
        input: params.input,
        tools: params.tools,
        tool_choice: "auto",
        max_output_tokens: 2_500,
        text: { format: { type: "json_object" } },
      }),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
};

const inputMessage = (
  role: "developer" | "user" | "assistant",
  text: string
) => ({
  role,
  content: [{ type: "input_text", text }],
});

const buildInitialInput = (input: {
  scope: ChatScope;
  question: string;
  history: ChatHistoryEntry[];
  memorySummary?: string | null;
  today: string;
}) => {
  const developerPrompt = [
    "You are Taskwise's read-only workspace assistant.",
    `Today is ${input.today}. The active scope is ${JSON.stringify(input.scope)}.`,
    "Use only the provided read tools for workspace facts. Never invent ids, sources, or actions.",
    "Return one JSON object with answer, confidence (low|medium|high), sources, and suggestedActions.",
    "Sources must use ids present in tool output. Do not expose reasoning or tool payloads.",
    input.memorySummary?.trim()
      ? `Grounded rolling memory (context only, not fresh evidence):\n${input.memorySummary
          .trim()
          .slice(-MAX_MEMORY_SUMMARY_CHARS)}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const history = input.history.slice(-MAX_HISTORY_TURNS).map((entry) =>
    inputMessage(
      entry.role,
      entry.text.slice(0, MAX_HISTORY_ENTRY_CHARS)
    )
  );
  return [
    inputMessage("developer", developerPrompt),
    ...history,
    inputMessage("user", input.question),
  ];
};

export async function runScopedChatAgent(input: {
  db: Db;
  workspaceId: string;
  userId: string;
  scope: ChatScope;
  question: string;
  history: ChatHistoryEntry[];
  memorySummary?: string | null;
  today: string;
}): Promise<GeneralChatAnswer | null> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;

  const tools = getOpenAiReadToolsForScope(input.scope);
  if (!tools.length) return null;

  let responseInput: unknown[] = buildInitialInput(input);
  let toolCallCount = 0;
  let aggregateToolOutputChars = 0;
  const seenCalls = new Set<string>();
  const evidence = newEvidenceIds();

  for (let round = 0; round < MAX_RESPONSE_ROUNDS; round += 1) {
    const response = await requestOpenAiResponse({
      apiKey,
      input: responseInput,
      tools,
    });
    if (!response) return null;

    const outputItems = Array.isArray(response.output) ? response.output : [];
    const functionCalls = outputItems.filter(
      (item: any): item is OpenAiFunctionCall =>
        item?.type === "function_call" &&
        typeof item.call_id === "string" &&
        Boolean(item.call_id) &&
        typeof item.name === "string"
    );

    if (!functionCalls.length) {
      const parsed = GeneralChatAnswerSchema.safeParse(
        extractJsonValue(undefined, extractResponseText(response))
      );
      return parsed.success ? filterGroundedAnswer(parsed.data, evidence) : null;
    }

    const callOutputs: Array<{
      type: "function_call_output";
      call_id: string;
      output: string;
    }> = [];
    let exceededCallBound = false;
    for (const call of functionCalls) {
      if (toolCallCount >= MAX_TOOL_CALLS) {
        exceededCallBound = true;
        break;
      }
      toolCallCount += 1;

      const parsedArgs = safeArguments(call.arguments);
      const prepared = parsedArgs.ok
        ? prepareScopedMcpToolCall({
            scope: input.scope,
            name: call.name,
            args: parsedArgs.args,
          })
        : null;
      const signatureArgs =
        prepared?.ok === true
          ? prepared.args
          : parsedArgs.ok
            ? parsedArgs.args
            : call.arguments;
      const signature = `${call.name}:${stableJson(signatureArgs)}`;
      if (seenCalls.has(signature)) return null;
      seenCalls.add(signature);

      let toolPayload: unknown;
      if (!parsedArgs.ok) {
        toolPayload = {
          ok: false,
          error: {
            code: "invalid_arguments",
            message: "Tool arguments must be a JSON object.",
          },
        };
      } else {
        const execution = await withTimeout(
          executeScopedMcpTool({
            db: input.db,
            workspaceId: input.workspaceId,
            scope: input.scope,
            name: prepared?.ok === true ? prepared.name : call.name,
            args: prepared?.ok === true ? prepared.args : parsedArgs.args,
          }),
          parsePositiveInt(
            process.env.OPENAI_CHAT_TOOL_TIMEOUT_MS,
            DEFAULT_TOOL_TIMEOUT_MS
          )
        );
        if (!execution.ok) {
          toolPayload = {
            ok: false,
            error: {
              code: "tool_timeout",
              message: "The read tool timed out safely.",
            },
          };
        } else if (!execution.value.ok) {
          toolPayload = execution.value;
        } else {
          collectEvidenceIds(execution.value.result.data, evidence);
          toolPayload = {
            ok: true,
            toolName: execution.value.result.toolName,
            summary: execution.value.result.summary,
            data: execution.value.result.data,
          };
        }
      }

      const remainingAggregate = Math.max(
        0,
        MAX_AGGREGATE_TOOL_OUTPUT_CHARS - aggregateToolOutputChars
      );
      const output = serializeBoundedOutput(
        toolPayload,
        Math.min(MAX_TOOL_OUTPUT_CHARS, remainingAggregate)
      );
      aggregateToolOutputChars += output.length;
      callOutputs.push({
        type: "function_call_output",
        call_id: call.call_id,
        output,
      });
    }

    if (exceededCallBound) return null;
    responseInput = [...responseInput, ...outputItems, ...callOutputs];
  }

  return null;
}
