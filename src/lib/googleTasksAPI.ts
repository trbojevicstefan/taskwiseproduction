// src/lib/googleTasksAPI.ts
import type { ExtractedTaskSchema } from '@/types/chat';

const GOOGLE_TASKS_API_BASE_URL = 'https://tasks.googleapis.com/tasks/v1';

// Interfaces for Google Tasks API responses
export interface GoogleTaskList {
  kind: "tasks#taskList";
  id: string;
  title: string;
}

export interface GoogleTask {
  kind: "tasks#task";
  id: string;
  title: string;
  notes?: string;
  due?: string; // RFC 3339 timestamp
  status: 'needsAction' | 'completed';
}

// Fetches all of the user's task lists
export const getTaskLists = async (accessToken: string): Promise<GoogleTaskList[]> => {
  const response = await fetch(`${GOOGLE_TASKS_API_BASE_URL}/users/@me/lists`, {
    headers: { 'Authorization': `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    const error = await response.json();
    console.error("Google Tasks API error (getTaskLists):", error);
    throw new Error('Failed to fetch Google Task lists.');
  }
  const data = await response.json();
  return data.items || [];
};

// Creates a new task list
export const createTaskList = async (accessToken: string, title: string): Promise<GoogleTaskList> => {
  const response = await fetch(`${GOOGLE_TASKS_API_BASE_URL}/users/@me/lists`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title }),
  });
  if (!response.ok) {
    const error = await response.json();
    console.error("Google Tasks API error (createTaskList):", error);
    throw new Error('Failed to create Google Task list.');
  }
  return response.json();
};

const buildTaskNotes = (task: ExtractedTaskSchema) => {
  const sections: string[] = [];
  if (task.description) {
    sections.push(task.description);
  }
  if (task.researchBrief) {
    sections.push(`AI Research Brief:\n${task.researchBrief}`);
  }
  if (task.aiAssistanceText) {
    sections.push(`AI Assistance:\n${task.aiAssistanceText}`);
  }
  return sections.join('\n\n');
};

// Creates a single task, optionally as a subtask of another
const createTask = async (accessToken: string, taskListId: string, task: ExtractedTaskSchema, parentGoogleTaskId?: string): Promise<GoogleTask> => {
  const googleTaskPayload: Partial<GoogleTask> = {
    title: task.title,
    notes: buildTaskNotes(task) || undefined,
    due: task.dueAt ? new Date(task.dueAt).toISOString() : undefined,
    status: 'needsAction',
  };

  const url = `${GOOGLE_TASKS_API_BASE_URL}/lists/${taskListId}/tasks`;
  const params: { [key: string]: string } = {};
  if (parentGoogleTaskId) {
    params.parent = parentGoogleTaskId;
  }
  
  const fullUrl = `${url}?${new URLSearchParams(params).toString()}`;
  
  const response = await fetch(fullUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(googleTaskPayload),
  });

  if (!response.ok) {
    const error = await response.json();
    console.error(`Error creating task "${task.title}":`, error);
    throw new Error(`Failed to create task: ${error.error.message}`);
  }
  return response.json();
};


// Main function to push a hierarchical list of tasks to Google
export const pushTasksToGoogle = async (
  accessToken: string,
  taskListId: string,
  tasks: ExtractedTaskSchema[],
): Promise<{ success: boolean; createdCount: number }> => {
  let createdCount = 0;

  const pushTaskRecursive = async (task: ExtractedTaskSchema, parentId?: string) => {
    try {
      const createdGoogleTask = await createTask(accessToken, taskListId, task, parentId);
      createdCount++;
      if (task.subtasks && task.subtasks.length > 0) {
        for (const subtask of task.subtasks) {
          await pushTaskRecursive(subtask, createdGoogleTask.id);
        }
      }
    } catch (error) {
      console.error(`Skipping task "${task.title}" due to error:`, error);
      // Decide if you want to throw and stop the whole process, or just skip the failed task.
      // For now, we log and continue.
    }
  };

  for (const task of tasks) {
    await pushTaskRecursive(task);
  }

  return { success: true, createdCount };
};
