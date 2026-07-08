/**
 * Shared OpenAI embeddings helper for semantic meeting search.
 *
 * Follows the precedent set by `src/lib/task-completion-detection.ts`
 * (`embedTexts`): same env handling (`OPENAI_EMBEDDINGS_MODEL`,
 * `OPENAI_EMBEDDINGS_URL`, `OPENAI_API_KEY`), same graceful degradation
 * (missing key or any API failure returns `[]` — callers must treat an
 * empty/short result as "embeddings unavailable" and fall back to keyword
 * paths; nothing here ever throws), same failure metrics + debug logging.
 *
 * task-completion-detection.ts deliberately keeps its own private copy so
 * its behavior stays byte-identical; new semantic-search code should import
 * from this module instead.
 */

import { recordExternalApiFailure } from "@/lib/observability-metrics";

const EMBEDDING_BATCH_SIZE = 40;

const EMBEDDINGS_DEBUG =
  process.env.EMBEDDINGS_DEBUG === "1" || process.env.NODE_ENV !== "production";

const debugLog = (...args: unknown[]) => {
  if (!EMBEDDINGS_DEBUG) return;
  console.info("[embeddings]", ...args);
};

/** Resolved at call time so tests can set env per-case. */
export const getEmbeddingModel = (): string =>
  process.env.OPENAI_EMBEDDINGS_MODEL || "text-embedding-3-small";

const getEmbeddingsUrl = (): string =>
  process.env.OPENAI_EMBEDDINGS_URL || "https://api.openai.com/v1/embeddings";

/** True when an OpenAI API key is configured (embeddings can be attempted). */
export const isEmbeddingAvailable = (): boolean =>
  Boolean(process.env.OPENAI_API_KEY);

const chunkTexts = (items: string[], size: number): string[][] => {
  const chunks: string[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
};

/**
 * Embed a list of texts. Returns one vector per input, or `[]` when the API
 * key is missing or any batch fails — callers must handle the empty case by
 * degrading to non-semantic behavior. Never throws.
 */
export const embedTexts = async (texts: string[]): Promise<number[][]> => {
  if (!texts.length) return [];
  const apiKey = process.env.OPENAI_API_KEY;
  const model = getEmbeddingModel();
  if (!apiKey) {
    void recordExternalApiFailure({
      provider: "openai",
      operation: "embeddings.create",
      error: "OPENAI_API_KEY is required for embeddings.",
      metadata: {
        model,
        inputs: texts.length,
      },
    });
    debugLog("skipped: OPENAI_API_KEY is not set");
    return [];
  }

  const batches = chunkTexts(texts, EMBEDDING_BATCH_SIZE);
  const output: number[][] = [];
  for (const batch of batches) {
    const requestStartedAtMs = Date.now();
    try {
      const response = await fetch(getEmbeddingsUrl(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          input: batch,
        }),
      });
      if (!response.ok) {
        const payload = await response.text();
        void recordExternalApiFailure({
          provider: "openai",
          operation: "embeddings.create",
          statusCode: response.status,
          durationMs: Date.now() - requestStartedAtMs,
          error: payload || response.statusText,
          metadata: {
            model,
            batchSize: batch.length,
          },
        });
        console.error(`OpenAI embeddings failed: ${response.status} ${payload}`);
        return [];
      }
      const payload = await response.json();
      const data = Array.isArray(payload.data) ? payload.data : [];
      const usageTokens =
        typeof payload?.usage?.total_tokens === "number"
          ? payload.usage.total_tokens
          : null;
      if (usageTokens !== null) {
        debugLog("embedding batch usage", {
          model,
          inputs: batch.length,
          usageTokens,
        });
      }
      output.push(...data.map((item: any) => item.embedding || []));
    } catch (error) {
      void recordExternalApiFailure({
        provider: "openai",
        operation: "embeddings.create",
        durationMs: Date.now() - requestStartedAtMs,
        error,
        metadata: {
          model,
          batchSize: batch.length,
        },
      });
      console.error("Embedding failed:", error);
      return [];
    }
  }
  return output;
};

/**
 * Embed a single text. Returns the vector, or null when embeddings are
 * unavailable or the call failed. Never throws.
 */
export const embedText = async (text: string): Promise<number[] | null> => {
  const trimmed = typeof text === "string" ? text.trim() : "";
  if (!trimmed) return null;
  const [embedding] = await embedTexts([trimmed]);
  return Array.isArray(embedding) && embedding.length ? embedding : null;
};
