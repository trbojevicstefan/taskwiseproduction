import type {
  AutomationWorkflowDoc,
  AutomationWorkflowFieldSelection,
  AutomationWorkflowFilter,
} from "@/lib/automation-workflows";
import {
  assignPathValue,
  deepEquals,
  resolvePathValue,
  toArray,
  toComparableNumber,
  toComparableString,
} from "@/lib/meeting-workflow-automation-helpers";

export const matchesEquals = (
  actual: unknown,
  expected: unknown,
  caseSensitive = false
): boolean => {
  if (Array.isArray(actual)) {
    return actual.some((candidate) => matchesEquals(candidate, expected, caseSensitive));
  }

  const comparableLeft = toComparableString(actual, caseSensitive);
  const comparableRight = toComparableString(expected, caseSensitive);
  if (comparableLeft !== null && comparableRight !== null) {
    return comparableLeft === comparableRight;
  }
  return deepEquals(actual, expected);
};

export const matchesContains = (
  actual: unknown,
  expected: unknown,
  caseSensitive = false
): boolean => {
  if (Array.isArray(actual)) {
    return actual.some((candidate) => matchesContains(candidate, expected, caseSensitive));
  }

  const comparableRight = toComparableString(expected, caseSensitive);
  if (typeof actual === "string" && comparableRight !== null) {
    const comparableLeft = toComparableString(actual, caseSensitive);
    return comparableLeft !== null && comparableLeft.includes(comparableRight);
  }

  if (typeof actual === "number" || typeof actual === "boolean") {
    return matchesEquals(actual, expected, caseSensitive);
  }

  return false;
};

export const matchesIn = (actual: unknown, expected: unknown, caseSensitive = false): boolean => {
  const expectedValues = toArray(expected);
  if (!expectedValues.length) return false;

  if (Array.isArray(actual)) {
    return actual.some((candidate) => matchesIn(candidate, expectedValues, caseSensitive));
  }

  return expectedValues.some((candidate) => matchesEquals(actual, candidate, caseSensitive));
};

export const matchesContainsAny = (
  actual: unknown,
  expected: unknown,
  caseSensitive = false
): boolean => {
  const expectedValues = Array.isArray(expected) ? expected : [expected];
  const normalizedExpected = expectedValues.filter(
    (candidate) => candidate !== undefined && candidate !== null
  );
  if (!normalizedExpected.length) return false;

  if (Array.isArray(actual)) {
    return actual.some((actualCandidate) =>
      normalizedExpected.some(
        (expectedCandidate) =>
          matchesContains(actualCandidate, expectedCandidate, caseSensitive) ||
          matchesEquals(actualCandidate, expectedCandidate, caseSensitive)
      )
    );
  }

  return normalizedExpected.some(
    (expectedCandidate) =>
      matchesContains(actual, expectedCandidate, caseSensitive) ||
      matchesEquals(actual, expectedCandidate, caseSensitive)
  );
};

export const matchesContainsAll = (
  actual: unknown,
  expected: unknown,
  caseSensitive = false
): boolean => {
  const expectedValues = Array.isArray(expected) ? expected : [expected];
  const normalizedExpected = expectedValues.filter(
    (candidate) => candidate !== undefined && candidate !== null
  );
  if (!normalizedExpected.length) return false;

  if (Array.isArray(actual)) {
    return normalizedExpected.every((expectedCandidate) =>
      actual.some(
        (actualCandidate) =>
          matchesContains(actualCandidate, expectedCandidate, caseSensitive) ||
          matchesEquals(actualCandidate, expectedCandidate, caseSensitive)
      )
    );
  }

  return normalizedExpected.every(
    (expectedCandidate) =>
      matchesContains(actual, expectedCandidate, caseSensitive) ||
      matchesEquals(actual, expectedCandidate, caseSensitive)
  );
};

export const matchesComparison = (
  actual: unknown,
  expected: unknown,
  operator: "greater_than" | "greater_than_or_equal" | "less_than" | "less_than_or_equal"
): boolean => {
  if (Array.isArray(actual)) {
    return actual.some((candidate) => matchesComparison(candidate, expected, operator));
  }

  const left = toComparableNumber(actual);
  const right = toComparableNumber(expected);
  if (left === null || right === null) return false;

  switch (operator) {
    case "greater_than":
      return left > right;
    case "greater_than_or_equal":
      return left >= right;
    case "less_than":
      return left < right;
    case "less_than_or_equal":
      return left <= right;
    default:
      return false;
  }
};

export const matchesFilter = (
  source: Record<string, unknown>,
  filter: AutomationWorkflowFilter
) => {
  const actualValue = resolvePathValue(source, filter.field);
  const caseSensitive = Boolean(filter.caseSensitive);

  switch (filter.operator) {
    case "exists":
      return actualValue !== undefined && actualValue !== null;
    case "not_exists":
      return actualValue === undefined || actualValue === null;
    case "equals":
      return matchesEquals(actualValue, filter.value, caseSensitive);
    case "not_equals":
      return !matchesEquals(actualValue, filter.value, caseSensitive);
    case "contains":
      return matchesContains(actualValue, filter.value, caseSensitive);
    case "not_contains":
      return !matchesContains(actualValue, filter.value, caseSensitive);
    case "in":
      return matchesIn(actualValue, filter.value, caseSensitive);
    case "not_in":
      return !matchesIn(actualValue, filter.value, caseSensitive);
    case "greater_than":
      return matchesComparison(actualValue, filter.value, "greater_than");
    case "greater_than_or_equal":
      return matchesComparison(actualValue, filter.value, "greater_than_or_equal");
    case "less_than":
      return matchesComparison(actualValue, filter.value, "less_than");
    case "less_than_or_equal":
      return matchesComparison(actualValue, filter.value, "less_than_or_equal");
    case "contains_any":
      return matchesContainsAny(actualValue, filter.value, caseSensitive);
    case "contains_all":
      return matchesContainsAll(actualValue, filter.value, caseSensitive);
    default:
      return false;
  }
};

export const workflowMatchesPayload = (
  source: Record<string, unknown>,
  workflow: AutomationWorkflowDoc
) => workflow.filters.every((filter) => matchesFilter(source, filter));

export const selectWorkflowPayload = (
  source: Record<string, unknown>,
  selection: AutomationWorkflowFieldSelection
) => {
  if (selection.mode === "all") {
    return source;
  }

  const projected: Record<string, unknown> = {};
  selection.fields.forEach((fieldPath) => {
    const value = resolvePathValue(source, fieldPath);
    if (value !== undefined) {
      assignPathValue(projected, fieldPath, value);
    }
  });
  return projected;
};
