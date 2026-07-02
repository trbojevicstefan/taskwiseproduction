import {
  matchesComparison,
  matchesContains,
  matchesContainsAll,
  matchesContainsAny,
  matchesEquals,
  matchesFilter,
  matchesIn,
  selectWorkflowPayload,
  workflowMatchesPayload,
} from "@/lib/meeting-workflow-automation-matchers";

describe("meeting-workflow-automation-matchers", () => {
  it("compares values predictably", () => {
    expect(matchesEquals("Hello", "hello")).toBe(true);
    expect(matchesEquals("Hello", "hello", true)).toBe(false);
    expect(matchesEquals(["a", "b"], "b")).toBe(true);
    expect(matchesEquals({ a: 1 }, { a: 1 })).toBe(true);
  });

  it("matches substring and membership variants", () => {
    expect(matchesContains("Project kickoff", "kick")).toBe(true);
    expect(matchesContains(["alpha", "beta"], "beta")).toBe(true);
    expect(matchesIn("beta", ["alpha", "beta"])).toBe(true);
    expect(matchesContainsAny(["alpha", "beta"], ["gamma", "beta"])).toBe(true);
    expect(matchesContainsAll(["alpha", "beta"], ["alpha", "beta"])).toBe(true);
  });

  it("compares numeric values", () => {
    expect(matchesComparison(10, 5, "greater_than")).toBe(true);
    expect(matchesComparison([1, 2, 3], 2, "greater_than_or_equal")).toBe(true);
    expect(matchesComparison(1, 2, "less_than")).toBe(true);
  });

  it("evaluates filters and workflow payloads", () => {
    const payload = {
      meeting: {
        title: "Sprint Planning",
        attendees: [{ name: "Jane Doe", email: "jane@example.com" }],
        duration: 30,
      },
      workspace: { id: "workspace-1" },
    };

    expect(
      matchesFilter(payload, {
        field: "meeting.title",
        operator: "contains",
        value: "Planning",
      })
    ).toBe(true);
    expect(
      workflowMatchesPayload(payload, {
        _id: "workflow-1",
        workspaceId: "workspace-1",
        trigger: "meeting.ingested",
        filters: [
          { field: "meeting.duration", operator: "greater_than", value: 20 },
          { field: "meeting.attendees", operator: "exists" },
        ],
        fieldSelection: { mode: "all", fields: [] },
        transform: { script: "", timeoutMs: null, memoryLimitBytes: null },
        destination: { url: "https://example.com" },
        isEnabled: true,
        createdByUserId: "user-1",
        createdAt: new Date(),
        version: 1,
      } as any)
    ).toBe(true);
  });

  it("projects workflow payload fields", () => {
    expect(
      selectWorkflowPayload(
        {
          meeting: { title: "Sprint Planning", duration: 30 },
          workspace: { id: "workspace-1" },
        },
        { mode: "subset", fields: ["meeting.title", "workspace.id"] }
      )
    ).toEqual({
      meeting: { title: "Sprint Planning" },
      workspace: { id: "workspace-1" },
    });
  });
});
