import { v4 as uuidv4 } from "uuid";
import type { ExtractedTaskSchema } from "@/types/chat";
import type { Person, PersonWithTaskCount } from "@/types/person";
import type { Task } from "@/types/project";
import { apiFetch } from "@/lib/api";
import { subscribeRealtimeUpdates } from "@/lib/realtime-client";

const LOCAL_REALTIME_EVENT = "taskwise:local-data-update";

const emitLocalDataUpdate = (topic: "people" | "tasks") => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(LOCAL_REALTIME_EVENT, {
      detail: { topic },
    })
  );
};

export const onPeopleSnapshot = (
  _userId: string,
  callback: (people: PersonWithTaskCount[]) => void
): (() => void) => {
  let active = true;
  let inFlight = false;
  let queuedRefresh = false;

  const fetchPeople = async () => {
    if (inFlight) {
      queuedRefresh = true;
      return;
    }
    inFlight = true;
    try {
      const people = await apiFetch<PersonWithTaskCount[]>("/api/people");
      if (active) callback(people);
    } catch (error) {
      console.error("Error fetching people:", error);
    } finally {
      inFlight = false;
      if (queuedRefresh) {
        queuedRefresh = false;
        void fetchPeople();
      }
    }
  };

  void fetchPeople();
  const unsubscribeRealtime = subscribeRealtimeUpdates(
    ["people", "meetings", "tasks", "board"],
    () => {
      void fetchPeople();
    }
  );
  const handleLocalDataUpdate = (event: Event) => {
    const detail = (event as CustomEvent<{ topic?: string }>).detail;
    if (detail?.topic !== "people") return;
    void fetchPeople();
  };
  if (typeof window !== "undefined") {
    window.addEventListener(LOCAL_REALTIME_EVENT, handleLocalDataUpdate);
  }

  return () => {
    active = false;
    unsubscribeRealtime();
    if (typeof window !== "undefined") {
      window.removeEventListener(LOCAL_REALTIME_EVENT, handleLocalDataUpdate);
    }
  };
};

export const addPerson = async (
  _userId: string,
  personData: Partial<Omit<Person, "id" | "userId" | "createdAt" | "lastSeenAt">>,
  sourceSessionId: string
): Promise<string> => {
  const created = await apiFetch<Person>("/api/people", {
    method: "POST",
    body: JSON.stringify({ ...personData, sourceSessionId }),
  });
  emitLocalDataUpdate("people");
  return created.id;
};

export const getPersonDetails = async (
  _userId: string,
  personId: string
): Promise<PersonWithTaskCount | null> => {
  try {
    return await apiFetch<PersonWithTaskCount>(`/api/people/${personId}`);
  } catch (error) {
    console.error("Error fetching person details:", error);
    try {
      const people = await apiFetch<PersonWithTaskCount[]>("/api/people");
      const match = people.find((person: any) => {
        const idMatch = String(person.id) === personId;
        const legacyMatch = person._id ? String(person._id) === personId : false;
        const slackMatch = person.slackId ? person.slackId === personId : false;
        return idMatch || legacyMatch || slackMatch;
      });
      return match || null;
    } catch (fallbackError) {
      console.error("Error fetching people fallback:", fallbackError);
      return null;
    }
  }
};

export const updatePerson = async (
  _userId: string,
  personId: string,
  data: Partial<Person>
): Promise<void> => {
  await apiFetch(`/api/people/${personId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
  emitLocalDataUpdate("people");
};

export const mergePeople = async (
  sourceId: string,
  targetId: string
): Promise<PersonWithTaskCount | null> => {
  const response = await apiFetch<{ person: PersonWithTaskCount }>(
    "/api/people/merge",
    {
      method: "POST",
      body: JSON.stringify({ sourceId, targetId }),
    }
  );
  emitLocalDataUpdate("people");
  return response.person || null;
};

export const onTasksForPersonSnapshot = (
  _userId: string,
  personId: string,
  callback: (tasks: Task[]) => void
): (() => void) => {
  let active = true;
  let inFlight = false;
  let queuedRefresh = false;

  const fetchTasks = async () => {
    if (inFlight) {
      queuedRefresh = true;
      return;
    }
    inFlight = true;
    try {
      const tasks = await apiFetch<Task[]>(`/api/people/${personId}/tasks`);
      if (active) callback(tasks);
    } catch (error) {
      console.error("Error fetching tasks for person:", error);
      if (active) callback([]);
    } finally {
      inFlight = false;
      if (queuedRefresh) {
        queuedRefresh = false;
        void fetchTasks();
      }
    }
  };

  void fetchTasks();
  const unsubscribeRealtime = subscribeRealtimeUpdates(
    ["tasks", "meetings", "board"],
    () => {
      void fetchTasks();
    }
  );
  const handleLocalDataUpdate = (event: Event) => {
    const detail = (event as CustomEvent<{ topic?: string }>).detail;
    if (detail?.topic !== "tasks") return;
    void fetchTasks();
  };
  if (typeof window !== "undefined") {
    window.addEventListener(LOCAL_REALTIME_EVENT, handleLocalDataUpdate);
  }

  return () => {
    active = false;
    unsubscribeRealtime();
    if (typeof window !== "undefined") {
      window.removeEventListener(LOCAL_REALTIME_EVENT, handleLocalDataUpdate);
    }
  };
};

export function normalizeTask(task: any): ExtractedTaskSchema {
  if (!task) return {} as ExtractedTaskSchema;

  const rawId =
    task.id ??
    (task._id?.toString?.() || task._id);
  const resolvedId = rawId || uuidv4();

  let sanitizedAssignee = null;
  if (task.assignee) {
    sanitizedAssignee = {
      uid: task.assignee.uid ?? null,
      name: task.assignee.name ?? null,
      email: task.assignee.email === undefined ? null : task.assignee.email,
      photoURL: task.assignee.photoURL === undefined ? null : task.assignee.photoURL,
      slackId: task.assignee.slackId === undefined ? null : task.assignee.slackId,
    };
  }

  const sanitizedSubtasks = task.subtasks
    ? (task.subtasks || []).map(normalizeTask)
    : null;

  return {
    id: resolvedId,
    title: task.title || "Untitled Task",
    description: task.description === undefined ? null : task.description,
    priority: task.priority || "medium",
    taskType: task.taskType === undefined ? null : task.taskType,
    dueAt: task.dueAt === undefined ? null : task.dueAt,
    status: task.status === undefined ? "todo" : task.status,
    assignee: sanitizedAssignee,
    assigneeName: task.assigneeName === undefined ? null : task.assigneeName,
    sourceEvidence: task.sourceEvidence === undefined ? null : task.sourceEvidence,
    aiProvider: task.aiProvider === undefined ? null : task.aiProvider,
    researchBrief: task.researchBrief === undefined ? null : task.researchBrief,
    aiAssistanceText: task.aiAssistanceText === undefined ? null : task.aiAssistanceText,
    comments: task.comments === undefined ? null : task.comments,
    subtasks: sanitizedSubtasks,
    addedToProjectId: task.addedToProjectId === undefined ? null : task.addedToProjectId,
    addedToProjectName: task.addedToProjectName === undefined ? null : task.addedToProjectName,
    addedToBoardId: task.addedToBoardId === undefined ? null : task.addedToBoardId,
    addedToBoardName: task.addedToBoardName === undefined ? null : task.addedToBoardName,
    completionSuggested:
      task.completionSuggested === undefined ? null : task.completionSuggested,
    completionConfidence:
      task.completionConfidence === undefined ? null : task.completionConfidence,
    completionEvidence:
      task.completionEvidence === undefined ? null : task.completionEvidence,
    completionTargets:
      task.completionTargets === undefined ? null : task.completionTargets,
  };
}
