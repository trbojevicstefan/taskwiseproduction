import {
  COMPLETION_AUTO_APPLY_REVIEWER,
  applyCompletionTargets,
  classifyCompletionSuggestion,
  filterTasksForSessionSync,
  mergeCompletionSuggestions,
} from "@/lib/task-completion-sync";
import { buildCompletionEvidenceFingerprint } from "@/lib/task-completion-helpers";

describe("task-completion-sync", () => {
  it("merges matching suggestions into the existing task tree", () => {
    const tasks = [
      {
        id: "task-1",
        title: "Draft brief",
        status: "todo",
        assigneeName: "Jane Doe",
        assignee: { name: "Jane Doe", email: "jane@example.com" },
        subtasks: [
          {
            id: "task-1-1",
            title: "Gather notes",
            status: "todo",
            assigneeName: "Jane Doe",
            assignee: { name: "Jane Doe", email: "jane@example.com" },
            subtasks: null,
          },
        ],
      },
    ] as any;
    const suggestions = [
      {
        id: "suggestion-1",
        title: "Draft brief",
        assigneeName: "Jane Doe",
        assignee: { name: "Jane Doe", email: "jane@example.com" },
        completionConfidence: 0.92,
        completionEvidence: [{ snippet: "We already finished it." }],
        completionTargets: [
          {
            sourceType: "meeting",
            sourceSessionId: "meeting-1",
            taskId: "task-1",
          },
        ],
      },
      {
        id: "suggestion-2",
        title: "Unmatched follow-up",
        assigneeName: "Jane Doe",
        assignee: { name: "Jane Doe", email: "jane@example.com" },
        completionConfidence: 0.76,
        completionEvidence: [{ snippet: "Need to do this later." }],
        completionTargets: [
          {
            sourceType: "meeting",
            sourceSessionId: "meeting-1",
            taskId: "task-9",
          },
        ],
      },
    ] as any;

    expect(mergeCompletionSuggestions(tasks, suggestions)).toEqual([
      {
        id: "task-1",
        title: "Draft brief",
        status: "todo",
        assigneeName: "Jane Doe",
        assignee: { name: "Jane Doe", email: "jane@example.com" },
        subtasks: [
          {
            id: "task-1-1",
            title: "Gather notes",
            status: "todo",
            assigneeName: "Jane Doe",
            assignee: { name: "Jane Doe", email: "jane@example.com" },
            subtasks: null,
          },
        ],
        completionSuggested: true,
        completionConfidence: 0.92,
        completionEvidence: [{ snippet: "We already finished it." }],
        completionTargets: [
          {
            sourceType: "meeting",
            sourceSessionId: "meeting-1",
            taskId: "task-1",
          },
        ],
      },
      {
        id: "suggestion-2",
        title: "Unmatched follow-up",
        assigneeName: "Jane Doe",
        assignee: { name: "Jane Doe", email: "jane@example.com" },
        completionConfidence: 0.76,
        completionEvidence: [{ snippet: "Need to do this later." }],
        completionTargets: [
          {
            sourceType: "meeting",
            sourceSessionId: "meeting-1",
            taskId: "task-9",
          },
        ],
        status: "todo",
        completionSuggested: true,
      },
    ]);
  });

  it("filters session sync tasks to the matching source session", () => {
    const tasks = [
      {
        id: "task-1",
        title: "Keep me",
        completionSuggested: true,
        completionTargets: [
          { sourceType: "meeting", sourceSessionId: "meeting-1", taskId: "task-1" },
        ],
        subtasks: [
          {
            id: "task-1-1",
            title: "Keep child",
            completionSuggested: false,
            subtasks: null,
          },
        ],
      },
      {
        id: "task-2",
        title: "Drop me",
        completionSuggested: true,
        completionTargets: [
          { sourceType: "meeting", sourceSessionId: "meeting-2", taskId: "task-2" },
        ],
        subtasks: null,
      },
      {
        id: "task-3",
        title: "Ungated",
        subtasks: null,
      },
    ] as any;

    expect(filterTasksForSessionSync(tasks, "meeting", "meeting-1")).toEqual([
      {
        id: "task-1",
        title: "Keep me",
        completionSuggested: true,
        completionTargets: [
          { sourceType: "meeting", sourceSessionId: "meeting-1", taskId: "task-1" },
        ],
        subtasks: [
          {
            id: "task-1-1",
            title: "Keep child",
            completionSuggested: false,
            subtasks: null,
          },
        ],
      },
      {
        id: "task-3",
        title: "Ungated",
        subtasks: null,
      },
    ]);
  });

  it("auto-applies explicit high-confidence suggestions to direct and session-scoped tasks", async () => {
    const updateMany = jest.fn().mockResolvedValue({ acknowledged: true });
    const db = {
      collection: jest.fn(() => ({
        updateMany,
      })),
    } as any;
    const fingerprint = buildCompletionEvidenceFingerprint(
      "We shipped it yesterday."
    );

    await applyCompletionTargets(db, "user-1", [
      {
        id: "suggestion-1",
        title: "Draft brief",
        completionSuggested: true,
        completionConfidence: 0.92,
        completionEvidence: [{ snippet: "We shipped it yesterday." }],
        completionTargets: [
          { sourceType: "task", sourceSessionId: "task-session", taskId: "task-1" },
          { sourceType: "meeting", sourceSessionId: "meeting-1", taskId: "task-2" },
        ],
      },
    ] as any);

    expect(updateMany).toHaveBeenCalledTimes(2);
    expect(updateMany).toHaveBeenNthCalledWith(
      1,
      {
        userId: "user-1",
        $or: [{ _id: { $in: ["task-1"] } }, { id: { $in: ["task-1"] } }],
        // rejected-evidence fingerprints block re-application
        completionRejectedFingerprints: { $ne: fingerprint },
      },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: "done",
          completionEvidence: [{ snippet: "We shipped it yesterday." }],
          completionReviewStatus: "auto_applied",
          completionReviewedBy: COMPLETION_AUTO_APPLY_REVIEWER,
          completionReviewedAt: expect.any(String),
          cleanupStatus: "dismissed",
          lastUpdated: expect.any(Date),
        }),
      })
    );
    expect(updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        userId: "user-1",
        sourceSessionType: "meeting",
        completionRejectedFingerprints: { $ne: fingerprint },
      }),
      expect.objectContaining({
        $set: expect.objectContaining({
          status: "done",
          completionEvidence: [{ snippet: "We shipped it yesterday." }],
          completionSuggested: false,
          completionReviewStatus: "auto_applied",
          lastUpdated: expect.any(Date),
        }),
      })
    );
  });

  it("does not auto-apply medium-confidence suggestions", async () => {
    const updateMany = jest.fn().mockResolvedValue({ acknowledged: true });
    const db = { collection: jest.fn(() => ({ updateMany })) } as any;

    await applyCompletionTargets(db, "user-1", [
      {
        id: "suggestion-1",
        title: "Draft brief",
        completionSuggested: true,
        completionConfidence: 0.7,
        completionEvidence: [{ snippet: "We shipped it yesterday." }],
        completionTargets: [
          { sourceType: "task", sourceSessionId: "task-session", taskId: "task-1" },
        ],
      },
    ] as any);

    expect(updateMany).not.toHaveBeenCalled();
  });

  it("does not auto-apply high-confidence suggestions without explicit completion evidence", async () => {
    const updateMany = jest.fn().mockResolvedValue({ acknowledged: true });
    const db = { collection: jest.fn(() => ({ updateMany })) } as any;

    await applyCompletionTargets(db, "user-1", [
      {
        id: "suggestion-1",
        title: "Book venue",
        completionSuggested: true,
        completionConfidence: 0.95,
        // implicit signal, not an explicit completion statement
        completionEvidence: [{ snippet: "The venue is booked and ready." }],
        completionTargets: [
          { sourceType: "task", sourceSessionId: "task-session", taskId: "task-1" },
        ],
      },
      {
        id: "suggestion-2",
        title: "Draft brief",
        completionSuggested: true,
        completionConfidence: null,
        completionEvidence: [{ snippet: "It is done." }],
        completionTargets: [
          { sourceType: "task", sourceSessionId: "task-session", taskId: "task-2" },
        ],
      },
    ] as any);

    expect(updateMany).not.toHaveBeenCalled();
  });

  describe("classifyCompletionSuggestion", () => {
    it("classifies explicit high-confidence evidence as auto_apply", () => {
      expect(
        classifyCompletionSuggestion({
          completionConfidence: 0.9,
          completionEvidence: [{ snippet: "I finished the migration." }],
        })
      ).toBe("auto_apply");
    });

    it("classifies high confidence with negated or blocked evidence as suggest", () => {
      expect(
        classifyCompletionSuggestion({
          completionConfidence: 0.9,
          completionEvidence: [{ snippet: "The migration is not done yet." }],
        })
      ).toBe("suggest");
      expect(
        classifyCompletionSuggestion({
          completionConfidence: 0.9,
          completionEvidence: [
            { snippet: "Tried to deploy the fix but it failed." },
          ],
        })
      ).toBe("suggest");
    });

    it("classifies medium confidence as suggest and low/no confidence as ignore", () => {
      expect(
        classifyCompletionSuggestion({
          completionConfidence: 0.65,
          completionEvidence: [{ snippet: "I finished the migration." }],
        })
      ).toBe("suggest");
      expect(
        classifyCompletionSuggestion({
          completionConfidence: 0.4,
          completionEvidence: [{ snippet: "I finished the migration." }],
        })
      ).toBe("ignore");
      expect(
        classifyCompletionSuggestion({
          completionConfidence: null,
          completionEvidence: [{ snippet: "I finished the migration." }],
        })
      ).toBe("ignore");
    });
  });
});
