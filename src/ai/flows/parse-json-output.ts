import { z } from 'zod';

function tryParseJson(input: string | undefined): unknown | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through to substring attempts
  }

  const objectStart = trimmed.indexOf('{');
  const objectEnd = trimmed.lastIndexOf('}');
  if (objectStart !== -1 && objectEnd > objectStart) {
    const slice = trimmed.slice(objectStart, objectEnd + 1);
    try {
      return JSON.parse(slice);
    } catch {
      // ignore
    }
  }

  const arrayStart = trimmed.indexOf('[');
  const arrayEnd = trimmed.lastIndexOf(']');
  if (arrayStart !== -1 && arrayEnd > arrayStart) {
    const slice = trimmed.slice(arrayStart, arrayEnd + 1);
    try {
      return JSON.parse(slice);
    } catch {
      // ignore
    }
  }

  return null;
}

export function extractJsonValue(
  output: unknown,
  text: string | undefined
): unknown | null {
  let data = output;
  if (typeof data === "string") {
    data = tryParseJson(data) ?? data;
  }
  if (data == null) {
    data = tryParseJson(text);
  }
  return data ?? null;
}

export function parseJsonOutput<T extends z.ZodTypeAny>(
  schema: T,
  output: unknown,
  text: string | undefined,
  context?: string
): z.infer<T> {
  const data = extractJsonValue(output, text);

  const result = schema.safeParse(data);
  if (!result.success) {
    const issueSummary = result.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.length ? issue.path.join('.') : 'root'}: ${issue.message}`)
      .join('; ');
    const label = context ? ` (${context})` : '';
    throw new Error(`AI returned invalid JSON${label}: ${issueSummary || 'unknown schema error'}`);
  }
  return result.data;
}
