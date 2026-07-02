import {
  assignPathValue,
  deepEquals,
  dedupeStrings,
  extractStringValues,
  flattenTaskRecords,
  normalizeString,
  resolvePathValue,
  toComparableNumber,
  toComparableString,
  toIsoStringOrNull,
  toRecordArray,
} from "@/lib/meeting-workflow-automation-helpers";

describe("meeting-workflow-automation-helpers", () => {
  it("normalizes and serializes primitive values", () => {
    expect(normalizeString("  hello  ")).toBe("hello");
    expect(toIsoStringOrNull("2026-07-02T00:00:00Z")).toBe("2026-07-02T00:00:00.000Z");
  });

  it("dedupes strings while preserving first-seen order", () => {
    expect(dedupeStrings(["a", "b", "a", "c"])).toEqual(["a", "b", "c"]);
  });

  it("resolves and assigns nested path values", () => {
    const source = {
      meeting: { title: "Kickoff", attendees: [{ name: "Alice" }, { name: "Bob" }] },
    };
    expect(resolvePathValue(source, "meeting.attendees.1.name")).toBe("Bob");

    const target: Record<string, unknown> = {};
    assignPathValue(target, "meeting.summary.title", "Done");
    expect(target).toEqual({ meeting: { summary: { title: "Done" } } });
  });

  it("extracts string values and flattens task records", () => {
    const tasks = [
      { id: "1", title: "First", subtasks: [{ id: "1.1", title: "Nested" }] },
      { id: "2", title: "Second" },
    ];
    expect(flattenTaskRecords(tasks)).toHaveLength(3);
    expect(
      extractStringValues(
        toRecordArray([{ name: " Alice " }, { name: "Bob" }, { name: "Alice" }]),
        ["name"]
      )
    ).toEqual(["Alice", "Bob"]);
  });

  it("compares string and numeric values predictably", () => {
    expect(toComparableString(" Hello ")).toBe("hello");
    expect(toComparableNumber("42")).toBe(42);
    expect(deepEquals({ a: 1 }, { a: 1 })).toBe(true);
  });
});
