// src/components/dashboard/people/PersonDetailPageContent.tsx
"use client";

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { User, Mail, Loader2, Briefcase, Save, MessageSquare, Bot, FileText, Slack, Edit3, CheckCircle2, X, Trash2, Filter, Tag, Building2, CalendarClock, CalendarDays, Quote, GitMerge, UserCheck, StickyNote, AlertTriangle } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { getPersonDetails, onTasksForPersonSnapshot, updatePerson } from '@/lib/data';
import type { Person, PersonWithTaskCount } from '@/types/person';
import type { Task } from '@/types/project';
import Link from 'next/link';
import { format } from 'date-fns';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { useIntegrations } from '@/contexts/IntegrationsContext';
import { useMeetingHistory } from '@/contexts/MeetingHistoryContext';
import ShareToSlackDialog from '@/components/dashboard/common/ShareToSlackDialog';
import ProfileReportDialog from '@/components/dashboard/common/ProfileReportDialog';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import type { ExtractedTaskSchema } from '@/types/chat';
import TaskDetailDialog from '@/components/dashboard/planning/TaskDetailDialog';
import DashboardHeader from '../DashboardHeader';
import DashboardScreenSkeleton from "@/components/dashboard/DashboardScreenSkeleton";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useRouter } from 'next/navigation';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { apiFetch } from '@/lib/api';
import { useWorkspaceBoards } from "@/hooks/use-workspace-boards";
import { moveTaskToBoard } from "@/lib/board-actions";
import { buildBriefContext } from "@/lib/brief-context";
import { generateBriefsForTasks } from "@/lib/task-briefs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";


interface PersonDetailPageContentProps {
  personId: string;
}

interface TranscriptMention {
  meetingId: string;
  meetingTitle: string;
  startTime: string | null;
  snippet: string;
  timestamp: string | null;
}

const getInitials = (name: string | null | undefined) => {
    if (!name) return 'U';
    return name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
};

const DetailField = ({
    icon: Icon,
    label,
    value,
    placeholder,
    isEditing,
    onChange,
    className,
    type
}: {
    icon: React.ElementType;
    label: string;
    value: string;
    placeholder: string;
    isEditing: boolean;
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    className?: string;
    type?: string;
}) => (
    <div className={cn("p-4 work-inset", className)}>
        <Label htmlFor={`person-${label.toLowerCase()}`} className="flex items-center text-sm font-medium text-muted-foreground mb-1">
            <Icon className="mr-2 h-4 w-4" />
            {label}
        </Label>

        {isEditing ? (
            <Input
                id={`person-${label.toLowerCase()}`}
                value={value}
                onChange={onChange}
                placeholder={placeholder}
                type={type}
                className="bg-transparent border-none p-0 text-base h-auto focus-visible:ring-0 placeholder:text-muted-foreground/60"
            />
        ) : (
            <p className="text-base font-normal text-foreground min-h-[26px]">{value || <span className="text-muted-foreground/60 italic">{placeholder}</span>}</p>
        )}
    </div>
);


export default function PersonDetailPageContent({ personId }: PersonDetailPageContentProps) {
  const { user, loading: authLoading } = useAuth();
  const workspaceId = user?.workspace?.id;
  const { boards } = useWorkspaceBoards(workspaceId);
  const { meetings } = useMeetingHistory();
  const { isSlackConnected } = useIntegrations();
  const router = useRouter();
  const { toast } = useToast();
  const [person, setPerson] = useState<PersonWithTaskCount | null>(null);
  const [editablePerson, setEditablePerson] = useState<Partial<Person>>({});
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isBlocking, setIsBlocking] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [isSlackShareOpen, setIsSlackShareOpen] = useState(false);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [slackShareTasks, setSlackShareTasks] = useState<ExtractedTaskSchema[]>([]);
  const [isTaskDetailDialogOpen, setIsTaskDetailDialogOpen] = useState(false);
  const [taskForDetailView, setTaskForDetailView] = useState<ExtractedTaskSchema | null>(null);
  const [taskDetailContext, setTaskDetailContext] = useState<{
    sourceType: Task["sourceSessionType"];
    sourceSessionId?: string | null;
    sourceTaskId?: string | null;
    derivedTaskId: string;
  } | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | Task["status"]>("all");
  const [bulkStatusValue, setBulkStatusValue] = useState<string>("");
  const [showCompletedMeetings, setShowCompletedMeetings] = useState(false);
  const [isDeleteTaskConfirmOpen, setIsDeleteTaskConfirmOpen] = useState(false);
  const [taskToDelete, setTaskToDelete] = useState<Task | null>(null);
  const [isBulkDeleteConfirmOpen, setIsBulkDeleteConfirmOpen] = useState(false);
  const [dueDateFilter, setDueDateFilter] = useState<"all" | "overdue" | "next_7" | "no_due">("all");
  const [isGeneratingBriefs, setIsGeneratingBriefs] = useState(false);
  const [isReportOpen, setIsReportOpen] = useState(false);
  const [isSettingType, setIsSettingType] = useState(false);
  const [mentions, setMentions] = useState<TranscriptMention[]>([]);

  const mapTaskToExtracted = useCallback(
    (task: Task): ExtractedTaskSchema => ({
      id: task.sourceTaskId || task.id,
      title: task.title,
      description: task.description ?? null,
      priority: task.priority,
      dueAt: task.dueAt ?? null,
      assignee: task.assignee ?? null,
      assigneeName: task.assignee?.name ?? null,
      subtasks: (task as any).subtasks ?? undefined,
      status: task.status,
      comments: task.comments ?? null,
      researchBrief: task.researchBrief ?? null,
      aiAssistanceText: task.aiAssistanceText ?? null,
      sourceSessionId: task.sourceSessionId ?? undefined,
      sourceSessionName: task.sourceSessionName ?? null,
    }),
    []
  );

  const slackTasks = useMemo(() => {
    return tasks.map(mapTaskToExtracted);
  }, [tasks, mapTaskToExtracted]);

  const selectedTasks = useMemo(
    () => tasks.filter((task: any) => selectedTaskIds.has(task.id)),
    [tasks, selectedTaskIds]
  );

  const selectedSlackTasks = useMemo(
    () => selectedTasks.map(mapTaskToExtracted),
    [selectedTasks, mapTaskToExtracted]
  );

  const filteredTasks = useMemo(() => {
    let next = tasks;
    if (statusFilter !== "all") {
      next = next.filter((task: any) => (task.status || "todo") === statusFilter);
    }

    if (dueDateFilter !== "all") {
      const now = new Date();
      const sevenDaysOut = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      const resolveDueDate = (value?: string | Date | null) => {
        if (!value) return null;
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return null;
        return date;
      };

      next = next.filter((task: any) => {
        const dueDate = resolveDueDate(task.dueAt ?? null);
        if (dueDateFilter === "no_due") return !dueDate;
        if (!dueDate) return false;
        if (dueDateFilter === "overdue") return dueDate < now;
        if (dueDateFilter === "next_7") {
          return dueDate >= now && dueDate <= sevenDaysOut;
        }
        return true;
      });
    }

    return next;
  }, [tasks, statusFilter, dueDateFilter]);

  const selectedVisibleCount = useMemo(
    () => filteredTasks.filter((task: any) => selectedTaskIds.has(task.id)).length,
    [filteredTasks, selectedTaskIds]
  );

  const allVisibleSelected =
    filteredTasks.length > 0 && selectedVisibleCount === filteredTasks.length;

  const groupedTasks = useMemo(() => {
    if (filteredTasks.length === 0) return {};
    return filteredTasks.reduce((acc, task) => {
      const groupName = task.sourceSessionName || "General Tasks";
      if (!acc[groupName]) {
        acc[groupName] = [];
      }
      acc[groupName].push(task);
      return acc;
    }, {} as Record<string, Task[]>);
  }, [filteredTasks]);

  const visibleGroupedTasks = useMemo(() => {
    const entries = Object.entries(groupedTasks);
    if (showCompletedMeetings) return entries;
    return entries.filter(([, sessionTasks]) =>
      sessionTasks.some((task: any) => (task.status || "todo") !== "done")
    );
  }, [groupedTasks, showCompletedMeetings]);

  useEffect(() => {
    if (authLoading) {
      setIsLoading(true);
      return;
    }
    if (!user?.uid || !personId) {
      setPerson(null);
      setEditablePerson({});
      setTasks([]);
      setIsLoading(false);
      return;
    }

    const fetchDetails = async () => {
      setIsLoading(true);
      try {
        const personDetails = await getPersonDetails(user.uid, personId);
        setPerson(personDetails);
        setEditablePerson(personDetails || {});
      } catch (error) {
        console.error("Error fetching person details:", error);
      } finally {
        setIsLoading(false);
      }
    };
    fetchDetails();

    const unsubscribe = onTasksForPersonSnapshot(user.uid, personId, (loadedTasks) => {
        setTasks(loadedTasks);
    });
    return () => unsubscribe();
  }, [user, personId, authLoading]);

  useEffect(() => {
    setSelectedTaskIds((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set<string>();
      tasks.forEach((task: any) => {
        if (prev.has(task.id)) {
          next.add(task.id);
        }
      });
      return next;
    });
  }, [tasks]);

  // Recent transcript mentions (Priority 9 profile section).
  useEffect(() => {
    if (!user?.uid || !personId) {
      setMentions([]);
      return;
    }
    let active = true;
    apiFetch<{ mentions: TranscriptMention[] }>(`/api/people/${personId}/mentions`)
      .then((payload) => {
        if (active) setMentions(payload.mentions || []);
      })
      .catch((error) => {
        console.error("Failed to load transcript mentions:", error);
        if (active) setMentions([]);
      });
    return () => {
      active = false;
    };
  }, [user?.uid, personId]);

  // Relationship summary + meeting timeline derived data.
  const openTaskCount = useMemo(
    () => tasks.filter((task: any) => (task.status || "todo") !== "done").length,
    [tasks]
  );

  const overdueTaskCount = useMemo(() => {
    const now = Date.now();
    return tasks.filter((task: any) => {
      if ((task.status || "todo") === "done" || !task.dueAt) return false;
      const due = new Date(task.dueAt).getTime();
      return !Number.isNaN(due) && due < now;
    }).length;
  }, [tasks]);

  const personMeetings = useMemo(() => {
    if (!person) return [];
    const sessionIds = new Set((person.sourceSessionIds || []).map(String));
    const emailKey = person.email?.trim().toLowerCase() || null;
    const nameKeys = new Set(
      [person.name, ...(person.aliases || [])]
        .filter(Boolean)
        .map((name) => String(name).trim().toLowerCase())
    );
    return meetings
      .filter((meeting: any) => {
        if (sessionIds.has(String(meeting.id))) return true;
        const attendees = Array.isArray(meeting.attendees) ? meeting.attendees : [];
        return attendees.some((attendee: any) => {
          const attendeeEmail =
            typeof attendee?.email === "string"
              ? attendee.email.trim().toLowerCase()
              : null;
          if (emailKey && attendeeEmail === emailKey) return true;
          const attendeeName =
            typeof attendee?.name === "string"
              ? attendee.name.trim().toLowerCase()
              : null;
          return Boolean(attendeeName && nameKeys.has(attendeeName));
        });
      })
      .sort((a: any, b: any) => {
        const aTime = a.startTime ? new Date(a.startTime).getTime() : 0;
        const bTime = b.startTime ? new Date(b.startTime).getTime() : 0;
        return bTime - aTime;
      })
      .slice(0, 8);
  }, [meetings, person]);

  const lastMeetingAt = useMemo(() => {
    const first: any = personMeetings[0];
    if (!first?.startTime) return null;
    const date = new Date(first.startTime);
    return Number.isNaN(date.getTime()) ? null : date;
  }, [personMeetings]);

  const handleSetPersonType = async (nextType: Person["personType"]) => {
    if (!user || !person?.id || isSettingType) return;
    setIsSettingType(true);
    try {
      await updatePerson(user.uid, person.id, { personType: nextType });
      const updatedPersonDetails = await getPersonDetails(user.uid, person.id);
      setPerson(updatedPersonDetails);
      setEditablePerson(updatedPersonDetails || {});
      toast({
        title: nextType === "teammate" ? "Marked as teammate" : "Marked as client",
        description: `${person.name} is now classified as a ${nextType}.`,
      });
    } catch (error) {
      console.error("Failed to update person type:", error);
      toast({
        title: "Update Failed",
        description: "Could not update this person's type.",
        variant: "destructive",
      });
    } finally {
      setIsSettingType(false);
    }
  };

  const handleInputChange = (field: keyof Person, value: string | string[] | null) => {
      setEditablePerson(prev => ({ ...prev, [field]: value }));
  }

  const handleAliasChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const aliases = e.target.value.split(',').map(alias => alias.trim());
      handleInputChange('aliases', aliases);
  }
  
  const hasChanges = useMemo(() => {
    if (!person || !isEditing) return false;
    return JSON.stringify(person) !== JSON.stringify({ ...person, ...editablePerson });
  }, [person, editablePerson, isEditing]);


  const handleSaveChanges = async () => {
    if (!user || !person || !person.id) {
        toast({ title: "Error", description: "Could not save changes. User or Person ID is missing.", variant: "destructive"});
        setIsEditing(false);
        return;
    };
    
    if (!hasChanges) {
        setIsEditing(false);
        return;
    }

    setIsSaving(true);
    try {
        const payload: Partial<Person> = { ...editablePerson };
        // Only send personType when the user actually changed it — the server
        // marks any PATCHed personType as a manual classification.
        if ((payload.personType ?? 'unknown') === (person.personType ?? 'unknown')) {
            delete payload.personType;
        }
        await updatePerson(user.uid, person.id, payload);
        const updatedPersonDetails = await getPersonDetails(user.uid, person.id);
        setPerson(updatedPersonDetails);
        setEditablePerson(updatedPersonDetails || {});
        
        toast({
          title: "Profile Synced!",
          description: `${person.name}'s profile has been successfully updated.`,
        });

        setIsEditing(false);
    } catch (error) {
        console.error("Error updating person profile:", error);
        toast({ title: "Save Failed", description: "Could not save the changes.", variant: "destructive"});
    } finally {
        setIsSaving(false);
    }
  }

  const handleToggleBlock = async () => {
    if (!user || !person?.id) return;
    setIsBlocking(true);
    try {
      const nextBlocked = !person.isBlocked;
      await updatePerson(user.uid, person.id, { isBlocked: nextBlocked });
      const updatedPersonDetails = await getPersonDetails(user.uid, person.id);
      setPerson(updatedPersonDetails);
      setEditablePerson(updatedPersonDetails || {});
      toast({
        title: nextBlocked ? "Person Blocked" : "Person Unblocked",
        description: nextBlocked
          ? "This person will be ignored in future discoveries."
          : "This person can be discovered again.",
      });
    } catch (error) {
      console.error("Error updating block status:", error);
      toast({ title: "Update Failed", description: "Could not update block status.", variant: "destructive" });
    } finally {
      setIsBlocking(false);
    }
  };

  const handleDeletePerson = async () => {
    if (!user?.uid || !person?.id) return;
    try {
      const response = await fetch(`/api/people/${person.id}`, { method: "DELETE" });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "Delete failed.");
      }
      toast({ title: "Person Deleted", description: "This person has been removed from your directory." });
      router.push("/people");
    } catch (error) {
      console.error("Error deleting person:", error);
      toast({ title: "Delete Failed", description: "Could not delete this person.", variant: "destructive" });
    }
  };

  const handleToggleTaskSelection = (taskId: string, checked: boolean) => {
    setSelectedTaskIds((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(taskId);
      } else {
        next.delete(taskId);
      }
      return next;
    });
  };

  const handleSelectAllTasks = () => {
    setSelectedTaskIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        filteredTasks.forEach((task: any) => next.delete(task.id));
      } else {
        filteredTasks.forEach((task: any) => next.add(task.id));
      }
      return next;
    });
  };

  const handleTaskStatusChange = async (task: Task, nextStatus: Task["status"]) => {
    try {
      if (task.sourceSessionType === "meeting" || task.sourceSessionType === "chat") {
        await apiFetch("/api/tasks/status", {
          method: "PATCH",
          body: JSON.stringify({
            sourceSessionId: task.sourceSessionId,
            sourceSessionType: task.sourceSessionType,
            taskId: task.sourceTaskId || task.id.split(":")[1] || task.id,
            status: nextStatus,
          }),
        });
      } else {
        await apiFetch(`/api/tasks/${task.id}`, {
          method: "PATCH",
          body: JSON.stringify({ status: nextStatus }),
        });
      }

      setTasks((prev) =>
        prev.map((item: any) =>
          item.id === task.id ? { ...item, status: nextStatus } : item
        )
      );
    } catch (error) {
      console.error("Failed to update task status:", error);
      toast({
        title: "Status Update Failed",
        description: "Could not update the task status.",
        variant: "destructive",
      });
    }
  };

  const handleOpenTaskDetails = (task: Task) => {
    setTaskForDetailView(mapTaskToExtracted(task));
    setTaskDetailContext({
      sourceType: task.sourceSessionType || "task",
      sourceSessionId: task.sourceSessionId,
      sourceTaskId: task.sourceTaskId || task.id,
      derivedTaskId: task.id,
    });
    setIsTaskDetailDialogOpen(true);
  };

  const updateTaskInList = useCallback(
    (
      tasksToUpdate: ExtractedTaskSchema[],
      taskId: string,
      updated: ExtractedTaskSchema
    ): ExtractedTaskSchema[] => {
      return tasksToUpdate.map((taskItem: any) => {
        if (taskItem.id === taskId) {
          return { ...taskItem, ...updated, id: taskItem.id };
        }
        if (taskItem.subtasks?.length) {
          return {
            ...taskItem,
            subtasks: updateTaskInList(taskItem.subtasks, taskId, updated),
          };
        }
        return taskItem;
      });
    },
    []
  );

  const getPersistentTaskId = useCallback((task: Task) => {
    if (task.sourceTaskId) return task.sourceTaskId;
    if (task.id.includes(":")) {
      const parts = task.id.split(":");
      return parts.slice(1).join(":");
    }
    return task.id;
  }, []);

  const handleSaveTaskDetails = async (
    updatedTask: ExtractedTaskSchema,
    options?: { close?: boolean }
  ) => {
    if (!taskDetailContext) return;
    const { sourceType, sourceSessionId, sourceTaskId, derivedTaskId } =
      taskDetailContext;
    const taskUpdatePayload = {
      title: updatedTask.title,
      description: updatedTask.description ?? null,
      priority: updatedTask.priority,
      dueAt: updatedTask.dueAt ?? null,
      status: updatedTask.status || "todo",
      comments: updatedTask.comments ?? null,
      researchBrief: updatedTask.researchBrief ?? null,
      aiAssistanceText: updatedTask.aiAssistanceText ?? null,
    };

    try {
      const persistentTaskId = sourceTaskId || derivedTaskId;
      const fallbackUpdate = async () => {
        await apiFetch(`/api/tasks/${persistentTaskId}`, {
          method: "PATCH",
          body: JSON.stringify(taskUpdatePayload),
        });
      };

      if (sourceType === "meeting" && sourceSessionId && sourceTaskId) {
        const meetings = await apiFetch<any[]>("/api/meetings");
        const meeting = meetings.find((item: any) => String(item.id) === sourceSessionId);
        if (!meeting) {
          await fallbackUpdate();
        } else {
          const updatedTasks = updateTaskInList(
            meeting.extractedTasks || [],
            sourceTaskId,
            { ...updatedTask, id: sourceTaskId }
          );
          await apiFetch(`/api/meetings/${sourceSessionId}`, {
            method: "PATCH",
            body: JSON.stringify({ extractedTasks: updatedTasks }),
          });
        }
      } else if (sourceType === "chat" && sourceSessionId && sourceTaskId) {
        const sessions = await apiFetch<any[]>("/api/chat-sessions");
        const session = sessions.find((item: any) => String(item.id) === sourceSessionId);
        if (!session) {
          await fallbackUpdate();
        } else {
          const updatedTasks = updateTaskInList(
            session.suggestedTasks || [],
            sourceTaskId,
            { ...updatedTask, id: sourceTaskId }
          );
          await apiFetch(`/api/chat-sessions/${sourceSessionId}`, {
            method: "PATCH",
            body: JSON.stringify({ suggestedTasks: updatedTasks }),
          });
        }
      } else {
        await fallbackUpdate();
      }

      setTasks((prev) =>
        prev.map((item: any) =>
          item.id === derivedTaskId
            ? { ...item, ...taskUpdatePayload }
            : item
        )
      );
      toast({ title: "Task Updated", description: "Task details were saved." });
      if (options?.close !== false) {
        setIsTaskDetailDialogOpen(false);
        setTaskForDetailView(null);
        setTaskDetailContext(null);
      }
    } catch (error) {
      console.error("Failed to save task details:", error);
      toast({
        title: "Update Failed",
        description: "Could not update this task.",
        variant: "destructive",
      });
    }
  };

  const handleMoveTaskToBoard = useCallback(
    async (boardId: string) => {
      if (!workspaceId || !taskForDetailView) {
        throw new Error("Workspace not ready.");
      }
      await moveTaskToBoard(workspaceId, taskForDetailView.id, boardId);
    },
    [taskForDetailView, workspaceId]
  );

  const getBriefContext = useCallback(
    (task: ExtractedTaskSchema) =>
      buildBriefContext(task, meetings, person ? [person] : []),
    [meetings, person]
  );

  const handleGenerateBriefsForSelectedTasks = async () => {
    if (isGeneratingBriefs) return;
    if (selectedTasks.length === 0) {
      toast({
        title: "No tasks selected",
        description: "Please select tasks to generate briefs for.",
        variant: "destructive",
      });
      return;
    }

    setIsGeneratingBriefs(true);
    toast({
      title: "Generating Briefs...",
      description: `AI is preparing briefs for ${selectedTasks.length} task(s).`,
    });

    try {
      const selectedById = new Map<string, Task>(
        selectedTasks.map((task: any) => [task.id, task])
      );
      const { successes, failures, limitReached } = await generateBriefsForTasks({
        taskIds: selectedTaskIds,
        resolveTask: (taskId) => {
          const task = selectedById.get(taskId);
          return task ? mapTaskToExtracted(task) : null;
        },
        resolveBriefContext: getBriefContext,
      });

      failures.forEach((failure) => {
        const task = selectedById.get(failure.taskId);
        console.error(
          `Error generating brief for task ${task?.title || failure.taskId}:`,
          failure.error
        );
      });

      if (limitReached) {
        toast({
          title: "Brief limit reached",
          description: "You have used all 10 AI Brief generations for this month.",
          variant: "destructive",
        });
      }

      let appliedCount = 0;
      for (const result of successes) {
        const originalTask = selectedById.get(result.taskId);
        if (!originalTask) continue;
        try {
          const persistentTaskId = getPersistentTaskId(originalTask);
          const params = new URLSearchParams();
          if (
            (originalTask.sourceSessionType === "meeting" ||
              originalTask.sourceSessionType === "chat") &&
            originalTask.sourceSessionId
          ) {
            params.set("sourceSessionId", originalTask.sourceSessionId);
            if (originalTask.sourceSessionType) {
              params.set("sourceSessionType", originalTask.sourceSessionType);
            }
          }
          if (originalTask.sourceTaskId) {
            params.set("sourceTaskId", originalTask.sourceTaskId);
          }
          const patchUrl = params.toString()
            ? `/api/tasks/${persistentTaskId}?${params.toString()}`
            : `/api/tasks/${persistentTaskId}`;
          await apiFetch(patchUrl, {
            method: "PATCH",
            body: JSON.stringify({ researchBrief: result.brief }),
          });
          appliedCount += 1;
        } catch (error) {
          console.error(
            `Error saving brief for task ${originalTask.title}:`,
            error
          );
        }
      }

      if (appliedCount > 0) {
        const briefByTaskId = new Map(
          successes.map((result: any) => [result.taskId, result.brief])
        );
        setTasks((prev) =>
          prev.map((task: any) => {
            const nextBrief = briefByTaskId.get(task.id);
            if (nextBrief === undefined) return task;
            return { ...task, researchBrief: nextBrief };
          })
        );
        if (taskForDetailView) {
          const nextBrief = briefByTaskId.get(taskForDetailView.id);
          if (nextBrief) {
            setTaskForDetailView((prev) =>
              prev ? { ...prev, researchBrief: nextBrief } : prev
            );
          }
        }
        toast({
          title: "Briefs Generated",
          description: `Research briefs generated for ${appliedCount} task(s).`,
        });
      } else if (!limitReached) {
        toast({
          title: "No Briefs Generated",
          description: "Could not generate briefs for the selected tasks.",
          variant: "destructive",
        });
      }
    } finally {
      setIsGeneratingBriefs(false);
    }
  };

  const handleDeleteTask = async () => {
    if (!taskToDelete) return;
    try {
      const params = new URLSearchParams();
      const isSessionTask =
        taskToDelete.sourceSessionType === "meeting" ||
        taskToDelete.sourceSessionType === "chat";
      if (isSessionTask && taskToDelete.sourceSessionId) {
        params.set("sourceSessionId", taskToDelete.sourceSessionId);
        if (taskToDelete.sourceSessionType) {
          params.set("sourceSessionType", taskToDelete.sourceSessionType);
        }
      }
      if (taskToDelete.sourceTaskId) {
        params.set("sourceTaskId", taskToDelete.sourceTaskId);
      }
      const persistentTaskId = getPersistentTaskId(taskToDelete);
      const deleteUrl = params.toString()
        ? `/api/tasks/${persistentTaskId}?${params.toString()}`
        : `/api/tasks/${persistentTaskId}`;
      await apiFetch(deleteUrl, { method: "DELETE" });

      setTasks((prev) => prev.filter((task: any) => task.id !== taskToDelete.id));
      toast({ title: "Task Deleted", description: "The task has been removed." });
    } catch (error) {
      console.error("Failed to delete task:", error);
      toast({
        title: "Delete Failed",
        description: "Could not delete this task.",
        variant: "destructive",
      });
    } finally {
      setIsDeleteTaskConfirmOpen(false);
      setTaskToDelete(null);
    }
  };

  const handleBulkStatusChange = async (nextStatus: Task["status"]) => {
    if (selectedTasks.length === 0) return;
    await Promise.all(
      selectedTasks.map((task: any) => handleTaskStatusChange(task, nextStatus))
    );
    setBulkStatusValue("");
  };

  const handleBulkDeleteTasks = async () => {
    if (selectedTasks.length === 0) return;
    try {
      await Promise.all(
        selectedTasks.map(async (task) => {
          const params = new URLSearchParams();
          const isSessionTask =
            task.sourceSessionType === "meeting" || task.sourceSessionType === "chat";
          if (isSessionTask && task.sourceSessionId) {
            params.set("sourceSessionId", task.sourceSessionId);
            if (task.sourceSessionType) {
              params.set("sourceSessionType", task.sourceSessionType);
            }
          }
          if (task.sourceTaskId) {
            params.set("sourceTaskId", task.sourceTaskId);
          }
          const persistentTaskId = getPersistentTaskId(task);
          const deleteUrl = params.toString()
            ? `/api/tasks/${persistentTaskId}?${params.toString()}`
            : `/api/tasks/${persistentTaskId}`;
          await apiFetch(deleteUrl, { method: "DELETE" });
        })
      );

      const selectedIdSet = new Set(selectedTasks.map((task: any) => task.id));
      setTasks((prev) => prev.filter((task: any) => !selectedIdSet.has(task.id)));
      setSelectedTaskIds(new Set());
      toast({ title: "Tasks Deleted", description: `${selectedTasks.length} task(s) removed.` });
    } catch (error) {
      console.error("Failed to bulk delete tasks:", error);
      toast({
        title: "Bulk Delete Failed",
        description: "Could not delete the selected tasks.",
        variant: "destructive",
      });
    } finally {
      setIsBulkDeleteConfirmOpen(false);
    }
  };
  
  if (isLoading) {
      return <DashboardScreenSkeleton className="py-8" />;
  }

  if (!person) {
    return (
      <div className="text-center py-20">
        <h2 className="text-2xl font-bold">Person Not Found</h2>
        <p className="text-muted-foreground">The person you are looking for does not exist or could not be loaded.</p>
        <Link href="/people"><Button variant="link" className="mt-4">Back to People Directory</Button></Link>
      </div>
    );
  }

  const currentPersonData = isEditing ? editablePerson : person;

  const headerTitle = (
      <h1 className="text-2xl font-bold font-headline">
        {currentPersonData.name ? `Profile: ${currentPersonData.name}` : "Person Details"}
      </h1>
  );

  return (
    <div className="flex flex-col h-full">
        <DashboardHeader
            pageIcon={User}
            pageTitle={headerTitle}
        >
            {person?.isBlocked && (
              <Badge variant="destructive">Blocked</Badge>
            )}
            {isEditing ? (
                <>
                    <Button variant="outline" onClick={() => { setIsEditing(false); setEditablePerson(person);}}>
                        <X className="mr-2 h-4 w-4"/> Cancel
                    </Button>
                    <Button onClick={handleSaveChanges} disabled={isSaving || !hasChanges}>
                        {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Save className="mr-2 h-4 w-4"/>}
                        Save Profile
                    </Button>
                </>
            ) : (
                <>
                  <Button variant="outline" onClick={() => setIsReportOpen(true)}>
                    <FileText className="mr-2 h-4 w-4" />
                    Generate report
                  </Button>
                  {(person?.personType ?? 'unknown') !== 'teammate' && (
                    <Button variant="outline" onClick={() => handleSetPersonType('teammate')} disabled={isSettingType}>
                      {isSettingType ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <UserCheck className="mr-2 h-4 w-4"/>}
                      Mark as teammate
                    </Button>
                  )}
                  {(person?.personType ?? 'unknown') !== 'client' && (
                    <Button variant="outline" onClick={() => handleSetPersonType('client')} disabled={isSettingType}>
                      {isSettingType ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Building2 className="mr-2 h-4 w-4"/>}
                      Mark as client
                    </Button>
                  )}
                  <Button variant="outline" onClick={handleToggleBlock} disabled={isBlocking}>
                    {isBlocking ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <CheckCircle2 className="mr-2 h-4 w-4"/>}
                    {person?.isBlocked ? "Unblock" : "Block"}
                  </Button>
                  {isSlackConnected && (
                    <Button
                      variant="outline"
                      onClick={() => {
                        setSlackShareTasks(slackTasks);
                        setIsSlackShareOpen(true);
                      }}
                    >
                      <Slack className="mr-2 h-4 w-4" />
                      Send to Slack
                    </Button>
                  )}
                  <Button variant="outline" onClick={() => setIsDeleteConfirmOpen(true)}>
                    Delete
                  </Button>
                  <Button onClick={() => setIsEditing(true)}>
                      <Edit3 className="mr-2 h-4 w-4"/> Edit Profile
                  </Button>
                </>
            )}
        </DashboardHeader>
        
        <div className="flex-grow p-4 sm:p-6 lg:p-8 space-y-8 overflow-auto">
            <div className="max-w-4xl mx-auto">
                 <motion.div 
                    initial={{ opacity: 0, y: -20 }} 
                    animate={{ opacity: 1, y: 0 }} 
                    transition={{ duration: 0.5, delay: 0.1 }} 
                    className="flex flex-col md:flex-row items-center gap-6"
                >
                    <div className="relative group flex-shrink-0 flex flex-col items-center gap-2">
                        <div className="p-1 bg-gradient-to-br from-green-400 to-teal-500 rounded-full">
                            <Avatar className="w-16 h-16 border-4 border-background shadow-lg">
                                <AvatarImage src={currentPersonData.avatarUrl || `https://api.dicebear.com/8.x/initials/svg?seed=${currentPersonData.name}`} alt={currentPersonData.name} />
                                <AvatarFallback className="text-2xl">{getInitials(currentPersonData.name)}</AvatarFallback>
                            </Avatar>
                        </div>
                        <div className="flex flex-wrap justify-center gap-1">
                            <Badge variant="secondary" className="capitalize">
                                {person.personType || 'unknown'}
                            </Badge>
                            <Badge variant="outline" className="flex items-center gap-1">
                                <Slack className="h-3 w-3" />
                                {person.slackId ? 'Slack linked' : 'No Slack'}
                            </Badge>
                            {(person.mergeState ?? 'active') !== 'active' && (
                                <Badge variant="destructive" className="capitalize">{person.mergeState}</Badge>
                            )}
                        </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 flex-grow">
                        <DetailField 
                            icon={User}
                            label="Name"
                            value={editablePerson.name || ''}
                            placeholder="Full Name"
                            isEditing={isEditing}
                            onChange={(e) => handleInputChange('name', e.target.value)}
                        />
                         <DetailField 
                            icon={Mail}
                            label="Email"
                            value={editablePerson.email || ''}
                            placeholder="Email Address"
                            isEditing={isEditing}
                            onChange={(e) => handleInputChange('email', e.target.value)}
                        />
                        <DetailField
                            icon={Briefcase}
                            label="Title"
                            value={editablePerson.title || ''}
                            placeholder="Job Title or Role"
                            isEditing={isEditing}
                            onChange={(e) => handleInputChange('title', e.target.value)}
                        />
                        <div className="p-4 work-inset">
                            <Label className="flex items-center text-sm font-medium text-muted-foreground mb-1">
                                <Tag className="mr-2 h-4 w-4" />
                                Type
                            </Label>
                            {isEditing ? (
                                <Select
                                    value={editablePerson.personType || 'unknown'}
                                    onValueChange={(value) => handleInputChange('personType', value)}
                                >
                                    <SelectTrigger className="h-8 w-full">
                                        <SelectValue placeholder="Unknown" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="teammate">Teammate</SelectItem>
                                        <SelectItem value="client">Client</SelectItem>
                                        <SelectItem value="unknown">Unknown</SelectItem>
                                    </SelectContent>
                                </Select>
                            ) : (
                                <p className="text-base font-normal text-foreground min-h-[26px] capitalize">
                                    {currentPersonData.personType || 'unknown'}
                                </p>
                            )}
                            {!isEditing && currentPersonData.personTypeReason && (
                                <p className="text-xs text-muted-foreground mt-1">{currentPersonData.personTypeReason}</p>
                            )}
                        </div>
                        <DetailField
                            icon={Building2}
                            label="Company"
                            value={editablePerson.company || ''}
                            placeholder="Company or account"
                            isEditing={isEditing}
                            onChange={(e) => handleInputChange('company', e.target.value)}
                        />
                        <DetailField
                            icon={CalendarClock}
                            label="Next Follow-up"
                            type="date"
                            value={(editablePerson.nextFollowUpAt || '').slice(0, 10)}
                            placeholder="No follow-up scheduled"
                            isEditing={isEditing}
                            onChange={(e) => handleInputChange('nextFollowUpAt', e.target.value || null)}
                        />
                    </div>
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: 0.15 }}
                  className="mt-8"
                  data-testid="relationship-summary"
                >
                  <h2 className="sr-only">Relationship summary</h2>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                    <div className="dense-card">
                      <p className="text-xs text-muted-foreground">Open tasks</p>
                      <p className="text-xl font-semibold">{openTaskCount}</p>
                    </div>
                    <div className="dense-card">
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" /> Overdue
                      </p>
                      <p className={cn("text-xl font-semibold", overdueTaskCount > 0 && "text-destructive")}>
                        {overdueTaskCount}
                      </p>
                    </div>
                    <div className="dense-card">
                      <p className="text-xs text-muted-foreground">Meetings</p>
                      <p className="text-xl font-semibold">{personMeetings.length}</p>
                    </div>
                    <div className="dense-card">
                      <p className="text-xs text-muted-foreground">Last meeting</p>
                      <p className="text-sm font-medium">
                        {lastMeetingAt ? format(lastMeetingAt, 'MMM d, yyyy') : 'None yet'}
                      </p>
                    </div>
                    <div className="dense-card">
                      <p className="text-xs text-muted-foreground">Next follow-up</p>
                      <p className="text-sm font-medium">
                        {person.nextFollowUpAt
                          ? format(new Date(person.nextFollowUpAt), 'MMM d, yyyy')
                          : 'Not scheduled'}
                      </p>
                    </div>
                  </div>
                </motion.div>

                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.2 }} className="mt-8">
                   <Accordion type="single" collapsible defaultValue="aliases" className="w-full">
                      <AccordionItem value="aliases" className="border-none">
                          <div className="rounded-xl bg-card border border-border shadow-lg relative overflow-hidden">
                              <div className="absolute top-0 left-0 h-1 w-full bg-gradient-to-r from-orange-400 via-red-500 to-yellow-400" />
                              <AccordionTrigger className="p-6 hover:no-underline">
                                  <div className="text-left flex-grow">
                                      <CardTitle className="flex items-center gap-3"><Bot className="text-muted-foreground"/> Notes &amp; Aliases</CardTitle>
                                      <CardDescription className="mt-1">Keep free-form notes and improve future AI matching by adding nicknames or IDs from other platforms.</CardDescription>
                                  </div>
                              </AccordionTrigger>
                              <AccordionContent className="px-6 pb-6 pt-0">
                                <div className="p-4 work-inset mb-4">
                                    <Label htmlFor="person-notes" className="flex items-center text-sm font-medium text-muted-foreground mb-1">
                                        <StickyNote className="mr-2 h-4 w-4" />
                                        Notes
                                    </Label>
                                    {isEditing ? (
                                        <Textarea
                                            id="person-notes"
                                            value={editablePerson.notes || ''}
                                            onChange={(e) => handleInputChange('notes', e.target.value || null)}
                                            placeholder="Context, preferences, agreements — anything worth remembering."
                                            className="min-h-[90px]"
                                        />
                                    ) : (
                                        <p className="text-sm text-foreground whitespace-pre-wrap min-h-[26px]">
                                            {currentPersonData.notes || <span className="text-muted-foreground/60 italic">No notes yet.</span>}
                                        </p>
                                    )}
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <DetailField 
                                        icon={Slack}
                                        label="Slack Member ID"
                                        value={editablePerson.slackId || ''}
                                        placeholder="e.g. U02ABC123"
                                        isEditing={isEditing}
                                        onChange={(e) => handleInputChange('slackId', e.target.value)}
                                    />
                                     <DetailField 
                                        icon={Bot}
                                        label="Fireflies.ai Nickname"
                                        value={editablePerson.firefliesId || ''}
                                        placeholder="e.g. 'Stefan'"
                                        isEditing={isEditing}
                                        onChange={(e) => handleInputChange('firefliesId', e.target.value)}
                                    />
                                     <DetailField 
                                        icon={FileText}
                                        label="PhantomBuster ID"
                                        value={editablePerson.phantomBusterId || ''}
                                        placeholder="e.g. 123456789"
                                        isEditing={isEditing}
                                        onChange={(e) => handleInputChange('phantomBusterId', e.target.value)}
                                    />
                                    <DetailField 
                                        icon={MessageSquare}
                                        label="Other Aliases"
                                        value={(editablePerson.aliases || []).join(', ')}
                                        placeholder="e.g. Stef, Steve, The Boss"
                                        isEditing={isEditing}
                                        onChange={handleAliasChange}
                                    />
                                </div>
                              </AccordionContent>
                          </div>
                      </AccordionItem>
                   </Accordion>
                </motion.div>
              
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.3 }} className="mt-8">
                    <Card>
                        <CardHeader>
                          <CardTitle className="flex items-center gap-3">
                            <Briefcase className="text-muted-foreground"/> Assigned Tasks ({tasks.length})
                          </CardTitle>
                          <CardDescription>
                            Tasks assigned to {person.name}, grouped by their source session. Completed meetings are hidden by default.
                          </CardDescription>
                          <div className="mt-4 flex flex-wrap items-center gap-2">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="outline" size="sm">
                                  <Filter className="mr-2 h-4 w-4" />
                                  Filters
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="start" className="w-60">
                                <DropdownMenuLabel>Task filters</DropdownMenuLabel>
                                <DropdownMenuSeparator />
                                <div className="px-2 py-2">
                                  <div className="flex items-center gap-2">
                                    <Checkbox
                                      checked={showCompletedMeetings}
                                      onCheckedChange={(checked) => setShowCompletedMeetings(Boolean(checked))}
                                    />
                                    <span className="text-xs text-muted-foreground">Include completed tasks</span>
                                  </div>
                                </div>
                                <DropdownMenuSeparator />
                                <DropdownMenuLabel className="text-xs">Status</DropdownMenuLabel>
                                <DropdownMenuRadioGroup
                                  value={statusFilter}
                                  onValueChange={(value) =>
                                    setStatusFilter(value as "all" | Task["status"])
                                  }
                                >
                                  <DropdownMenuRadioItem value="all">All</DropdownMenuRadioItem>
                                  <DropdownMenuRadioItem value="todo">To do</DropdownMenuRadioItem>
                                  <DropdownMenuRadioItem value="inprogress">In progress</DropdownMenuRadioItem>
                                  <DropdownMenuRadioItem value="done">Done</DropdownMenuRadioItem>
                                  <DropdownMenuRadioItem value="recurring">Recurring</DropdownMenuRadioItem>
                                </DropdownMenuRadioGroup>
                                <DropdownMenuSeparator />
                                <DropdownMenuLabel className="text-xs">Due date</DropdownMenuLabel>
                                <DropdownMenuRadioGroup
                                  value={dueDateFilter}
                                  onValueChange={(value) =>
                                    setDueDateFilter(value as typeof dueDateFilter)
                                  }
                                >
                                  <DropdownMenuRadioItem value="all">All</DropdownMenuRadioItem>
                                  <DropdownMenuRadioItem value="overdue">Overdue</DropdownMenuRadioItem>
                                  <DropdownMenuRadioItem value="next_7">Due next 7 days</DropdownMenuRadioItem>
                                  <DropdownMenuRadioItem value="no_due">No due date</DropdownMenuRadioItem>
                                </DropdownMenuRadioGroup>
                              </DropdownMenuContent>
                            </DropdownMenu>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={handleSelectAllTasks}
                              disabled={filteredTasks.length === 0}
                            >
                              {allVisibleSelected ? "Clear selection" : "Select all"}
                            </Button>
                            {selectedTasks.length > 0 && (
                              <>
                                <Select
                                  value={bulkStatusValue}
                                  onValueChange={(value) => {
                                    setBulkStatusValue(value);
                                    handleBulkStatusChange(value as Task["status"]);
                                  }}
                                >
                                  <SelectTrigger className="h-8 w-[170px] text-xs">
                                    <SelectValue placeholder="Set status for selected" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="todo">To do</SelectItem>
                                    <SelectItem value="inprogress">In progress</SelectItem>
                                    <SelectItem value="done">Done</SelectItem>
                                    <SelectItem value="recurring">Recurring</SelectItem>
                                  </SelectContent>
                                </Select>
                                <Button
                                  variant="destructive"
                                  size="sm"
                                  onClick={() => setIsBulkDeleteConfirmOpen(true)}
                                >
                                  Delete selected
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={handleGenerateBriefsForSelectedTasks}
                                  disabled={isGeneratingBriefs}
                                >
                                  {isGeneratingBriefs ? "Generating briefs..." : "Generate briefs"}
                                </Button>
                                {isSlackConnected && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => {
                                      setSlackShareTasks(selectedSlackTasks);
                                      setIsSlackShareOpen(true);
                                    }}
                                  >
                                    Send selected to Slack
                                  </Button>
                                )}
                              </>
                            )}
                          </div>
                        </CardHeader>
                        <CardContent>
                          {filteredTasks.length > 0 && visibleGroupedTasks.length > 0 ? (
                            <Accordion type="multiple" defaultValue={visibleGroupedTasks.map(([sessionName]) => sessionName)} className="w-full">
                              {visibleGroupedTasks.map(([sessionName, sessionTasks]) => (
                                <AccordionItem value={sessionName} key={sessionName}>
                                  <AccordionTrigger className="hover:no-underline py-4">
                                      <div className="flex items-center gap-3">
                                        <MessageSquare className="h-5 w-5 text-muted-foreground"/>
                                        <span className="font-semibold text-md">{sessionName}</span>
                                        <Badge variant="secondary">{sessionTasks.length}</Badge>
                                      </div>
                                  </AccordionTrigger>
                                  <AccordionContent className="pl-6 border-l-2 border-primary/20 ml-2">
                                     <div className="space-y-3 py-2">
                                        {sessionTasks.map(task => {
                                          const taskStatus = task.status || "todo";
                                          return (
                                            <div key={task.id} className="p-3 rounded-md border bg-background hover:bg-muted/50 transition-colors">
                                              <div className="flex justify-between items-start gap-4">
                                                  <div
                                                    role="button"
                                                    tabIndex={0}
                                                    className="flex items-start gap-3 flex-1 text-left"
                                                    onClick={() => handleOpenTaskDetails(task)}
                                                    onKeyDown={(event) => {
                                                      if (event.key === "Enter" || event.key === " ") {
                                                        event.preventDefault();
                                                        handleOpenTaskDetails(task);
                                                      }
                                                    }}
                                                  >
                                                    <Checkbox
                                                      className="mt-1"
                                                      checked={selectedTaskIds.has(task.id)}
                                                      onCheckedChange={(checked) =>
                                                        handleToggleTaskSelection(task.id, checked === true)
                                                      }
                                                      onClick={(event) => event.stopPropagation()}
                                                    />
                                                    <div>
                                                      <p className="font-semibold">{task.title}</p>
                                                      {task.description && (
                                                        <p className="text-sm text-muted-foreground mt-1">
                                                          {task.description}
                                                        </p>
                                                      )}
                                                    </div>
                                                  </div>
                                                  <div className="text-right text-sm flex-shrink-0 flex items-center gap-2">
                                                      <div className="flex flex-col items-end gap-1">
                                                        <Select
                                                          value={taskStatus}
                                                          onValueChange={(value) =>
                                                            handleTaskStatusChange(
                                                              task,
                                                              value as Task["status"]
                                                            )
                                                          }
                                                        >
                                                          <SelectTrigger className="h-7 w-[130px] text-xs">
                                                            <SelectValue />
                                                          </SelectTrigger>
                                                          <SelectContent>
                                                            <SelectItem value="todo">To do</SelectItem>
                                                            <SelectItem value="inprogress">In progress</SelectItem>
                                                            <SelectItem value="done">Done</SelectItem>
                                                            <SelectItem value="recurring">Recurring</SelectItem>
                                                          </SelectContent>
                                                        </Select>
                                                        <p className="text-xs text-muted-foreground">
                                                          {task.dueAt
                                                            ? format(new Date(task.dueAt as string), 'MMM d, yyyy')
                                                            : 'No due date'}
                                                        </p>
                                                      </div>
                                                      <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="text-destructive"
                                                        onClick={() => {
                                                          setTaskToDelete(task);
                                                          setIsDeleteTaskConfirmOpen(true);
                                                        }}
                                                      >
                                                        <Trash2 className="h-4 w-4" />
                                                      </Button>
                                                  </div>
                                              </div>
                                            </div>
                                          );
                                        })}
                                    </div>
                                  </AccordionContent>
                                </AccordionItem>
                              ))}
                            </Accordion>
                          ) : (
                             <div className="text-center py-16 text-muted-foreground bg-muted/30 rounded-lg">
                                <Briefcase size={32} className="mx-auto mb-3 opacity-50"/>
                                <p className="font-semibold">No tasks in this view</p>
                                <p className="text-sm">Try a different status filter or assign new tasks.</p>
                             </div>
                          )}
                        </CardContent>
                    </Card>
                </motion.div>

                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.35 }} className="mt-8">
                    <Card>
                        <CardHeader>
                          <CardTitle className="flex items-center gap-3">
                            <CalendarDays className="text-muted-foreground"/> Meeting Timeline
                          </CardTitle>
                          <CardDescription>
                            Recent meetings where {person.name} appeared as an attendee or was identified.
                          </CardDescription>
                        </CardHeader>
                        <CardContent>
                          {personMeetings.length > 0 ? (
                            <div className="space-y-2">
                              {personMeetings.map((meeting: any) => (
                                <Link
                                  key={meeting.id}
                                  href={`/meetings/${meeting.id}`}
                                  className="data-row flex items-center justify-between gap-4 px-4 py-3 hover:bg-muted/50 transition-colors"
                                >
                                  <span className="font-medium text-sm truncate">{meeting.title || 'Untitled meeting'}</span>
                                  <span className="text-xs text-muted-foreground flex-shrink-0">
                                    {meeting.startTime ? format(new Date(meeting.startTime), 'MMM d, yyyy') : 'No date'}
                                  </span>
                                </Link>
                              ))}
                            </div>
                          ) : (
                            <p className="text-sm text-muted-foreground py-4">No meetings recorded with this person yet.</p>
                          )}
                        </CardContent>
                    </Card>
                </motion.div>

                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.4 }} className="mt-8">
                    <Card>
                        <CardHeader>
                          <CardTitle className="flex items-center gap-3">
                            <Quote className="text-muted-foreground"/> Recent Transcript Mentions
                          </CardTitle>
                          <CardDescription>
                            Lines from recent meeting transcripts that mention {person.name} by name or alias.
                          </CardDescription>
                        </CardHeader>
                        <CardContent>
                          {mentions.length > 0 ? (
                            <div className="space-y-3">
                              {mentions.map((mention, index) => (
                                <div key={`${mention.meetingId}-${index}`} className="work-inset p-3">
                                  <p className="text-sm whitespace-pre-wrap">“{mention.snippet}”</p>
                                  <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                                    {mention.timestamp && <Badge variant="outline">{mention.timestamp}</Badge>}
                                    <Link href={`/meetings/${mention.meetingId}`} className="hover:underline">
                                      {mention.meetingTitle}
                                    </Link>
                                    {mention.startTime && (
                                      <span>· {format(new Date(mention.startTime), 'MMM d, yyyy')}</span>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-sm text-muted-foreground py-4">No transcript mentions found in recent meetings.</p>
                          )}
                        </CardContent>
                    </Card>
                </motion.div>

                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.45 }} className="mt-8">
                    <Card>
                        <CardHeader>
                          <CardTitle className="flex items-center gap-3">
                            <GitMerge className="text-muted-foreground"/> Source Identities &amp; Merge State
                          </CardTitle>
                          <CardDescription>
                            Where this profile came from and how duplicate handling treats it.
                          </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                          <div className="flex flex-wrap gap-2 text-sm">
                            <Badge variant="secondary" className="capitalize">
                              Merge state: {person.mergeState ?? 'active'}
                            </Badge>
                            {person.primarySource && (
                              <Badge variant="outline" className="capitalize">
                                Primary source: {person.primarySource.replace('_', ' ')}
                              </Badge>
                            )}
                            {person.mergedIntoPersonId && (
                              <Link href={`/people/${person.mergedIntoPersonId}`}>
                                <Badge variant="destructive">Merged into another profile</Badge>
                              </Link>
                            )}
                          </div>
                          {(person.sourceIdentities || []).length > 0 ? (
                            <div className="space-y-2">
                              {(person.sourceIdentities || []).map((identity, index) => (
                                <div key={`${identity.provider}-${index}`} className="data-row flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-sm">
                                  <Badge variant="outline" className="capitalize">{identity.provider}</Badge>
                                  {identity.name && <span className="font-medium">{identity.name}</span>}
                                  {identity.email && <span className="text-muted-foreground">{identity.email}</span>}
                                  {identity.externalId && (
                                    <span className="text-xs text-muted-foreground">ID: {identity.externalId}</span>
                                  )}
                                  {identity.lastSeenAt && (
                                    <span className="text-xs text-muted-foreground ml-auto">
                                      Seen {format(new Date(identity.lastSeenAt), 'MMM d, yyyy')}
                                    </span>
                                  )}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-sm text-muted-foreground">No recorded source identities yet — this profile predates identity tracking or was created manually.</p>
                          )}
                        </CardContent>
                    </Card>
                </motion.div>
            </div>
        </div>
      <AlertDialog open={isDeleteConfirmOpen} onOpenChange={setIsDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this person?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the person from your directory and unassigns any tasks linked to them. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeletePerson} className="bg-destructive hover:bg-destructive/90 text-destructive-foreground">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {person && (
        <ProfileReportDialog
          isOpen={isReportOpen}
          onClose={() => setIsReportOpen(false)}
          endpoint={`/api/people/${person.id}/report`}
          subjectName={person.name}
        />
      )}
      {isSlackConnected && person && (
        <ShareToSlackDialog
          isOpen={isSlackShareOpen}
          onClose={() => setIsSlackShareOpen(false)}
          tasks={slackShareTasks.length ? slackShareTasks : slackTasks}
          sessionTitle={`Tasks for ${person.name}`}
          defaultDestinationType={person.slackId ? "person" : "channel"}
          defaultUserId={person.slackId || null}
        />
      )}
        <TaskDetailDialog
          isOpen={isTaskDetailDialogOpen}
          onClose={() => {
            setIsTaskDetailDialogOpen(false);
            setTaskForDetailView(null);
            setTaskDetailContext(null);
          }}
          task={taskForDetailView}
          onSave={handleSaveTaskDetails}
          people={currentPersonData ? ([currentPersonData] as any) : []}
          workspaceId={workspaceId}
          boards={boards}
          currentBoardId={taskForDetailView?.addedToBoardId ?? null}
          onMoveToBoard={handleMoveTaskToBoard}
          getBriefContext={getBriefContext}
          shareTitle={currentPersonData.name || "Person"}
          supportsSubtasks
        />
      <AlertDialog open={isDeleteTaskConfirmOpen} onOpenChange={setIsDeleteTaskConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this task?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the task from its source and your task list. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setTaskToDelete(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteTask} className="bg-destructive hover:bg-destructive/90 text-destructive-foreground">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={isBulkDeleteConfirmOpen} onOpenChange={setIsBulkDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete selected tasks?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the selected tasks from their sources and your task list. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleBulkDeleteTasks}
              className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}


