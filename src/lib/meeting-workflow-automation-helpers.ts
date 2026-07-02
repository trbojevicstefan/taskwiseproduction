export const normalizeString = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : null;

export const toIsoStringOrNull = (value: unknown) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value as any);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

export const toArray = <T = unknown>(value: unknown): T[] =>
  Array.isArray(value) ? (value as T[]) : [];

export const toRecordArray = (value: unknown): Array<Record<string, unknown>> =>
  toArray(value).filter(
    (candidate): candidate is Record<string, unknown> =>
      Boolean(candidate) && typeof candidate === "object" && !Array.isArray(candidate)
  );

export const dedupeStrings = (values: string[]) => Array.from(new Set(values));

export const toComparableString = (value: unknown, caseSensitive = false) => {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return caseSensitive ? normalized : normalized.toLowerCase();
};

export const deepEquals = (left: unknown, right: unknown) => {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return left === right;
  }
};

export const toComparableNumber = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.getTime();
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
      const parsed = Number(trimmed);
      return Number.isFinite(parsed) ? parsed : null;
    }
    const parsedDate = Date.parse(trimmed);
    return Number.isFinite(parsedDate) ? parsedDate : null;
  }
  return null;
};

export const resolvePathValue = (source: any, path: string) => {
  const segments = path
    .split(".")
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (!segments.length) return undefined;

  let current: any = source;
  for (const segment of segments) {
    if (Array.isArray(current)) {
      const index = Number.parseInt(segment, 10);
      if (Number.isFinite(index)) {
        current = current[index];
      } else {
        current = current
          .map((candidate) =>
            candidate && typeof candidate === "object"
              ? (candidate as Record<string, unknown>)[segment]
              : undefined
          )
          .filter((candidate) => candidate !== undefined);
      }
    } else if (current && typeof current === "object") {
      current = (current as Record<string, unknown>)[segment];
    } else {
      return undefined;
    }
  }
  return current;
};

export const assignPathValue = (target: Record<string, unknown>, path: string, value: unknown) => {
  const segments = path
    .split(".")
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (!segments.length) return;

  let cursor: Record<string, unknown> = target;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const isLast = index === segments.length - 1;
    if (isLast) {
      cursor[segment] = value;
      return;
    }
    const existing = cursor[segment];
    if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
      cursor[segment] = {};
    }
    cursor = cursor[segment] as Record<string, unknown>;
  }
};

export const extractStringValues = (
  records: Array<Record<string, unknown>>,
  paths: string[]
) => {
  const values: string[] = [];
  for (const record of records) {
    for (const path of paths) {
      const resolved = resolvePathValue(record, path);
      const candidates = Array.isArray(resolved) ? resolved : [resolved];
      for (const candidate of candidates) {
        const normalized = normalizeString(candidate);
        if (normalized) {
          values.push(normalized);
        }
      }
    }
  }
  return dedupeStrings(values);
};

export const flattenTaskRecords = (tasks: Array<Record<string, unknown>>) => {
  const flattened: Array<Record<string, unknown>> = [];
  const queue = [...tasks];
  while (queue.length) {
    const current = queue.shift();
    if (!current) continue;
    flattened.push(current);
    toRecordArray(current.subtasks).forEach((subtask) => {
      queue.push(subtask);
    });
  }
  return flattened;
};
