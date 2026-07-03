import {
  applyAutoApprovalFlags,
  resolveCompletionAuditModel,
  resolveCompletionMatchThreshold,
  resolveDetailLevel,
  selectTasksForLevel,
  shouldAutoApproveSuggestion,
} from "@/lib/fathom-ingest-analysis";

const withEnv = (vars: Record<string, string | undefined>, fn: () => void) => {
  const prev: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    prev[key] = process.env[key];
  }

  try {
    for (const [key, value] of Object.entries(vars)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fn();
  } finally {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
};

describe("fathom-ingest-analysis", () => {
  it("selects the requested detail level with sane fallbacks", () => {
    expect(
      selectTasksForLevel(
        {
          light: ["light"],
          medium: ["medium"],
          detailed: ["detailed"],
        },
        "medium"
      )
    ).toEqual(["medium"]);
    expect(selectTasksForLevel(null, "medium")).toEqual([]);
  });

  it("normalizes detail level preferences", () => {
    expect(resolveDetailLevel({ taskGranularityPreference: "light" })).toBe("light");
    expect(resolveDetailLevel({ taskGranularityPreference: "unknown" })).toBe("medium");
  });

  it("clamps completion thresholds", () => {
    expect(resolveCompletionMatchThreshold({ completionMatchThreshold: 0.1 })).toBe(0.4);
    expect(resolveCompletionMatchThreshold({ completionMatchThreshold: 0.8 })).toBe(0.8);
    expect(resolveCompletionMatchThreshold({ completionMatchThreshold: 1.5 })).toBe(0.95);
  });

  it("decides whether a suggestion should auto-approve", () => {
    expect(
      shouldAutoApproveSuggestion(
        { completionSuggested: true, completionConfidence: 0.8 } as any,
        0.75
      )
    ).toBe(true);
    expect(
      shouldAutoApproveSuggestion(
        { completionSuggested: true, completionConfidence: 0.7 } as any,
        0.75
      )
    ).toBe(false);
  });

  it("applies auto-approval flags recursively", () => {
    const tasks = applyAutoApprovalFlags(
      [
        {
          id: "1",
          status: "todo",
          completionSuggested: true,
          completionConfidence: 0.8,
          subtasks: [
            {
              id: "1.1",
              status: "todo",
              completionSuggested: true,
              completionConfidence: 0.5,
            },
          ],
        },
      ] as any,
      0.75
    );

    expect(tasks).toEqual([
      {
        id: "1",
        status: "done",
        completionSuggested: false,
        completionConfidence: 0.8,
        subtasks: [
          {
            id: "1.1",
            status: "todo",
            completionSuggested: true,
            completionConfidence: 0.5,
            subtasks: undefined,
          },
        ],
      },
    ]);
  });

  it("resolves the audit model from environment variables", () => {
    withEnv(
      {
        COMPLETION_AUDIT_MODEL: undefined,
        OPENAI_COMPLETION_AUDIT_MODEL: "gpt-4.1-mini",
        OPENAI_MODEL: "gpt-4o",
      },
      () => {
        expect(resolveCompletionAuditModel()).toBe("gpt-4.1-mini");
      }
    );
  });
});
