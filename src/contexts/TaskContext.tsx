// src/contexts/TaskContext.tsx
"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import type { Task, Project } from '@/types/project'; // Use a single import
import { useAuth, type AppUser } from '@/contexts/AuthContext';
import { useToast } from "@/hooks/use-toast";
import { apiFetch } from '@/lib/api';
import type { ExtractedTaskSchema as DisplayTask } from '@/types/chat';

interface TaskContextType {
  tasks: Task[];
  projects: Project[];
  addTask: (taskData: Omit<Task, 'id'| 'userId' | 'createdAt' | 'order'| 'subtaskCount' | 'parentId' >) => Promise<string | undefined>;
  updateTask: (taskId: string, taskData: Partial<Omit<Task, 'id' | 'userId'>>) => Promise<void>;
  deleteTask: (taskId: string) => Promise<void>;
  addProject: (projectName: string) => Promise<string | undefined>;
  updateProject: (projectId: string, projectData: Partial<Project>) => Promise<void>;
  deleteProject: (projectId: string) => Promise<void>;
  isLoadingTasks: boolean;
  isLoadingProjects: boolean;
  addHierarchicalTasksToBoard: (tasks: DisplayTask[], projectId: string, options: { assignee?: Partial<AppUser> | null, sourceSessionId?: string, sourceSessionName?: string }) => Promise<string[] | undefined>;
}

const TaskContext = createContext<TaskContextType | undefined>(undefined);

export const TaskProvider = ({ children }: { children: ReactNode }) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoadingTasks, setIsLoadingTasks] = useState(true);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);

  const loadTasks = useCallback(async () => {
    if (!user) return;
    const data = await apiFetch<Task[]>("/api/tasks");
    setTasks(data);
  }, [user]);

  const loadProjects = useCallback(async () => {
    if (!user) return;
    const data = await apiFetch<Project[]>("/api/projects");
    setProjects(data);
  }, [user]);

  useEffect(() => {
    if (user) {
      setIsLoadingTasks(true);
      setIsLoadingProjects(true);
      Promise.all([loadTasks(), loadProjects()])
        .finally(() => {
          setIsLoadingTasks(false);
          setIsLoadingProjects(false);
        });
    } else {
      setTasks([]);
      setProjects([]);
      setIsLoadingTasks(false);
      setIsLoadingProjects(false);
    }
  }, [user, loadTasks, loadProjects]);

  const addTask = useCallback(async (
    taskData: Omit<Task, 'id' | 'userId' | 'createdAt' | 'order' | 'parentId'| 'subtaskCount'>
  ) => {
    if (!user) {
      toast({ title: "Authentication Error", description: "You must be logged in to add tasks.", variant: "destructive" });
      return;
    }
    try {
      const fullTaskData = {
        ...taskData,
        status: taskData.status || 'todo',
        priority: taskData.priority || 'medium',
        aiSuggested: taskData.aiSuggested || false,
        origin: taskData.origin || 'manual',
        parentId: null,
        order: 0,
        subtaskCount: 0,
      };
      const created = await apiFetch<Task>("/api/tasks", {
        method: "POST",
        body: JSON.stringify(fullTaskData),
      });
      setTasks(prev => [...prev, created]);
      toast({ title: "Task Added", description: `"${taskData.title}" has been added.` });
      return created.id;
    } catch (error) {
      console.error("Error adding task:", error);
      toast({ title: "Error", description: "Could not add task.", variant: "destructive" });
    }
  }, [user, toast]);

  const updateTask = useCallback(async (taskId: string, taskData: Partial<Omit<Task, 'id' | 'userId'>>) => {
    if (!user) {
      toast({ title: "Authentication Error", description: "You must be logged in to update tasks.", variant: "destructive" });
      return;
    }
    try {
      const updated = await apiFetch<Task>(`/api/tasks/${taskId}`, {
        method: "PATCH",
        body: JSON.stringify(taskData),
      });
      setTasks(prev => prev.map(task => task.id === updated.id ? updated : task));
      // Quiet update on success
    } catch (error) {
      console.error("Error updating task:", error);
      toast({ title: "Error", description: "Could not update task.", variant: "destructive" });
    }
  }, [user, toast]);

  const deleteTask = useCallback(async (taskId: string) => {
    if (!user) {
      toast({ title: "Authentication Error", description: "You must be logged in to delete tasks.", variant: "destructive" });
      return;
    }
    try {
      await apiFetch(`/api/tasks/${taskId}`, { method: "DELETE" });
      await loadTasks();
      // Toast is now handled by the calling component for more context
    } catch (error) {
      console.error("Error deleting task:", error);
      toast({ title: "Error", description: "Could not delete task.", variant: "destructive" });
      throw error;
    }
  }, [user, toast]);

  const addProject = useCallback(async (projectName: string) => {
    if (!user) {
      toast({ title: "Authentication Error", description: "You must be logged in to add projects.", variant: "destructive" });
      return;
    }
    try {
      const created = await apiFetch<Project>("/api/projects", {
        method: "POST",
        body: JSON.stringify({ name: projectName }),
      });
      setProjects(prev => [...prev, created]);
      toast({ title: "Project Created", description: `Project "${projectName}" has been created.` });
      return created.id;
    } catch (error) {
      console.error("Error adding project:", error);
      toast({ title: "Error", description: "Could not add project.", variant: "destructive" });
    }
  }, [user, toast]);

  const updateProject = useCallback(async (projectId: string, projectData: Partial<Project>) => {
    if (!user) {
      toast({ title: "Authentication Error", description: "You must be logged in to update projects.", variant: "destructive" });
      return;
    }
    try {
      const updated = await apiFetch<Project>(`/api/projects/${projectId}`, {
        method: "PATCH",
        body: JSON.stringify(projectData),
      });
      setProjects(prev => prev.map(project => project.id === updated.id ? updated : project));
      toast({ title: "Project Updated" });
    } catch (error) {
      console.error("Error updating project:", error);
      toast({ title: "Error", description: "Could not update project.", variant: "destructive" });
    }
  }, [user, toast]);

  const deleteProject = useCallback(async (projectId: string) => {
    if (!user) {
      toast({ title: "Authentication Error", description: "You must be logged in to delete projects.", variant: "destructive" });
      return;
    }
    try {
      await apiFetch(`/api/projects/${projectId}`, { method: "DELETE" });
      await Promise.all([loadProjects(), loadTasks()]);
      toast({ title: "Project Deleted", description: "The project and all its tasks have been removed." });
    } catch (error) {
      console.error("Error deleting project:", error);
      toast({ title: "Error", description: "Could not delete project.", variant: "destructive" });
    }
  }, [user, toast]);

  const addHierarchicalTasksToBoard = useCallback(async (
    tasksToAdd: DisplayTask[],
    projectId: string,
    options: { assignee?: Partial<AppUser> | null, sourceSessionId?: string, sourceSessionName?: string }
  ): Promise<string[] | undefined> => {
    if (!user) {
        toast({ title: "Authentication Error", description: "You must be logged in.", variant: "destructive" });
        return;
    }

    const { assignee, sourceSessionId, sourceSessionName } = options;
    const addedTaskIds: string[] = [];

    const addTaskRecursive = async (task: DisplayTask, parentTaskId: string | null): Promise<string> => {
        const cleanAssignee = (rawAssignee: Partial<AppUser> | null | undefined): Partial<AppUser> | undefined => {
            if (!rawAssignee) return undefined;
            return {
                uid: rawAssignee.uid || '',
                name: rawAssignee.name || rawAssignee.displayName || '',
                email: rawAssignee.email || null,
                photoURL: rawAssignee.photoURL || null,
            };
        };

        const finalAssignee = task.assignee || assignee;

        const newTask: Omit<Task, 'id' | 'createdAt'> = {
            title: task.title,
            description: task.description || '',
            status: 'todo',
            priority: task.priority || 'medium',
            dueAt: task.dueAt || null,
            aiSuggested: true,
            projectId: projectId,
            userId: user.uid,
            parentId: parentTaskId,
            order: 0, 
            subtaskCount: task.subtasks?.length || 0,
            assignee: cleanAssignee(finalAssignee),
            sourceSessionId: sourceSessionId || null,
            sourceSessionName: sourceSessionName || null,
        };
        const created = await apiFetch<Task>("/api/tasks", {
          method: "POST",
          body: JSON.stringify(newTask),
        });
        addedTaskIds.push(created.id);

        if (task.subtasks) {
            for (const subtask of task.subtasks) {
                await addTaskRecursive(subtask, created.id);
            }
        }
        return created.id;
    };

    try {
        for (const rootTask of tasksToAdd) {
            await addTaskRecursive(rootTask, null);
        }
        await loadTasks();
        return addedTaskIds;
    } catch (error) {
        console.error("Error adding hierarchical tasks:", error);
        toast({ title: "Error", description: "Could not add all tasks to the board.", variant: "destructive" });
        return undefined;
    }
  }, [user, toast]);

  return (
    <TaskContext.Provider value={{
      tasks,
      projects,
      addTask,
      updateTask,
      deleteTask,
      addProject,
      updateProject,
      deleteProject,
      isLoadingTasks,
      isLoadingProjects,
      addHierarchicalTasksToBoard,
    }}>
      {children}
    </TaskContext.Provider>
  );
};

export const useTasks = (): TaskContextType => {
  const context = useContext(TaskContext);
  if (context === undefined) {
    throw new Error('useTasks must be used within a TaskProvider');
  }
  return context;
};
