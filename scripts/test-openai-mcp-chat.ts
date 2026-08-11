import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env.development.local" });
dotenv.config({ path: ".env" });

const DEFAULT_OPENAI_MODEL = "gpt-4.1-mini";
const DEFAULT_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 60_000;
const MAX_HTTP_ATTEMPTS = 2;

type ProbeLanguage = "en" | "sr";

type FunctionCall = {
  type: "function_call";
  call_id: string;
  name: string;
  arguments: string;
};

const SYNTHETIC_READ_TOOL = {
  scope: "mcp:read" as const,
  api: {
    type: "function" as const,
    name: "search_workspace_knowledge",
    description:
      "Search synthetic Taskwise meeting evidence. This contract tool is read-only.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["query"],
      properties: {
        query: { type: "string", minLength: 1 },
      },
    },
  },
};

const PROBES: Array<{
  language: ProbeLanguage;
  prompt: string;
  evidence: Record<string, unknown>;
}> = [
  {
    language: "en",
    prompt: "What renewal decision was recorded in the synthetic meeting evidence?",
    evidence: {
      meetings: [
        {
          id: "synthetic-meeting-en",
          title: "Synthetic renewal review",
          summary: "The team approved the annual renewal.",
        },
      ],
    },
  },
  {
    language: "sr",
    prompt: "Koja odluka o produženju ugovora je zabeležena u sintetičkim beleškama?",
    evidence: {
      meetings: [
        {
          id: "synthetic-meeting-sr",
          title: "Sintetički pregled ugovora",
          summary: "Tim je odobrio godišnje produženje ugovora.",
        },
      ],
    },
  },
];

const parsePositiveInt = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), MAX_TIMEOUT_MS);
};

const providerTimeoutMs = parsePositiveInt(
  process.env.OPENAI_CHAT_PROVIDER_TIMEOUT_MS,
  DEFAULT_TIMEOUT_MS
);

const model =
  process.env.OPENAI_MODEL?.trim() ||
  process.env.OPENAI_FALLBACK_MODEL?.trim() ||
  DEFAULT_OPENAI_MODEL;
const responsesUrl =
  process.env.OPENAI_RESPONSES_URL?.trim() || DEFAULT_RESPONSES_URL;

const isTransientStatus = (status: number) =>
  status === 408 || status === 409 || status === 429 || status >= 500;

const safeProviderToken = (value: unknown) =>
  typeof value === "string" && /^[A-Za-z0-9_.-]{1,80}$/.test(value)
    ? value
    : "unknown";

const requestResponse = async (
  apiKey: string,
  body: Record<string, unknown>
): Promise<any> => {
  for (let attempt = 1; attempt <= MAX_HTTP_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), providerTimeoutMs);
    try {
      const response = await fetch(responsesUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        signal: controller.signal,
        body: JSON.stringify(body),
      });
      if (response.ok) return await response.json();
      if (attempt < MAX_HTTP_ATTEMPTS && isTransientStatus(response.status)) {
        continue;
      }
      const providerError = await response.json().catch(() => null);
      throw new Error(
        `OpenAI Responses request failed with status ${response.status} ` +
          `(type=${safeProviderToken(providerError?.error?.type)} ` +
          `code=${safeProviderToken(providerError?.error?.code)} ` +
          `param=${safeProviderToken(providerError?.error?.param)}).`
      );
    } catch (error) {
      const transientNetworkFailure =
        error instanceof Error &&
        (error.name === "AbortError" || error instanceof TypeError);
      if (attempt < MAX_HTTP_ATTEMPTS && transientNetworkFailure) continue;
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`OpenAI Responses request exceeded ${providerTimeoutMs}ms.`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error("OpenAI Responses request exhausted its bounded retry budget.");
};

const extractFunctionCall = (payload: any): FunctionCall => {
  const output = Array.isArray(payload?.output) ? payload.output : [];
  const call = output.find(
    (item: any) =>
      item?.type === "function_call" &&
      typeof item.call_id === "string" &&
      item.call_id.length > 0 &&
      typeof item.name === "string" &&
      typeof item.arguments === "string"
  );
  if (!call) throw new Error("Configured model did not emit a function_call.");
  if (call.name !== SYNTHETIC_READ_TOOL.api.name) {
    throw new Error("Configured model selected an unexpected tool.");
  }
  let args: unknown;
  try {
    args = JSON.parse(call.arguments);
  } catch {
    throw new Error("Configured model emitted non-JSON tool arguments.");
  }
  if (
    !args ||
    typeof args !== "object" ||
    Array.isArray(args) ||
    typeof (args as Record<string, unknown>).query !== "string" ||
    !(args as Record<string, string>).query.trim()
  ) {
    throw new Error("Configured model emitted invalid tool arguments.");
  }
  return call as FunctionCall;
};

const extractOutputText = (payload: any): string => {
  if (typeof payload?.output_text === "string") return payload.output_text;
  const output = Array.isArray(payload?.output) ? payload.output : [];
  return output
    .filter((item: any) => item?.type === "message" && Array.isArray(item.content))
    .flatMap((item: any) => item.content)
    .filter((part: any) => part?.type === "output_text")
    .map((part: any) => String(part.text || ""))
    .join("");
};

const validateFinalAnswer = (payload: any, language: ProbeLanguage) => {
  const text = extractOutputText(payload);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Configured model did not return a JSON final answer.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Configured model returned an invalid final answer object.");
  }
  const value = parsed as Record<string, unknown>;
  if (
    typeof value.answer !== "string" ||
    !value.answer.trim() ||
    value.language !== language ||
    value.grounded !== true
  ) {
    throw new Error("Configured model returned a final answer outside the contract.");
  }
};

const runProbe = async (
  apiKey: string,
  probe: (typeof PROBES)[number]
) => {
  const initialInput = [
    {
      role: "developer",
      content: [
        {
          type: "input_text",
          text:
            `You are a read-only Taskwise contract probe. Call the available tool exactly once. ` +
            `After its output, return only JSON with answer (non-empty string), language (exactly ${probe.language}), and grounded (true).`,
        },
      ],
    },
    {
      role: "user",
      content: [{ type: "input_text", text: probe.prompt }],
    },
  ];
  const first = await requestResponse(apiKey, {
    model,
    store: false,
    input: initialInput,
    tools: [SYNTHETIC_READ_TOOL.api],
    tool_choice: "required",
    max_output_tokens: 500,
  });
  const call = extractFunctionCall(first);

  const functionOutput = {
    type: "function_call_output",
    call_id: call.call_id,
    output: JSON.stringify({ ok: true, data: probe.evidence }),
  };
  if (functionOutput.call_id !== call.call_id) {
    throw new Error("Function-call continuation did not preserve call_id.");
  }
  const final = await requestResponse(apiKey, {
    model,
    store: false,
    input: [
      ...initialInput,
      ...(Array.isArray(first?.output) ? first.output : []),
      functionOutput,
    ],
    tools: [SYNTHETIC_READ_TOOL.api],
    tool_choice: "none",
    max_output_tokens: 500,
    text: { format: { type: "json_object" } },
  });
  validateFinalAnswer(final, probe.language);
  console.log(
    `PASS language=${probe.language} tool=${SYNTHETIC_READ_TOOL.api.name} continuation=accepted final=valid`
  );
};

const run = async () => {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is required for the live contract probe.");
  if (SYNTHETIC_READ_TOOL.scope !== "mcp:read") {
    throw new Error("The live contract probe may advertise only a read tool.");
  }

  console.log(
    `OpenAI MCP chat contract model=${model} probes=${PROBES.length} tools=1 timeoutMs=${providerTimeoutMs}`
  );
  for (const probe of PROBES) await runProbe(apiKey, probe);
  console.log("OpenAI MCP chat contract passed.");
};

run().catch((error) => {
  const message = error instanceof Error ? error.message : "Unknown live contract failure.";
  console.error(`OpenAI MCP chat contract failed: ${message}`);
  process.exitCode = 1;
});
