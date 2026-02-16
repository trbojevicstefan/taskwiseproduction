// src/components/dashboard/planning/TaskDetailDialog.tsx
"use client";

import React, { useState, useEffect, useMemo } from 'react';
import type { ExtractedTaskSchema as DisplayTask } from '@/types/chat';
import type { Task } from '@/types/project';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { CalendarIcon, Sparkles, Loader2, Slack, Copy, ListChecks } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';
import { useToast } from "@/hooks/use-toast";
import { motion } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import { useIntegrations } from "@/contexts/IntegrationsContext";
import { copyTextToClipboard, formatTasksToText } from "@/lib/exportUtils";
import { apiFetch } from "@/lib/api";
import { normalizeTask } from "@/lib/data";
import ShareToSlackDialog from "@/components/dashboard/common/ShareToSlackDialog";
import PushToGoogleTasksDialog from "@/components/dashboard/common/PushToGoogleTasksDialog";
import PushToTrelloDialog from "@/components/dashboard/common/PushToTrelloDialog";
import type { Person } from "@/types/person";
import { SiTrello } from "@icons-pack/react-simple-icons";
import { getTaskBoardMembership } from "@/lib/board-actions";
import type { BriefContext } from "@/lib/brief-context";
import {
  fetchBriefQuota,
  generateTaskBrief,
  generateTaskAssistanceText,
  type BriefQuota,
} from "@/lib/task-insights-client";

type BoardOption = { id: string; name: string };

interface TaskDetailDialogProps {
  isOpen: boolean;
  onClose: () => void;
  task: DisplayTask | null;
  onSave: (updatedTask: DisplayTask, options?: { close?: boolean }) => void;
  people?: Person[];
  workspaceId?: string | null;
  boards?: BoardOption[];
  currentBoardId?: string | null;
  onMoveToBoard?: (boardId: string) => Promise<void> | void;
  shareTitle?: string;
  supportsSubtasks?: boolean;
  getBriefContext?: (task: DisplayTask) => BriefContext | Promise<BriefContext>;
}

export default function TaskDetailDialog({
  isOpen,
  onClose,
  task,
  onSave,
  people = [],
  workspaceId,
  boards = [],
  currentBoardId = null,
  onMoveToBoard,
  shareTitle,
  supportsSubtasks,
  getBriefContext,
}: TaskDetailDialogProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<DisplayTask['priority']>('medium');
  const [status, setStatus] = useState<DisplayTask['status']>('todo');
  const [dueAt, setDueAt] = useState<Date | undefined>(undefined);
  const [researchBrief, setResearchBrief] = useState<string | null>(null);
  const [aiAssistanceText, setAiAssistanceText] = useState<string | null>(null);
  const [comments, setComments] = useState<DisplayTask['comments']>([]);
  const [subtasks, setSubtasks] = useState<DisplayTask["subtasks"]>([]);
  const [newComment, setNewComment] = useState('');
  const [newSubtaskTitle, setNewSubtaskTitle] = useState("");
  const [isAddingSubtask, setIsAddingSubtask] = useState(false);
  const [isGeneratingBrief, setIsGeneratingBrief] = useState(false);
  const [isGeneratingAssistance, setIsGeneratingAssistance] = useState(false);
  const [isShareToSlackOpen, setIsShareToSlackOpen] = useState(false);
  const [isPushToGoogleOpen, setIsPushToGoogleOpen] = useState(false);
  const [isPushToTrelloOpen, setIsPushToTrelloOpen] = useState(false);
  const [assigneeSelection, setAssigneeSelection] = useState<string | null>(null);
  const [selectedBoardId, setSelectedBoardId] = useState<string>("");
  const [resolvedBoardId, setResolvedBoardId] = useState<string | null>(null);
  const [isResolvingBoard, setIsResolvingBoard] = useState(false);
  const [isMovingBoard, setIsMovingBoard] = useState(false);
  const [isEditingBrief, setIsEditingBrief] = useState(false);
  const [isEditingAssistance, setIsEditingAssistance] = useState(false);
  const [isBriefExpanded, setIsBriefExpanded] = useState(false);
  const [briefQuota, setBriefQuota] = useState<BriefQuota | null>(null);
  const [isLoadingBriefQuota, setIsLoadingBriefQuota] = useState(false);
  const { toast } = useToast();
  const { user } = useAuth();
  const { isSlackConnected, isGoogleTasksConnected, isTrelloConnected } = useIntegrations();
  const UNASSIGNED_VALUE = "__unassigned__";
  const isLinkedSubtaskMode = supportsSubtasks === true && task?.subtasks === undefined;
  
  useEffect(() => {
    if (task) {
      setTitle(task.title);
      setDescription(task.description || '');
      setPriority(task.priority || 'medium');
      setStatus(task.status || 'todo');
      setDueAt(task.dueAt ? (typeof task.dueAt === 'string' ? parseISO(task.dueAt) : new Date(task.dueAt)) : undefined);
      setResearchBrief(task.researchBrief || null);
      setAiAssistanceText(task.aiAssistanceText || null);
      setComments(task.comments || []);
      setSubtasks(task.subtasks || []);
      setNewComment('');
      setNewSubtaskTitle("");
      setIsEditingBrief(false);
      setIsEditingAssistance(false);
      setIsBriefExpanded(false);
    } else {
      // Reset state when there's no task (e.g., dialog closes)
      setTitle('');
      setDescription('');
      setPriority('medium');
      setStatus('todo');
      setDueAt(undefined);
      setResearchBrief(null);
      setAiAssistanceText(null);
      setComments([]);
      setSubtasks([]);
      setNewComment('');
      setNewSubtaskTitle("");
      setAssigneeSelection(null);
      setIsEditingBrief(false);
      setIsEditingAssistance(false);
      setIsBriefExpanded(false);
    }
  }, [task, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    let isActive = true;
    setIsLoadingBriefQuota(true);
    fetchBriefQuota()
      .then((quota) => {
        if (!isActive) return;
        setBriefQuota(quota);
      })
      .catch((error) => {
        if (!isActive) return;
        console.error("Failed to fetch brief quota:", error);
      })
      .finally(() => {
        if (isActive) {
          setIsLoadingBriefQuota(false);
        }
      });
    return () => {
      isActive = false;
    };
  }, [isOpen, task?.id]);

  useEffect(() => {
    if (!task) {
      setAssigneeSelection(null);
      return;
    }
    const rawAssignee = task.assignee || null;
    const rawId = rawAssignee?.uid || rawAssignee?.id || null;
    const rawEmail = rawAssignee?.email?.toLowerCase?.() || null;
    const rawName = task.assigneeName || rawAssignee?.name || null;
    const byId = rawId
      ? people.find((person: any) => person.id === rawId) || null
      : null;
    const byEmail = rawEmail
      ? people.find((person: any) => {
          const email = person.email?.toLowerCase?.();
          if (email && email === rawEmail) return true;
          return (person.aliases || []).some(
            (alias: any) => alias?.toLowerCase?.() === rawEmail
          );
        }) || null
      : null;
    const byName = rawName
      ? people.find(
          (person) => person.name?.toLowerCase?.() === rawName.toLowerCase()
        ) || null
      : null;
    const resolved = byId || byEmail || byName;
    setAssigneeSelection(resolved ? resolved.id : null);
  }, [people, task]);

  const fetchLinkedSubtasks = async (
    parentId: string,
    visited: Set<string>
  ): Promise<DisplayTask[]> => {
    if (visited.has(parentId)) return [];
    visited.add(parentId);
    const children = await apiFetch<Task[]>(
      `/api/tasks?parentId=${encodeURIComponent(parentId)}`
    );
    if (!children.length) return [];
    const nested = await Promise.all(
      children.map(async (child) => {
        const childSubtasks = await fetchLinkedSubtasks(child.id, visited);
        const normalized = normalizeTask(child) as DisplayTask;
        return {
          ...normalized,
          subtasks: childSubtasks.length ? childSubtasks : null,
        };
      })
    );
    return nested;
  };

  useEffect(() => {
    if (!isOpen || !isLinkedSubtaskMode || !task?.id) return;
    let isActive = true;
    const load = async () => {
      try {
        const nextSubtasks = await fetchLinkedSubtasks(task.id, new Set<string>());
        if (isActive) {
          setSubtasks(nextSubtasks);
        }
      } catch (error) {
        if (isActive) {
          setSubtasks([]);
        }
        console.error("Failed to load subtasks:", error);
        toast({
          title: "Subtasks unavailable",
          description: "We couldn't load subtasks for this task.",
          variant: "destructive",
        });
      }
    };
    void load();
    return () => {
      isActive = false;
    };
  }, [isLinkedSubtaskMode, isOpen, task?.id, toast]);


  useEffect(() => {
    if (!isOpen) return;
    const baseBoardId = currentBoardId || task?.addedToBoardId || "";
    setSelectedBoardId(baseBoardId);
    setResolvedBoardId(baseBoardId || null);
  }, [currentBoardId, isOpen, task?.addedToBoardId]);

  useEffect(() => {
    if (!isOpen || !workspaceId || !task?.id) return;
    if (currentBoardId || task?.addedToBoardId) return;
    if (!boards.length) return;

    let isActive = true;
    setIsResolvingBoard(true);

    getTaskBoardMembership(workspaceId, task.id)
      .then((result) => {
        if (!isActive) return;
        const boardId = result?.boardId || "";
        setSelectedBoardId(boardId);
        setResolvedBoardId(boardId || null);
      })
      .catch((error) => {
        if (!isActive) return;
        console.error("Failed to resolve task board:", error);
      })
      .finally(() => {
        if (isActive) {
          setIsResolvingBoard(false);
        }
      });

    return () => {
      isActive = false;
    };
  }, [boards.length, currentBoardId, isOpen, task?.addedToBoardId, task?.id, workspaceId]);

  const buildUpdatedTask = (overrides: Partial<DisplayTask> = {}): DisplayTask => {
    const selectedPerson =
      assigneeSelection && assigneeSelection !== UNASSIGNED_VALUE
        ? people.find((person: any) => person.id === assigneeSelection) || null
        : null;
    const baseAssignee = task?.assignee ?? null;
    const nextAssignee =
      assigneeSelection === UNASSIGNED_VALUE
        ? null
        : selectedPerson
          ? {
              uid: selectedPerson.id,
              name: selectedPerson.name,
              email: selectedPerson.email ?? null,
              photoURL: selectedPerson.avatarUrl ?? null,
              slackId: selectedPerson.slackId ?? null,
            }
          : baseAssignee;
    const nextAssigneeName =
      assigneeSelection === UNASSIGNED_VALUE
        ? null
        : selectedPerson?.name || task?.assigneeName || baseAssignee?.name || null;
    return {
      ...(task as DisplayTask),
      title,
      description,
      priority,
      status,
      dueAt: dueAt ? dueAt.toISOString() : null,
      researchBrief,
      aiAssistanceText,
      comments,
      subtasks,
      assignee: nextAssignee,
      assigneeName: nextAssigneeName,
      ...overrides,
    };
  };

  const persistTaskUpdate = async (
    overrides: Partial<DisplayTask>,
    options?: { close?: boolean }
  ) => {
    await Promise.resolve(onSave(buildUpdatedTask(overrides), options));
  };

  const handleGenerateBrief = async () => {
    if (!task) return;
    if (isBriefLimitReached) {
      toast({
        title: "Brief limit reached",
        description: "You have used all 10 AI Brief generations for this month.",
        variant: "destructive",
      });
      return;
    }
    setIsGeneratingBrief(true);
    toast({ title: "Generating Research Brief...", description: "Please wait a moment." });
    try {
      const briefContext = getBriefContext
        ? await Promise.resolve(getBriefContext(buildUpdatedTask()))
        : null;
      const result = await generateTaskBrief({
        taskTitle: title,
        taskDescription: description,
        assigneeName: assigneeNameForBrief,
        taskPriority: priority,
        primaryTranscript: briefContext?.primaryTranscript || undefined,
        relatedTranscripts: briefContext?.relatedTranscripts || undefined,
      });
      setResearchBrief(result.researchBrief);
      setBriefQuota(result.briefQuota);
      setIsEditingBrief(false);
      try {
        await persistTaskUpdate({ researchBrief: result.researchBrief }, { close: false });
        toast({
          title: "Brief Generated!",
          description: result.briefQuota
            ? `${result.briefQuota.remaining} brief${result.briefQuota.remaining === 1 ? "" : "s"} left this month.`
            : "AI Research Brief is now available.",
        });
      } catch (saveError) {
        console.error("Failed to save research brief:", saveError);
        toast({
          title: "Brief Generated, Not Saved",
          description: "We couldn't save the brief. Try again in a moment.",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Error generating research brief:", error);
      const message =
        error instanceof Error ? error.message : "Could not generate research brief.";
      toast({ title: "AI Error", description: message, variant: "destructive" });
    } finally {
      setIsGeneratingBrief(false);
    }
  };
  
  const handleGenerateAssistance = async () => {
    if (!task) return;
    setIsGeneratingAssistance(true);
    toast({ title: "Generating AI Assistance...", description: "Please wait a moment." });
    try {
      const result = await generateTaskAssistanceText({
        taskTitle: title,
        taskDescription: description,
      });
      setAiAssistanceText(result.assistanceMarkdown);
      setIsEditingAssistance(false);
      try {
        await persistTaskUpdate(
          { aiAssistanceText: result.assistanceMarkdown },
          { close: false }
        );
        toast({
          title: "AI Assistance Ready!",
          description: "Suggestions are available in the 'AI Assistance' section.",
        });
      } catch (saveError) {
        console.error("Failed to save AI assistance:", saveError);
        toast({
          title: "Assistance Generated, Not Saved",
          description: "We couldn't save the assistance. Try again in a moment.",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Error generating task assistance:", error);
      const message =
        error instanceof Error ? error.message : "Could not get task assistance.";
      toast({ title: "AI Error", description: message, variant: "destructive" });
    } finally {
      setIsGeneratingAssistance(false);
    }
  };

  const handleSaveChanges = () => {
    if (!task) return;
    onSave(buildUpdatedTask());
  };

  const handleAddComment = () => {
    if (!newComment.trim()) return;
    const nextComment = {
      id: globalThis.crypto?.randomUUID?.() || `comment_${Date.now()}`,
      text: newComment.trim(),
      createdAt: Date.now(),
      authorName: user?.displayName || user?.name || "You",
      authorId: user?.uid || null,
    };
    const nextComments = [...(comments || []), nextComment];
    setComments(nextComments);
    setNewComment('');
    onSave(buildUpdatedTask({ comments: nextComments }), { close: false });
  };

  const handleAddSubtask = async () => {
    if (!newSubtaskTitle.trim()) return;
    if (isLinkedSubtaskMode) {
      if (!task || isAddingSubtask) return;
      setIsAddingSubtask(true);
      try {
        const parentMeta = task as DisplayTask & {
          projectId?: string | null;
          workspaceId?: string | null;
          sourceSessionType?: string | null;
          taskState?: string | null;
          origin?: string | null;
        };
        const created = await apiFetch<Task>("/api/tasks", {
          method: "POST",
          body: JSON.stringify({
            title: newSubtaskTitle.trim(),
            description: "",
            status: status || "todo",
            priority: priority || "medium",
            dueAt: null,
            parentId: task.id,
            workspaceId: workspaceId ?? parentMeta.workspaceId ?? null,
            projectId: parentMeta.projectId ?? null,
            sourceSessionId: task.sourceSessionId ?? null,
            sourceSessionName: task.sourceSessionName ?? null,
            sourceSessionType:
              parentMeta.sourceSessionType ?? parentMeta.origin ?? "task",
            taskState: parentMeta.taskState ?? "active",
          }),
        });
        const normalized = normalizeTask(created) as DisplayTask;
        const nextSubtasks = [...(subtasks || []), normalized];
        setSubtasks(nextSubtasks);
        setNewSubtaskTitle("");
        await apiFetch(`/api/tasks/${task.id}`, {
          method: "PATCH",
          body: JSON.stringify({ subtaskCount: nextSubtasks.length }),
        });
        onSave(buildUpdatedTask({ subtasks: nextSubtasks }), { close: false });
      } catch (error) {
        console.error("Failed to add subtask:", error);
        toast({
          title: "Subtask not saved",
          description: "We couldn't add the subtask. Try again in a moment.",
          variant: "destructive",
        });
      } finally {
        setIsAddingSubtask(false);
      }
      return;
    }
    const nextSubtask: DisplayTask = {
      id: globalThis.crypto?.randomUUID?.() || `subtask_${Date.now()}`,
      title: newSubtaskTitle.trim(),
      description: "",
      priority: priority || "medium",
      status: status || "todo",
      dueAt: null,
      assignee: null,
      assigneeName: null,
      subtasks: null,
      comments: [],
    };
    const nextSubtasks = [...(subtasks || []), nextSubtask];
    setSubtasks(nextSubtasks);
    setNewSubtaskTitle("");
    onSave(buildUpdatedTask({ subtasks: nextSubtasks }), { close: false });
  };

  const handleBoardChange = async (value: string) => {
    if (!value) return;
    setSelectedBoardId(value);
    if (!onMoveToBoard || value === resolvedBoardId) return;
    setIsMovingBoard(true);
    try {
      await onMoveToBoard(value);
      setResolvedBoardId(value);
      const boardName = boards.find((board: any) => board.id === value)?.name;
      toast({
        title: "Moved to board",
        description: boardName ? `Now on ${boardName}.` : "Task moved.",
      });
    } catch (error) {
      console.error("Failed to move task to board:", error);
      setSelectedBoardId(resolvedBoardId || "");
      toast({
        title: "Move failed",
        description: error instanceof Error ? error.message : "Try again in a moment.",
        variant: "destructive",
      });
    } finally {
      setIsMovingBoard(false);
    }
  };

  const handleCopyTask = async () => {
    if (!task) return;
    const text = formatTasksToText([buildUpdatedTask()]);
    const { success } = await copyTextToClipboard(text);
    toast({
      title: success ? "Copied to clipboard" : "Copy failed",
      variant: success ? "default" : "destructive",
    });
  };

  const assigneeMeta = useMemo(() => {
    const selectionId =
      assigneeSelection && assigneeSelection !== UNASSIGNED_VALUE
        ? assigneeSelection
        : null;
    const selectedPerson = selectionId
      ? people.find((person: any) => person.id === selectionId) || null
      : null;
    const rawAssignee = task?.assignee || null;
    const rawName =
      task?.assigneeName ||
      rawAssignee?.name ||
      rawAssignee?.displayName ||
      rawAssignee?.email ||
      null;
    const rawId = rawAssignee?.uid || rawAssignee?.id || null;
    const rawEmail = rawAssignee?.email?.toLowerCase?.() || null;
    const byId = rawId ? people.find((person: any) => person.id === rawId) : null;
    const byEmail = rawEmail
      ? people.find((person: any) => {
          const email = person.email?.toLowerCase?.();
          if (email && email === rawEmail) return true;
          return (person.aliases || []).some(
            (alias: any) => alias?.toLowerCase?.() === rawEmail
          );
        })
      : null;
    const byName = rawAssignee?.name
      ? people.find(
          (person) =>
            person.name?.toLowerCase?.() === rawAssignee.name?.toLowerCase?.()
        )
      : null;
    const matchedPerson = selectedPerson || byId || byEmail || byName || null;
    if (assigneeSelection === UNASSIGNED_VALUE) {
      return { label: "Unassigned", avatarUrl: null, slackId: null };
    }
    const avatarUrl =
      (matchedPerson?.slackId && matchedPerson.avatarUrl
        ? matchedPerson.avatarUrl
        : null) ||
      rawAssignee?.photoURL ||
      matchedPerson?.avatarUrl ||
      null;
    const label = matchedPerson?.name || rawName || "Unassigned";
    return {
      label,
      avatarUrl,
      slackId: matchedPerson?.slackId || rawAssignee?.slackId || null,
    };
  }, [assigneeSelection, people, task]);

  const selectedPerson = useMemo(() => {
    if (assigneeSelection && assigneeSelection !== UNASSIGNED_VALUE) {
      return people.find((person: any) => person.id === assigneeSelection) || null;
    }
    return null;
  }, [assigneeSelection, people, UNASSIGNED_VALUE]);

  const shareContextTitle = shareTitle || task?.title || "Task";
  const canEditSubtasks = supportsSubtasks ?? task?.subtasks !== undefined;
  const hasBoards = boards.length > 0;
  const boardPlaceholder = isResolvingBoard
    ? "Resolving board..."
    : hasBoards
    ? "Select board"
    : "No boards available";
  const assigneeNameForBrief =
    assigneeMeta.label && assigneeMeta.label !== "Unassigned"
      ? assigneeMeta.label
      : undefined;
  const isBriefLimitReached = (briefQuota?.remaining ?? 1) <= 0;
  const briefCounterLabel = briefQuota
    ? `${briefQuota.remaining}/${briefQuota.limit} left`
    : null;

  const priorityTone = {
    high: "border-rose-500/60 bg-rose-500/10",
    medium: "border-amber-500/60 bg-amber-500/10",
    low: "border-emerald-500/60 bg-emerald-500/10",
  } as const;
  const briefLineCount = researchBrief ? researchBrief.split(/\r?\n/).length : 0;
  const shouldCollapseBrief =
    !!researchBrief && (briefLineCount > 6 || researchBrief.length > 1200);
  const isBriefCollapsed =
    shouldCollapseBrief && !isBriefExpanded && !isEditingBrief;

  const renderInlineMarkdown = (text: string) => {
    const parts: React.ReactNode[] = [];
    const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parts.push(text.slice(lastIndex, match.index));
      }
      const token = match[0];
      if (token.startsWith("**")) {
        parts.push(
          <strong key={`${match.index}-b`}>
            {token.slice(2, -2)}
          </strong>
        );
      } else if (token.startsWith("`")) {
        parts.push(
          <code
            key={`${match.index}-c`}
            className="rounded bg-muted px-1 py-0.5 text-[0.85em]"
          >
            {token.slice(1, -1)}
          </code>
        );
      } else if (token.startsWith("*")) {
        parts.push(<em key={`${match.index}-i`}>{token.slice(1, -1)}</em>);
      }
      lastIndex = match.index + token.length;
    }

    if (lastIndex < text.length) {
      parts.push(text.slice(lastIndex));
    }
    return parts;
  };

  const renderMarkdownBlocks = (markdown: string) => {
    const lines = markdown.split(/\r?\n/);
    const blocks: React.ReactNode[] = [];
    let listItems: React.ReactNode[] = [];

    const flushList = () => {
      if (!listItems.length) return;
      blocks.push(
        <ul key={`list-${blocks.length}`} className="ml-4 list-disc space-y-1">
          {listItems.map((item, index) => (
            <li key={`li-${index}`} className="text-sm text-foreground/90">
              {item}
            </li>
          ))}
        </ul>
      );
      listItems = [];
    };

    lines.forEach((line: any) => {
      const trimmed = line.trim();
      if (!trimmed) {
        flushList();
        return;
      }
      const headingMatch = trimmed.match(/^(#{1,3})\s+(.*)$/);
      if (headingMatch) {
        flushList();
        const level = headingMatch[1].length;
        const text = headingMatch[2];
        const HeadingTag = level === 1 ? "h3" : level === 2 ? "h4" : "h5";
        blocks.push(
          <HeadingTag
            key={`h-${blocks.length}`}
            className="text-sm font-semibold text-foreground"
          >
            {renderInlineMarkdown(text)}
          </HeadingTag>
        );
        return;
      }
      const listMatch = trimmed.match(/^[-*]\s+(.*)$/) || trimmed.match(/^\d+\.\s+(.*)$/);
      if (listMatch) {
        listItems.push(renderInlineMarkdown(listMatch[1]));
        return;
      }
      flushList();
      blocks.push(
        <p key={`p-${blocks.length}`} className="text-sm text-foreground/90">
          {renderInlineMarkdown(trimmed)}
        </p>
      );
    });

    flushList();
    return blocks;
  };

  const getInitials = (value?: string | null) => {
    if (!value) return "U";
    const parts = value.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return value.slice(0, 2).toUpperCase();
    return parts.slice(0, 2).map((part: any) => part[0]).join("").toUpperCase();
  };

  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-5xl h-[92vh] p-0 overflow-hidden">
        <div className="relative h-full">
          <div className="flex h-full min-h-0 flex-col">
            <DialogHeader className="px-6 py-4 border-b bg-gradient-to-r from-background via-muted/30 to-background backdrop-blur">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <DialogTitle>Task Details</DialogTitle>
                  <DialogDescription>
                    View, edit, and enhance your task with AI-powered tools.
                  </DialogDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleGenerateBrief}
                    disabled={isGeneratingBrief || isLoadingBriefQuota || isBriefLimitReached}
                  >
                    {isGeneratingBrief ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin text-amber-500" />
                    ) : (
                      <Sparkles className="mr-2 h-4 w-4 text-amber-500" />
                    )}
                    {researchBrief ? "Regenerate Brief" : "Generate Brief"}
                    {isLoadingBriefQuota || briefCounterLabel ? (
                      <span className="ml-1 text-xs text-muted-foreground">
                        {isLoadingBriefQuota ? "(...)" : `(${briefCounterLabel})`}
                      </span>
                    ) : null}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleGenerateAssistance}
                    disabled={isGeneratingAssistance}
                  >
                    {isGeneratingAssistance ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin text-orange-500" />
                    ) : (
                      <Sparkles className="mr-2 h-4 w-4 text-orange-500" />
                    )}
                    {aiAssistanceText ? "Regenerate Assist" : "Get Assistance"}
                  </Button>
                </div>
              </div>
            </DialogHeader>
            <div className="grid flex-1 min-h-0 grid-cols-1 lg:grid-cols-[1.6fr_1fr]">
              <div className="min-h-0 overflow-y-auto bg-gradient-to-br from-background via-background to-muted/10">
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5 }}
                    className="space-y-6 p-6"
                  >
                    <div className="space-y-2">
                      <Label htmlFor="title">Title</Label>
                      <Input
                        id="title"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        className="text-lg font-semibold"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="description">Description</Label>
                      <Textarea
                        id="description"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        className="min-h-[120px]"
                        placeholder="Add a more detailed description..."
                      />
                    </div>

                    {researchBrief ? (
                      <div
                        className={cn(
                          "rounded-xl border-l-4 border border-border/60 p-4 shadow-sm",
                          priorityTone[priority]
                        )}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2 text-sm font-semibold">
                            <Sparkles className="h-4 w-4 text-amber-500" />
                            AI Research Brief
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setIsEditingBrief((prev) => !prev)}
                          >
                            {isEditingBrief ? "Done" : "Edit"}
                          </Button>
                        </div>
                        {isEditingBrief ? (
                          <Textarea
                            id="ai-research-brief"
                            value={researchBrief}
                            onChange={(e) => setResearchBrief(e.target.value)}
                            className="mt-3 min-h-[160px] bg-background/70"
                          />
                        ) : (
                          <div className="mt-3 space-y-2 leading-relaxed">
                            <div className={cn(isBriefCollapsed && "max-h-[240px] overflow-hidden")}>
                              {renderMarkdownBlocks(researchBrief)}
                            </div>
                            {shouldCollapseBrief ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => setIsBriefExpanded((prev) => !prev)}
                                className="px-0 text-xs text-muted-foreground hover:text-foreground"
                              >
                                {isBriefExpanded ? "Show less" : "Show more"}
                              </Button>
                            ) : null}
                          </div>
                        )}
                      </div>
                    ) : null}

                    {aiAssistanceText ? (
                      <div
                        className={cn(
                          "rounded-xl border-l-4 border border-border/60 p-4 shadow-sm",
                          priorityTone[priority]
                        )}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2 text-sm font-semibold">
                            <Sparkles className="h-4 w-4 text-orange-500" />
                            AI Assistance
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setIsEditingAssistance((prev) => !prev)}
                          >
                            {isEditingAssistance ? "Done" : "Edit"}
                          </Button>
                        </div>
                        {isEditingAssistance ? (
                          <Textarea
                            id="ai-assistance"
                            value={aiAssistanceText}
                            onChange={(e) => setAiAssistanceText(e.target.value)}
                            className="mt-3 min-h-[160px] bg-background/70"
                          />
                        ) : (
                          <div className="mt-3 space-y-2 leading-relaxed">
                            {renderMarkdownBlocks(aiAssistanceText)}
                          </div>
                        )}
                      </div>
                    ) : null}

                    {canEditSubtasks && (
                      <div className="space-y-3">
                        <Label>Subtasks</Label>
                        <div className="space-y-2">
                          {(subtasks || []).length === 0 && (
                            <p className="text-xs text-muted-foreground">
                              No subtasks yet.
                            </p>
                          )}
                          {(subtasks || []).map((subtask: any) => (
                            <div
                              key={subtask.id}
                              className="rounded-md border bg-muted/30 px-3 py-2 text-xs"
                            >
                              <p className="font-semibold text-foreground">
                                {subtask.title}
                              </p>
                              {subtask.description ? (
                                <p className="mt-1 text-muted-foreground">
                                  {subtask.description}
                                </p>
                              ) : null}
                            </div>
                          ))}
                        </div>
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <Input
                            placeholder="Add a new subtask..."
                            value={newSubtaskTitle}
                            onChange={(event) => setNewSubtaskTitle(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                handleAddSubtask();
                              }
                            }}
                          />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handleAddSubtask}
                        disabled={!newSubtaskTitle.trim() || isAddingSubtask}
                      >
                        Add subtask
                      </Button>
                        </div>
                      </div>
                    )}

                    <div className="space-y-3">
                      <Label>Comments</Label>
                      <div className="space-y-3">
                        {(comments || []).length === 0 && (
                          <p className="text-xs text-muted-foreground">No comments yet.</p>
                        )}
                        {(comments || []).map((comment: any) => (
                          <div key={comment.id} className="rounded-md border bg-muted/30 p-3 text-xs">
                            <div className="flex items-center justify-between text-muted-foreground">
                              <span className="font-semibold text-foreground">
                                {comment.authorName || "Contributor"}
                              </span>
                              <span>{format(new Date(comment.createdAt), "MMM d, h:mm a")}</span>
                            </div>
                            <p className="mt-2 text-foreground whitespace-pre-wrap">{comment.text}</p>
                          </div>
                        ))}
                      </div>
                      <div className="flex flex-col gap-2">
                        <Textarea
                          value={newComment}
                          onChange={(e) => setNewComment(e.target.value)}
                          placeholder="Add a comment..."
                          className="min-h-[80px]"
                        />
                        <div className="flex justify-end">
                          <Button type="button" size="sm" onClick={handleAddComment} disabled={!newComment.trim()}>
                            Add Comment
                          </Button>
                        </div>
                      </div>
                    </div>

                    {task?.sourceEvidence && task.sourceEvidence.length > 0 && (
                      <div className="space-y-2">
                        <Label>Source Evidence</Label>
                        <div className="space-y-2">
                          {task.sourceEvidence.map((evidence, index) => (
                            <div key={`${task.id}-evidence-${index}`} className="rounded-md border bg-muted/30 p-3 text-xs">
                              <p className="font-semibold">
                                {evidence.speaker || "Speaker"}
                                {evidence.timestamp ? ` - ${evidence.timestamp}` : ""}
                              </p>
                              <p className="text-muted-foreground mt-1">{evidence.snippet}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </motion.div>
              </div>

              <motion.div
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.5 }}
                className="min-h-0 border-t lg:border-l lg:border-t-0 bg-gradient-to-b from-muted/30 via-muted/10 to-background flex flex-col"
              >
                <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-4">
                  <div className="rounded-xl border bg-background/80 p-4 space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="status">Status</Label>
                      <Select value={status || "todo"} onValueChange={(value: string) => setStatus(value as DisplayTask["status"])}>
                        <SelectTrigger><SelectValue placeholder="Select status" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="todo">To do</SelectItem>
                          <SelectItem value="inprogress">In progress</SelectItem>
                          <SelectItem value="done">Done</SelectItem>
                          <SelectItem value="recurring">Recurring</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="priority">Priority</Label>
                      <Select value={priority} onValueChange={(value: string) => setPriority(value as DisplayTask["priority"])}>
                        <SelectTrigger><SelectValue placeholder="Select priority" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="low">Low</SelectItem>
                          <SelectItem value="medium">Medium</SelectItem>
                          <SelectItem value="high">High</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="dueAt">Due Date</Label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant={"outline"} className={cn("w-full justify-start text-left font-normal", !dueAt && "text-muted-foreground")}>
                            <CalendarIcon className="mr-2 h-4 w-4" />
                            {dueAt ? format(dueAt, "PPP") : <span>Pick a date</span>}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0">
                          <Calendar mode="single" selected={dueAt} onSelect={setDueAt} initialFocus />
                        </PopoverContent>
                      </Popover>
                    </div>
                    <div className="space-y-2">
                      <Label>Assigned to</Label>
                      <Select
                        value={assigneeSelection || ""}
                        onValueChange={(value) =>
                          setAssigneeSelection(value === "" ? null : value)
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder={assigneeMeta.label} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={UNASSIGNED_VALUE}>Unassigned</SelectItem>
                          {people.map((person: any) => (
                            <SelectItem key={person.id} value={person.id}>
                              {person.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <div className="flex items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2">
                        <Avatar className="h-8 w-8">
                          <AvatarImage src={assigneeMeta.avatarUrl || undefined} />
                          <AvatarFallback>{getInitials(assigneeMeta.label)}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold truncate">{assigneeMeta.label}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            {selectedPerson?.email ||
                              task?.assignee?.email ||
                              "No email"}
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Board</Label>
                      <Select
                        value={selectedBoardId}
                        onValueChange={handleBoardChange}
                        disabled={
                          isMovingBoard ||
                          isResolvingBoard ||
                          !onMoveToBoard ||
                          !hasBoards
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder={boardPlaceholder} />
                        </SelectTrigger>
                        <SelectContent>
                          {hasBoards ? (
                            boards.map((board: any) => (
                              <SelectItem key={board.id} value={board.id}>
                                {board.name}
                              </SelectItem>
                            ))
                          ) : (
                            <SelectItem value="__no_boards__" disabled>
                              No boards available
                            </SelectItem>
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="rounded-xl border bg-background/80 p-4 space-y-3">
                    <Label>Send options</Label>
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setIsShareToSlackOpen(true)}
                        disabled={!isSlackConnected}
                      >
                        <Slack className="mr-2 h-4 w-4" /> Slack
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setIsPushToTrelloOpen(true)}
                        disabled={!isTrelloConnected}
                      >
                        <SiTrello className="mr-2 h-4 w-4" color="#0079BF" /> Trello
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setIsPushToGoogleOpen(true)}
                        disabled={!isGoogleTasksConnected}
                      >
                        <ListChecks className="mr-2 h-4 w-4" /> Tasks
                      </Button>
                      <Button variant="outline" size="sm" onClick={handleCopyTask}>
                        <Copy className="mr-2 h-4 w-4" /> Copy
                      </Button>
                    </div>
                  </div>
                </div>
              </motion.div>
            </div>
            <DialogFooter className="border-t border-border/80 bg-background/90 px-6 py-4 backdrop-blur-sm sm:justify-between">
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              </DialogClose>
              <Button type="button" onClick={handleSaveChanges}>
                Save changes
              </Button>
            </DialogFooter>
          </div>
        </div>
      </DialogContent>

      <ShareToSlackDialog
        isOpen={isShareToSlackOpen}
        onClose={() => setIsShareToSlackOpen(false)}
        tasks={task ? [buildUpdatedTask()] : []}
        sessionTitle={shareContextTitle}
        defaultDestinationType="person"
        defaultUserId={assigneeMeta.slackId}
      />
      <PushToGoogleTasksDialog
        isOpen={isPushToGoogleOpen}
        onClose={() => setIsPushToGoogleOpen(false)}
        tasks={task ? [buildUpdatedTask()] : []}
      />
      <PushToTrelloDialog
        isOpen={isPushToTrelloOpen}
        onClose={() => setIsPushToTrelloOpen(false)}
        tasks={task ? [buildUpdatedTask()] : []}
      />
    </Dialog>
  );
}

    

