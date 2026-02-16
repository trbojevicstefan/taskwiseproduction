import { randomUUID } from "crypto";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogFields = Record<string, unknown>;

export interface StructuredLogger {
  debug: (event: string, fields?: LogFields) => void;
  info: (event: string, fields?: LogFields) => void;
  warn: (event: string, fields?: LogFields) => void;
  error: (event: string, fields?: LogFields) => void;
  child: (fields: LogFields) => StructuredLogger;
}

export const CORRELATION_ID_HEADER = "x-correlation-id";

const CORRELATION_ID_ALIASES = [CORRELATION_ID_HEADER, "x-request-id"] as const;
const CORRELATION_ID_MAX_LENGTH = 128;
const CORRELATION_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;

const normalizeCorrelationId = (value: string | null | undefined) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > CORRELATION_ID_MAX_LENGTH) return null;
  if (!CORRELATION_ID_PATTERN.test(trimmed)) return null;
  return trimmed;
};

export const getCorrelationIdFromHeaders = (
  headers: Headers | null | undefined
) => {
  if (!headers) return null;
  for (const name of CORRELATION_ID_ALIASES) {
    const candidate = normalizeCorrelationId(headers.get(name));
    if (candidate) {
      return candidate;
    }
  }
  return null;
};

export const ensureCorrelationId = (candidate?: string | null) =>
  normalizeCorrelationId(candidate) || randomUUID();

export const getRequestCorrelationId = (request: Request) =>
  ensureCorrelationId(getCorrelationIdFromHeaders(request.headers));

export const attachCorrelationIdHeader = (
  response: Response,
  correlationId?: string | null
) => {
  const normalized = normalizeCorrelationId(correlationId);
  if (normalized) {
    response.headers.set(CORRELATION_ID_HEADER, normalized);
  }
  return response;
};

export const serializeError = (error: unknown) => {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack || null,
    };
  }
  if (typeof error === "string") {
    return { message: error };
  }
  return { message: "Unknown error", error };
};

const safeStringify = (value: unknown) => {
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(value, (_key, current) => {
      if (typeof current === "bigint") {
        return current.toString();
      }
      if (typeof current === "object" && current !== null) {
        if (seen.has(current)) {
          return "[Circular]";
        }
        seen.add(current);
      }
      return current;
    });
  } catch {
    return JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "error",
      event: "logger.serialization_failed",
    });
  }
};

const emitStructuredLog = (level: LogLevel, event: string, fields?: LogFields) => {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...(fields || {}),
  };
  const payload = safeStringify(entry);

  if (level === "error") {
    console.error(payload);
    return;
  }
  if (level === "warn") {
    console.warn(payload);
    return;
  }
  console.info(payload);
};

export const createLogger = (baseFields: LogFields = {}): StructuredLogger => {
  const write = (level: LogLevel, event: string, fields?: LogFields) =>
    emitStructuredLog(level, event, {
      ...baseFields,
      ...(fields || {}),
    });

  return {
    debug: (event, fields) => write("debug", event, fields),
    info: (event, fields) => write("info", event, fields),
    warn: (event, fields) => write("warn", event, fields),
    error: (event, fields) => write("error", event, fields),
    child: (fields) =>
      createLogger({
        ...baseFields,
        ...fields,
      }),
  };
};
