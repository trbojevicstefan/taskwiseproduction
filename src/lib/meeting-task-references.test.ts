import { buildTaskReferenceTree } from "@/lib/meeting-task-references";

describe("meeting-task-references", () => {
  it("returns an empty array for no tasks", () => {
    expect(buildTaskReferenceTree([], new Map())).toEqual([]);
  });

  it("replaces mapped tasks with canonical references and preserves unmapped tasks", () => {
    const tasks = [
      {
        id: "task-1",
        title: "Draft launch brief",
        priority: "high",
        subtasks: [
          {
            id: "task-1-1",
            title: "Collect metrics",
            priority: "medium",
            subtasks: null,
          },
        ],
      },
      {
        id: "task-2",
        title: "Unmapped task",
        priority: "low",
        subtasks: null,
      },
    ] as any;
    const taskMap = new Map([
      ["task-1", "canonical-1"],
      ["task-1-1", "canonical-1-1"],
    ]);

    expect(buildTaskReferenceTree(tasks, taskMap)).toEqual([
      {
        taskId: "canonical-1",
        sourceTaskId: "task-1",
        title: "Draft launch brief",
        subtasks: [
          {
            taskId: "canonical-1-1",
            sourceTaskId: "task-1-1",
            title: "Collect metrics",
            subtasks: null,
          },
        ],
      },
      {
        id: "task-2",
        title: "Unmapped task",
        priority: "low",
        subtasks: null,
      },
    ]);
  });

  it("recursively maps only the tasks present in the map", () => {
    const tasks = [
      {
        id: "task-1",
        title: "Parent task",
        subtasks: [
          {
            id: "task-1-1",
            title: "Mapped child",
            subtasks: [
              {
                id: "task-1-1-1",
                title: "Grandchild stays embedded",
                subtasks: null,
              },
            ],
          },
          {
            id: "task-1-2",
            title: "Unmapped child",
            subtasks: null,
          },
        ],
      },
    ] as any;
    const taskMap = new Map([
      ["task-1", "canonical-1"],
      ["task-1-1", "canonical-1-1"],
    ]);

    expect(buildTaskReferenceTree(tasks, taskMap)).toEqual([
      {
        taskId: "canonical-1",
        sourceTaskId: "task-1",
        title: "Parent task",
        subtasks: [
          {
            taskId: "canonical-1-1",
            sourceTaskId: "task-1-1",
            title: "Mapped child",
            subtasks: [
              {
                id: "task-1-1-1",
                title: "Grandchild stays embedded",
                subtasks: null,
              },
            ],
          },
          {
            id: "task-1-2",
            title: "Unmapped child",
            subtasks: null,
          },
        ],
      },
    ]);
  });
});
