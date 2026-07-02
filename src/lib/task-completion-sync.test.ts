import {
  applyCompletionTargets,
  filterTasksForSessionSync,
  mergeCompletionSuggestions,
} from "@/lib/task-completion-sync";

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

  it("applies completion targets to direct and session-scoped tasks", async () => {
    const updateMany = jest.fn().mockResolvedValue({ acknowledged: true });
    const db = {
      collection: jest.fn(() => ({
        updateMany,
      })),
    } as any;

    await applyCompletionTargets(db, "user-1", [
      {
        id: "suggestion-1",
        title: "Draft brief",
        completionSuggested: true,
        completionEvidence: [{ snippet: "Done." }],
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
      },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: "done",
          completionEvidence: [{ snippet: "Done." }],
          lastUpdated: expect.any(Date),
        }),
      })
    );
    expect(updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        userId: "user-1",
        sourceSessionType: "meeting",
      }),
      expect.objectContaining({
        $set: expect.objectContaining({
          status: "done",
          completionEvidence: [{ snippet: "Done." }],
          completionSuggested: false,
          lastUpdated: expect.any(Date),
        }),
      })
    );
  });
});
