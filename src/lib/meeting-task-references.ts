import type { ExtractedTaskSchema, TaskReferenceSchema } from "@/types/chat";

export const buildTaskReferenceTree = (
  tasks: ExtractedTaskSchema[],
  taskMap: Map<string, string>
): Array<ExtractedTaskSchema | TaskReferenceSchema> =>
  tasks.map((task) => {
    const subtasks = task.subtasks?.length
      ? buildTaskReferenceTree(task.subtasks, taskMap)
      : null;
    const canonicalId = taskMap.get(task.id);

    if (!canonicalId) {
      return {
        ...task,
        subtasks: subtasks as ExtractedTaskSchema[] | null,
      };
    }

    return {
      taskId: canonicalId,
      sourceTaskId: task.id,
      title: task.title,
      subtasks: subtasks as TaskReferenceSchema[] | null,
    };
  });

