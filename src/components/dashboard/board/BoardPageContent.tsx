"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  Circle,
  Clock,
  Filter,
  GripVertical,
  LayoutGrid,
  List as ListIcon,
  Loader2,
  MoreHorizontal,
  Plus,
  Search,
} from "lucide-react";
import {
  endOfWeek,
  format,
  isBefore,
  isSameDay,
  isValid,
  isWithinInterval,
  startOfToday,
  startOfWeek,
} from "date-fns";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import SelectionToolbar from "@/components/dashboard/common/SelectionToolbar";
import AssignPersonDialog from "@/components/dashboard/planning/AssignPersonDialog";
import SetDueDateDialog from "@/components/dashboard/planning/SetDueDateDialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api";
import { normalizePersonNameKey } from "@/lib/transcript-utils";
import { getAssigneeLabel, isPlaceholderAssignee } from "@/lib/task-assignee";
import type { Task } from "@/types/project";
import type { Person } from "@/types/person";

type TaskStatus = Task["status"];
type TaskPriority = Task["priority"];

type ViewMode = "board" | "list";
type DragPosition = "before" | "after" | null;

const taskStatuses: Array<{
  id: TaskStatus;
  label: string;
  color: string;
  isTerminal: boolean;
}> = [
  { id: "todo", label: "To do", color: "#3b82f6", isTerminal: false },
  { id: "inprogress", label: "In progress", color: "#f59e0b", isTerminal: false },
  { id: "done", label: "Done", color: "#10b981", isTerminal: true },
  { id: "recurring", label: "Recurring", color: "#8b5cf6", isTerminal: false },
];

const priorityOptions: TaskPriority[] = ["low", "medium", "high"];

const priorityStyles: Record<TaskPriority, string> = {
  low: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
  medium: "bg-amber-500/15 text-amber-700 border-amber-500/30",
  high: "bg-rose-500/15 text-rose-600 border-rose-500/30",
};

const priorityLabel: Record<TaskPriority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

type DueFilter = "all" | "today" | "overdue" | "this_week";

const normalizeDateInput = (value: string) => {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00`);
  if (!isValid(parsed)) return null;
  return parsed.toISOString();
};

const formatDueDate = (value?: string | null) => {
  if (!value) return null;
  const parsed = new Date(value);
  if (!isValid(parsed)) return null;
  return format(parsed, "MMM d");
};

const getInitials = (value?: string | null) => {
  if (!value) return "?";
  const cleaned = value.trim();
  if (!cleaned) return "?";
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (!parts.length) return cleaned.slice(0, 2).toUpperCase();
  const initials = parts.slice(0, 2).map((part) => part[0]).join("");
  return initials.toUpperCase();
};

interface BoardPageContentProps {
  workspaceId: string;
}

interface TaskDraft {
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeId: string;
  dueDate: string;
}
function PriorityBadge({ priority }: { priority: TaskPriority }) {
  return (
    <span
      className={cn(
        "text-xs font-medium px-2 py-0.5 rounded-full border",
        priorityStyles[priority]
      )}
    >
      {priorityLabel[priority]}
    </span>
  );
}

function AssigneeAvatar({
  label,
  person,
}: {
  label?: string | null;
  person?: Person | null;
}) {
  const name = person?.name || label || "Unassigned";
  const initials = getInitials(name);
  const frameClass =
    "h-7 w-7 rounded-full border-2 border-background flex items-center justify-center text-[10px] font-semibold overflow-hidden";

  if (!person) {
    return (
      <div className={cn(frameClass, "bg-muted")} title="Unassigned">
        <img src="/logo.svg" alt="TaskWiseAI" className="h-4 w-4" />
      </div>
    );
  }

  if (person.avatarUrl) {
    return (
      <img
        src={person.avatarUrl}
        alt={person.name}
        className="h-7 w-7 rounded-full border-2 border-background object-cover"
      />
    );
  }

  return (
    <div className={cn(frameClass, "bg-primary/10 text-primary")} title={name}>
      {initials}
    </div>
  );
}

function TaskActionsMenu({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="rounded-md p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
          type="button"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onEdit}>Edit task</DropdownMenuItem>
        <DropdownMenuItem
          onSelect={onDelete}
          className="text-destructive focus:text-destructive"
        >
          Delete task
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function BoardTaskCard({
  task,
  assigneeName,
  assigneePerson,
  onEdit,
  onDelete,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  isDragging,
  isDragOver,
  dragPosition,
  dragDisabled,
}: {
  task: Task;
  assigneeName: string;
  assigneePerson: Person | null;
  onEdit: () => void;
  onDelete: () => void;
  onDragStart: (event: React.DragEvent<HTMLDivElement>) => void;
  onDragOver: (event: React.DragEvent<HTMLDivElement>) => void;
  onDrop: (event: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
  isDragging: boolean;
  isDragOver: boolean;
  dragPosition: DragPosition;
  dragDisabled: boolean;
}) {
  const dueLabel = formatDueDate(task.dueAt || null);
  const priority = task.priority || "medium";
  const subtaskCount = task.subtaskCount || 0;

  return (
    <div
      draggable={!dragDisabled}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      className={cn(
        "group relative rounded-lg border border-border/50 bg-card p-3 shadow-sm transition",
        dragDisabled ? "cursor-default" : "cursor-grab active:cursor-grabbing",
        isDragging && "opacity-60 scale-[0.98]",
        isDragOver && dragPosition === "before" && "border-t-2 border-t-primary/60",
        isDragOver && dragPosition === "after" && "border-b-2 border-b-primary/60"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <PriorityBadge priority={priority} />
        <TaskActionsMenu onEdit={onEdit} onDelete={onDelete} />
      </div>

      <h4 className="mt-2 text-sm font-semibold text-foreground leading-snug">
        {task.title}
      </h4>
      {task.description ? (
        <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
          {task.description}
        </p>
      ) : null}

      <div className="mt-3 flex items-center justify-between border-t border-border/40 pt-2">
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {subtaskCount > 0 ? (
            <div className="flex items-center gap-1">
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>{subtaskCount} subtasks</span>
            </div>
          ) : null}
          {dueLabel ? (
            <div className="flex items-center gap-1">
              <Calendar className="h-3.5 w-3.5" />
              <span>{dueLabel}</span>
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <AssigneeAvatar label={assigneeName} person={assigneePerson} />
          <GripVertical className="h-4 w-4 text-muted-foreground" />
        </div>
      </div>
    </div>
  );
}
export default function BoardPageContent({
  workspaceId: _workspaceId,
}: BoardPageContentProps) {
  const { toast } = useToast();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>("board");
  const [searchQuery, setSearchQuery] = useState("");
  const [dueFilter, setDueFilter] = useState<DueFilter>("all");
  const [statusFilters, setStatusFilters] = useState<Set<TaskStatus>>(
    new Set(taskStatuses.map((status) => status.id))
  );
  const [priorityFilters, setPriorityFilters] = useState<Set<TaskPriority>>(
    new Set(priorityOptions)
  );
  const [assigneeFilters, setAssigneeFilters] = useState<Set<string>>(new Set());
  const [includeUnassigned, setIncludeUnassigned] = useState(false);
  const [isTaskDialogOpen, setIsTaskDialogOpen] = useState(false);
  const [isAssignDialogOpen, setIsAssignDialogOpen] = useState(false);
  const [isSetDueDateDialogOpen, setIsSetDueDateDialogOpen] = useState(false);
  const [isStatusDialogOpen, setIsStatusDialogOpen] = useState(false);
  const [taskDraft, setTaskDraft] = useState<TaskDraft>({
    title: "",
    description: "",
    status: "todo",
    priority: "medium",
    assigneeId: "",
    dueDate: "",
  });
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState<TaskStatus>("todo");
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<TaskStatus | null>(null);
  const [dragOverTaskId, setDragOverTaskId] = useState<string | null>(null);
  const [dragOverPosition, setDragOverPosition] = useState<DragPosition>(null);

  const orderedStatuses = taskStatuses;

  const peopleById = useMemo(() => {
    const map = new Map<string, Person>();
    people.forEach((person) => map.set(person.id, person));
    return map;
  }, [people]);

  const personNameKeyToId = useMemo(() => {
    const map = new Map<string, string>();
    people.forEach((person) => {
      const nameKey = normalizePersonNameKey(person.name || "");
      if (nameKey && !map.has(nameKey)) {
        map.set(nameKey, person.id);
      }
      if (Array.isArray(person.aliases)) {
        person.aliases.forEach((alias) => {
          const aliasKey = normalizePersonNameKey(alias || "");
          if (aliasKey && !map.has(aliasKey)) {
            map.set(aliasKey, person.id);
          }
        });
      }
    });
    return map;
  }, [people]);

  const personEmailToId = useMemo(() => {
    const map = new Map<string, string>();
    people.forEach((person) => {
      if (person.email) {
        map.set(person.email.toLowerCase(), person.id);
      }
      if (Array.isArray(person.aliases)) {
        person.aliases.forEach((alias) => {
          if (alias && alias.includes("@")) {
            map.set(alias.toLowerCase(), person.id);
          }
        });
      }
    });
    return map;
  }, [people]);

  const isFiltering = useMemo(() => {
    const hasSearch = searchQuery.trim().length > 0;
    const hasAssigneeFilter = assigneeFilters.size > 0 || includeUnassigned;
    const hasStatusFilter = statusFilters.size !== orderedStatuses.length;
    const hasPriorityFilter = priorityFilters.size !== priorityOptions.length;
    return (
      hasSearch ||
      hasAssigneeFilter ||
      hasStatusFilter ||
      hasPriorityFilter ||
      dueFilter !== "all"
    );
  }, [
    searchQuery,
    assigneeFilters,
    includeUnassigned,
    priorityFilters,
    dueFilter,
    statusFilters,
    orderedStatuses.length,
  ]);

  const resolveAssigneeIds = useCallback(
    (task: Task) => {
      const ids = new Set<string>();
      const rawAssignee = task.assignee as
        | { uid?: string; id?: string; name?: string; email?: string }
        | undefined;
      const directId = rawAssignee?.uid || rawAssignee?.id;
      if (directId && peopleById.has(String(directId))) {
        ids.add(String(directId));
      }
      if (rawAssignee?.email) {
        const emailKey = rawAssignee.email.toLowerCase();
        if (personEmailToId.has(emailKey)) {
          ids.add(personEmailToId.get(emailKey) as string);
        }
      }
      const nameKey =
        task.assigneeNameKey ||
        (task.assigneeName ? normalizePersonNameKey(task.assigneeName) : "") ||
        (rawAssignee?.name ? normalizePersonNameKey(rawAssignee.name) : "");
      if (nameKey && personNameKeyToId.has(nameKey)) {
        ids.add(personNameKeyToId.get(nameKey) as string);
      }
      return ids;
    },
    [peopleById, personEmailToId, personNameKeyToId]
  );

  const filteredTasks = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    const hasAssigneeFilter = assigneeFilters.size > 0 || includeUnassigned;
    const applyStatus = statusFilters.size !== orderedStatuses.length;
    const applyPriority = priorityFilters.size !== priorityOptions.length;
    const today = new Date();
    const weekRange = {
      start: startOfWeek(today, { weekStartsOn: 1 }),
      end: endOfWeek(today, { weekStartsOn: 1 }),
    };
    const normalizeStatus = (status?: string | null): TaskStatus => {
      const raw = (status || "todo").toLowerCase().trim();
      if (raw === "in progress" || raw === "in-progress" || raw === "in_progress") {
        return "inprogress";
      }
      if (raw === "to do" || raw === "to-do") {
        return "todo";
      }
      if (raw === "done" || raw === "completed" || raw === "complete") {
        return "done";
      }
      if (raw === "recurring") {
        return "recurring";
      }
      if (raw === "todo" || raw === "inprogress") {
        return raw as TaskStatus;
      }
      return "todo";
    };

    return tasks.filter((task) => {
      const statusId = normalizeStatus(task.status);
      if (normalizedQuery) {
        const haystack = `${task.title} ${task.description || ""}`
          .toLowerCase()
          .trim();
        if (!haystack.includes(normalizedQuery)) return false;
      }

      if (applyStatus && !statusFilters.has(statusId)) {
        return false;
      }

      if (applyPriority && !priorityFilters.has(task.priority)) {
        return false;
      }

      if (hasAssigneeFilter) {
        const assigneeIds = resolveAssigneeIds(task);
        const matches = Array.from(assigneeIds).some((id) => assigneeFilters.has(id));
        const hasAssignee = assigneeIds.size > 0;
        if (matches) {
          // keep
        } else if (!hasAssignee && includeUnassigned) {
          // keep
        } else {
          return false;
        }
      }

      if (dueFilter !== "all") {
        if (!task.dueAt) return false;
        const dueDate = new Date(task.dueAt);
        if (!isValid(dueDate)) return false;
        if (dueFilter === "today" && !isSameDay(dueDate, today)) return false;
        if (dueFilter === "overdue" && !isBefore(dueDate, startOfToday())) return false;
        if (dueFilter === "this_week" && !isWithinInterval(dueDate, weekRange)) {
          return false;
        }
      }

      return true;
    });
  }, [
    tasks,
    searchQuery,
    assigneeFilters,
    includeUnassigned,
    priorityFilters,
    dueFilter,
    resolveAssigneeIds,
    statusFilters,
    orderedStatuses.length,
  ]);

  const normalizeTaskStatus = useCallback((status?: string | null): TaskStatus => {
    const raw = (status || "todo").toLowerCase().trim();
    if (raw === "in progress" || raw === "in-progress" || raw === "in_progress") {
      return "inprogress";
    }
    if (raw === "to do" || raw === "to-do") {
      return "todo";
    }
    if (raw === "done" || raw === "completed" || raw === "complete") {
      return "done";
    }
    if (raw === "recurring") {
      return "recurring";
    }
    if (raw === "todo" || raw === "inprogress") {
      return raw as TaskStatus;
    }
    return "todo";
  }, []);

  const tasksByStatus = useMemo(() => {
    const map = new Map<string, Task[]>();
    orderedStatuses.forEach((status) => map.set(status.id, []));
    filteredTasks.forEach((task) => {
      const statusId = normalizeTaskStatus(task.status);
      if (!map.has(statusId)) return;
      map.get(statusId)?.push(task);
    });
    map.forEach((items) =>
      items.sort((a, b) => {
        const orderA = typeof a.order === "number" ? a.order : 0;
        const orderB = typeof b.order === "number" ? b.order : 0;
        if (orderA !== orderB) return orderA - orderB;
        return a.title.localeCompare(b.title);
      })
    );
    return map;
  }, [filteredTasks, normalizeTaskStatus, orderedStatuses]);

  const getAssigneeName = useCallback(
    (task: Task) => {
      const label = getAssigneeLabel(task, {
        peopleById,
        personNameKeyToId,
        personEmailToId,
      });
      if (label && !isPlaceholderAssignee(label)) return label;
      return "Unassigned";
    },
    [peopleById, personEmailToId, personNameKeyToId]
  );

  const getAssigneePerson = useCallback(
    (task: Task) => {
      const ids = resolveAssigneeIds(task);
      for (const id of ids) {
        const person = peopleById.get(id);
        if (person) return person;
      }
      return null;
    },
    [peopleById, resolveAssigneeIds]
  );

  const getStatusMeta = useCallback(
    (status: TaskStatus) =>
      orderedStatuses.find((entry) => entry.id === status) || orderedStatuses[0],
    [orderedStatuses]
  );

  const getStatusIcon = (status: TaskStatus, color: string) => {
    switch (status) {
      case "inprogress":
        return <Clock className="h-4 w-4" style={{ color }} />;
      case "done":
        return <CheckCircle2 className="h-4 w-4" style={{ color }} />;
      case "recurring":
        return <AlertCircle className="h-4 w-4" style={{ color }} />;
      case "todo":
      default:
        return <Circle className="h-4 w-4" style={{ color }} />;
    }
  };

  const loadBoard = useCallback(async () => {
    setIsLoading(true);
    try {
      const [taskList, peopleList] = await Promise.all([
        apiFetch<Task[]>("/api/tasks"),
        apiFetch<Person[]>("/api/people"),
      ]);

      setTasks(taskList);
      setPeople(peopleList);
    } catch (error) {
      console.error("Failed to load board:", error);
      toast({
        title: "Board load failed",
        description:
          error instanceof Error ? error.message : "Could not load board data.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadBoard();
  }, [loadBoard]);

  const handleTaskReorder = useCallback(async (updates: Task[]) => {
    const previous = tasks;
    setTasks(updates);
    const previousById = new Map(previous.map((task) => [task.id, task]));
    const changed = updates.filter((task) => {
      const before = previousById.get(task.id);
      return !before || before.status !== task.status || before.order !== task.order;
    });
    try {
      await Promise.all(
        changed.map((task) =>
          apiFetch(`/api/tasks/${task.id}`, {
            method: "PATCH",
            body: JSON.stringify({ status: task.status, order: task.order }),
          })
        )
      );
    } catch (error) {
      console.error("Task reorder failed:", error);
      setTasks(previous);
      toast({
        title: "Could not reorder tasks",
        description: error instanceof Error ? error.message : "Try again in a moment.",
        variant: "destructive",
      });
    }
  }, [tasks, toast]);

  const clearDragState = useCallback(() => {
    setDraggedTaskId(null);
    setDragOverColumn(null);
    setDragOverTaskId(null);
    setDragOverPosition(null);
  }, []);

  const applyDrop = useCallback(
    (targetStatusId: TaskStatus, targetTaskId?: string | null, position?: DragPosition) => {
      if (!draggedTaskId) return;

      const activeTask = tasks.find((task) => task.id === draggedTaskId);
      if (!activeTask) return;

      const sourceStatusId = normalizeTaskStatus(activeTask.status);
      const sourceTasks = tasks
        .filter((task) => normalizeTaskStatus(task.status) === sourceStatusId)
        .sort((a, b) => {
          const orderA = typeof a.order === "number" ? a.order : 0;
          const orderB = typeof b.order === "number" ? b.order : 0;
          return orderA - orderB;
        });

      const activeIndex = sourceTasks.findIndex((task) => task.id === activeTask.id);
      if (activeIndex === -1) return;

      const [moved] = sourceTasks.splice(activeIndex, 1);
      const movedTask =
        sourceStatusId === targetStatusId ? moved : { ...moved, status: targetStatusId };

      const targetTasks =
        sourceStatusId === targetStatusId
          ? sourceTasks
          : tasks
              .filter((task) => normalizeTaskStatus(task.status) === targetStatusId)
              .sort((a, b) => {
                const orderA = typeof a.order === "number" ? a.order : 0;
                const orderB = typeof b.order === "number" ? b.order : 0;
                return orderA - orderB;
              });

      const nextTargetTasks = sourceStatusId === targetStatusId ? targetTasks : [...targetTasks];

      let insertIndex = nextTargetTasks.length;
      if (targetTaskId) {
        const overIndex = nextTargetTasks.findIndex((task) => task.id === targetTaskId);
        if (overIndex >= 0) {
          insertIndex = position === "after" ? overIndex + 1 : overIndex;
        }
      }

      nextTargetTasks.splice(insertIndex, 0, movedTask);

      const normalizedSource = sourceTasks.map((task, index) => ({
        ...task,
        order: index,
      }));
      const normalizedTarget = nextTargetTasks.map((task, index) => ({
        ...task,
        status: targetStatusId,
        order: index,
      }));

      const otherTasks = tasks.filter(
        (task) =>
          normalizeTaskStatus(task.status) !== sourceStatusId &&
          normalizeTaskStatus(task.status) !== targetStatusId
      );

      const nextTasks =
        sourceStatusId === targetStatusId
          ? [...otherTasks, ...normalizedTarget]
          : [...otherTasks, ...normalizedSource, ...normalizedTarget];

      handleTaskReorder(nextTasks);
    },
    [draggedTaskId, handleTaskReorder, normalizeTaskStatus, tasks]
  );
  const handleDragStart = useCallback(
    (event: React.DragEvent<HTMLDivElement>, taskId: string) => {
      if (isFiltering) return;
      setDraggedTaskId(taskId);
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", taskId);
    },
    [isFiltering]
  );

  const handleDragOverColumn = useCallback(
    (event: React.DragEvent<HTMLDivElement>, statusId: TaskStatus) => {
      if (isFiltering) return;
      event.preventDefault();
      setDragOverColumn(statusId);
      setDragOverTaskId(null);
      setDragOverPosition(null);
    },
    [isFiltering]
  );

  const handleDragOverTask = useCallback(
    (event: React.DragEvent<HTMLDivElement>, task: Task) => {
      if (isFiltering) return;
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      const offset = event.clientY - rect.top;
      const position: DragPosition = offset < rect.height / 2 ? "before" : "after";
      setDragOverColumn(normalizeTaskStatus(task.status));
      setDragOverTaskId(task.id);
      setDragOverPosition(position);
    },
    [isFiltering, normalizeTaskStatus]
  );

  const handleDropOnColumn = useCallback(
    (event: React.DragEvent<HTMLDivElement>, statusId: TaskStatus) => {
      event.preventDefault();
      if (isFiltering || !draggedTaskId) {
        clearDragState();
        return;
      }
      applyDrop(statusId, null, null);
      clearDragState();
    },
    [applyDrop, clearDragState, draggedTaskId, isFiltering]
  );

  const handleDropOnTask = useCallback(
    (event: React.DragEvent<HTMLDivElement>, task: Task) => {
      event.preventDefault();
      if (isFiltering || !draggedTaskId) {
        clearDragState();
        return;
      }
      const statusId = normalizeTaskStatus(task.status);
      applyDrop(statusId, task.id, dragOverPosition);
      clearDragState();
    },
    [applyDrop, clearDragState, draggedTaskId, dragOverPosition, isFiltering, normalizeTaskStatus]
  );

  const resetTaskDraft = (status: TaskStatus) => {
    setTaskDraft({
      title: "",
      description: "",
      status,
      priority: "medium",
      assigneeId: "",
      dueDate: "",
    });
  };

  const openNewTask = (statusId: TaskStatus) => {
    setEditingTask(null);
    resetTaskDraft(statusId);
    setIsTaskDialogOpen(true);
  };

  const openEditTask = (task: Task) => {
    const rawAssignee = task.assignee as { uid?: string; id?: string } | undefined;
    const assigneeNameKey =
      task.assigneeNameKey ||
      (task.assigneeName ? normalizePersonNameKey(task.assigneeName) : "");
    setEditingTask(task);
    setTaskDraft({
      title: task.title,
      description: task.description || "",
      status: normalizeTaskStatus(task.status),
      priority: task.priority || "medium",
      assigneeId:
        rawAssignee?.uid ||
        rawAssignee?.id ||
        (assigneeNameKey ? personNameKeyToId.get(assigneeNameKey) : "") ||
        "",
      dueDate: typeof task.dueAt === "string" ? task.dueAt.slice(0, 10) : "",
    });
    setIsTaskDialogOpen(true);
  };

  const handleSaveTask = async () => {
    if (!taskDraft.title.trim()) {
      toast({
        title: "Title required",
        description: "Add a title before saving the task.",
        variant: "destructive",
      });
      return;
    }
    if (!taskDraft.status) {
      toast({
        title: "Select a column",
        description: "Choose a column for this task before saving.",
        variant: "destructive",
      });
      return;
    }

    const assignee = peopleById.get(taskDraft.assigneeId || "");
    const nextOrder =
      tasks
        .filter((task) => normalizeTaskStatus(task.status) === taskDraft.status)
        .reduce((maxOrder, task) => {
          const value = typeof task.order === "number" ? task.order : -1;
          return Math.max(maxOrder, value);
        }, -1) + 1;
    const assigneePayload = assignee
      ? { id: assignee.id, name: assignee.name, email: assignee.email || undefined }
      : null;
    const payload = {
      title: taskDraft.title.trim(),
      description: taskDraft.description.trim(),
      status: taskDraft.status,
      priority: taskDraft.priority,
      assignee: assigneePayload,
      assigneeName: assignee?.name || null,
      dueAt: normalizeDateInput(taskDraft.dueDate),
      ...(editingTask ? {} : { order: nextOrder }),
    };

    try {
      if (editingTask) {
        const updated = await apiFetch<Task>(`/api/tasks/${editingTask.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
        setTasks((prev) => prev.map((task) => (task.id === updated.id ? updated : task)));
      } else {
        const created = await apiFetch<Task>(`/api/tasks`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
        setTasks((prev) => [...prev, created]);
      }
      setIsTaskDialogOpen(false);
    } catch (error) {
      console.error("Failed to save task:", error);
      toast({
        title: "Could not save task",
        description: error instanceof Error ? error.message : "Try again in a moment.",
        variant: "destructive",
      });
    }
  };

  const handleDeleteTask = async (task: Task) => {
    try {
      await apiFetch(`/api/tasks/${task.id}`, {
        method: "DELETE",
      });
      setTasks((prev) => prev.filter((item) => item.id !== task.id));
    } catch (error) {
      console.error("Failed to delete task:", error);
      toast({
        title: "Could not delete task",
        description: error instanceof Error ? error.message : "Try again in a moment.",
        variant: "destructive",
      });
    }
  };

  const togglePriority = (priority: TaskPriority) => {
    setPriorityFilters((prev) => {
      const next = new Set(prev);
      if (next.has(priority)) {
        next.delete(priority);
      } else {
        next.add(priority);
      }
      if (!next.size) {
        next.add(priority);
      }
      return next;
    });
  };

  const toggleStatusFilter = (status: TaskStatus) => {
    setStatusFilters((prev) => {
      const next = new Set(prev);
      if (next.has(status)) {
        next.delete(status);
      } else {
        next.add(status);
      }
      if (!next.size) {
        next.add(status);
      }
      return next;
    });
  };

  const clearFilters = () => {
    setSearchQuery("");
    setDueFilter("all");
    setStatusFilters(new Set(orderedStatuses.map((status) => status.id)));
    setPriorityFilters(new Set(priorityOptions));
    setAssigneeFilters(new Set());
    setIncludeUnassigned(false);
  };

  const selectedVisibleCount = useMemo(
    () => filteredTasks.filter((task) => selectedTaskIds.has(task.id)).length,
    [filteredTasks, selectedTaskIds]
  );

  const allVisibleSelected =
    filteredTasks.length > 0 && selectedVisibleCount === filteredTasks.length;
  const someVisibleSelected =
    selectedVisibleCount > 0 && selectedVisibleCount < filteredTasks.length;

  const toggleTaskSelection = useCallback((taskId: string, checked: boolean) => {
    setSelectedTaskIds((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(taskId);
      } else {
        next.delete(taskId);
      }
      return next;
    });
  }, []);

  const toggleSelectAllVisible = useCallback(() => {
    setSelectedTaskIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        filteredTasks.forEach((task) => next.delete(task.id));
      } else {
        filteredTasks.forEach((task) => next.add(task.id));
      }
      return next;
    });
  }, [allVisibleSelected, filteredTasks]);

  const clearSelection = useCallback(() => {
    setSelectedTaskIds(new Set());
  }, []);

  useEffect(() => {
    setSelectedTaskIds((prev) => {
      const validIds = new Set(tasks.map((task) => task.id));
      const next = new Set(Array.from(prev).filter((id) => validIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [tasks]);

  const selectedTasks = useMemo(
    () => tasks.filter((task) => selectedTaskIds.has(task.id)),
    [selectedTaskIds, tasks]
  );

  const applyBulkUpdates = useCallback(
    async (nextTasks: Task[], updates: Array<{ id: string; patch: Partial<Task> }>) => {
      if (!updates.length) return;
      const previous = tasks;
      setTasks(nextTasks);
      try {
        await Promise.all(
          updates.map(({ id, patch }) =>
            apiFetch(`/api/tasks/${id}`, {
              method: "PATCH",
              body: JSON.stringify(patch),
            })
          )
        );
        clearSelection();
      } catch (error) {
        console.error("Bulk update failed:", error);
        setTasks(previous);
        toast({
          title: "Bulk update failed",
          description: error instanceof Error ? error.message : "Try again in a moment.",
          variant: "destructive",
        });
      }
    },
    [clearSelection, tasks, toast]
  );

  const handleBulkDelete = useCallback(async () => {
    if (!selectedTaskIds.size) return;
    const previous = tasks;
    const ids = Array.from(selectedTaskIds);
    setTasks((prev) => prev.filter((task) => !selectedTaskIds.has(task.id)));
    clearSelection();
    try {
      await Promise.all(
        ids.map((id) =>
          apiFetch(`/api/tasks/${id}`, {
            method: "DELETE",
          })
        )
      );
    } catch (error) {
      console.error("Bulk delete failed:", error);
      setTasks(previous);
      toast({
        title: "Bulk delete failed",
        description: error instanceof Error ? error.message : "Try again in a moment.",
        variant: "destructive",
      });
    }
  }, [clearSelection, selectedTaskIds, tasks, toast]);

  const handleBulkAssign = useCallback(
    async (person: Person) => {
      if (!selectedTasks.length) return;
      const assigneePayload = {
        id: person.id,
        name: person.name,
        email: person.email || undefined,
      };
      const nextTasks = tasks.map((task) =>
        selectedTaskIds.has(task.id)
          ? {
              ...task,
              assignee: assigneePayload,
              assigneeName: person.name,
              assigneeNameKey: normalizePersonNameKey(person.name),
            }
          : task
      );
      const updates = selectedTasks.map((task) => ({
        id: task.id,
        patch: {
          assignee: assigneePayload,
          assigneeName: person.name,
        },
      }));
      await applyBulkUpdates(nextTasks, updates);
      setIsAssignDialogOpen(false);
    },
    [applyBulkUpdates, selectedTaskIds, selectedTasks, tasks]
  );

  const handleBulkSetDueDate = useCallback(
    async (date: Date | undefined) => {
      if (!selectedTasks.length) return;
      const dueAt = date ? date.toISOString() : null;
      const nextTasks = tasks.map((task) =>
        selectedTaskIds.has(task.id) ? { ...task, dueAt } : task
      );
      const updates = selectedTasks.map((task) => ({
        id: task.id,
        patch: { dueAt },
      }));
      await applyBulkUpdates(nextTasks, updates);
      setIsSetDueDateDialogOpen(false);
    },
    [applyBulkUpdates, selectedTaskIds, selectedTasks, tasks]
  );

  const openStatusDialog = useCallback(() => {
    if (!selectedTasks.length) return;
    const uniqueStatuses = new Set(
      selectedTasks.map((task) => normalizeTaskStatus(task.status))
    );
    if (uniqueStatuses.size === 1) {
      setBulkStatus(Array.from(uniqueStatuses)[0]);
    }
    setIsStatusDialogOpen(true);
  }, [normalizeTaskStatus, selectedTasks]);

  const handleBulkStatusChange = useCallback(async () => {
    if (!selectedTasks.length) {
      setIsStatusDialogOpen(false);
      return;
    }

    const maxOrderByStatus = new Map<TaskStatus, number>();
    tasks.forEach((task) => {
      const status = normalizeTaskStatus(task.status);
      const order = typeof task.order === "number" ? task.order : -1;
      const currentMax = maxOrderByStatus.get(status) ?? -1;
      if (order > currentMax) {
        maxOrderByStatus.set(status, order);
      }
    });

    const updates: Array<{ id: string; patch: Partial<Task> }> = [];
    const nextTasks = tasks.map((task) => {
      if (!selectedTaskIds.has(task.id)) return task;
      const currentStatus = normalizeTaskStatus(task.status);
      if (currentStatus === bulkStatus) return task;
      const nextOrder = (maxOrderByStatus.get(bulkStatus) ?? -1) + 1;
      maxOrderByStatus.set(bulkStatus, nextOrder);
      updates.push({
        id: task.id,
        patch: { status: bulkStatus, order: nextOrder },
      });
      return {
        ...task,
        status: bulkStatus,
        order: nextOrder,
      };
    });

    await applyBulkUpdates(nextTasks, updates);
    setIsStatusDialogOpen(false);
  }, [
    applyBulkUpdates,
    bulkStatus,
    normalizeTaskStatus,
    selectedTaskIds,
    selectedTasks,
    tasks,
  ]);

  const handleCreatePerson = useCallback(
    async (name: string) => {
      try {
        const created = await apiFetch<Person>("/api/people", {
          method: "POST",
          body: JSON.stringify({ name }),
        });
        setPeople((prev) => {
          const existingIndex = prev.findIndex((person) => person.id === created.id);
          if (existingIndex >= 0) {
            const next = [...prev];
            next[existingIndex] = created;
            return next;
          }
          return [...prev, created];
        });
        return created.id;
      } catch (error) {
        console.error("Failed to create person:", error);
        toast({
          title: "Could not create person",
          description: error instanceof Error ? error.message : "Try again in a moment.",
          variant: "destructive",
        });
        return undefined;
      }
    },
    [toast]
  );
  const renderBoardView = () => (
    <div className="flex-1 overflow-x-auto overflow-y-hidden">
      <div className="flex h-full gap-6 px-6 pb-6 min-w-[1000px]">
        {orderedStatuses.map((status) => {
          const columnTasks = tasksByStatus.get(status.id) || [];
          return (
            <div
              key={status.id}
              onDragOver={(event) => handleDragOverColumn(event, status.id)}
              onDrop={(event) => handleDropOnColumn(event, status.id)}
              className={cn(
                "flex h-full w-80 shrink-0 flex-col rounded-xl border border-border/50 bg-card/60",
                dragOverColumn === status.id && !isFiltering
                  ? "ring-2 ring-primary/30 bg-primary/5"
                  : ""
              )}
            >
              <div className="p-3 flex items-center justify-between sticky top-0 bg-transparent">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: status.color }}
                  />
                  <h3 className="text-sm font-semibold text-foreground truncate">
                    {status.label}
                  </h3>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                    {columnTasks.length}
                  </span>
                  {status.isTerminal ? (
                    <span className="rounded-full border border-border/60 px-2 py-0.5 text-[10px] text-muted-foreground">
                      Terminal
                    </span>
                  ) : null}
                </div>
                <div className="flex gap-1">
                  <button
                    className="rounded-md p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
                    type="button"
                    onClick={() => openNewTask(status.id)}
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                  <button
                    className="rounded-md p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
                    type="button"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="flex-1 p-3 flex flex-col gap-3 overflow-y-auto">
                {columnTasks.map((task) => (
                  <BoardTaskCard
                    key={task.id}
                    task={task}
                    assigneeName={getAssigneeName(task)}
                    assigneePerson={getAssigneePerson(task)}
                    onEdit={() => openEditTask(task)}
                    onDelete={() => handleDeleteTask(task)}
                    onDragStart={(event) => handleDragStart(event, task.id)}
                    onDragOver={(event) => handleDragOverTask(event, task)}
                    onDrop={(event) => handleDropOnTask(event, task)}
                    onDragEnd={clearDragState}
                    isDragging={draggedTaskId === task.id}
                    isDragOver={dragOverTaskId === task.id}
                    dragPosition={dragOverPosition}
                    dragDisabled={isFiltering}
                  />
                ))}

                {columnTasks.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground min-h-[120px] border-2 border-dashed border-border/60 rounded-lg">
                    <span className="text-sm font-medium">No tasks yet</span>
                    <span className="text-xs">Drop items here</span>
                  </div>
                ) : null}

                <Button
                  variant="ghost"
                  className="w-full justify-start text-sm text-muted-foreground"
                  onClick={() => openNewTask(status.id)}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add a task
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  const renderListView = () => (
    <div className="flex-1 px-6 pb-6 overflow-hidden flex flex-col">
      <div className="bg-card rounded-xl border border-border/50 shadow-sm overflow-hidden flex flex-col flex-1">
        <div className="grid grid-cols-12 gap-4 p-4 border-b border-border/50 bg-muted/40 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          <div className="col-span-1 flex items-center">
            <Checkbox
              checked={allVisibleSelected ? true : someVisibleSelected ? "indeterminate" : false}
              onCheckedChange={() => toggleSelectAllVisible()}
              aria-label="Select all tasks"
            />
          </div>
          <div className="col-span-3">Task Name</div>
          <div className="col-span-2">Status</div>
          <div className="col-span-2">Priority</div>
          <div className="col-span-2">Due Date</div>
          <div className="col-span-1 text-right">Assignee</div>
          <div className="col-span-1 text-right">Actions</div>
        </div>

        <div className="overflow-y-auto flex-1">
          {filteredTasks.length > 0 ? (
            filteredTasks.map((task) => {
              const statusId = normalizeTaskStatus(task.status);
              const statusMeta = getStatusMeta(statusId);
              const assigneeName = getAssigneeName(task);
              const assigneePerson = getAssigneePerson(task);
              const dueLabel = formatDueDate(task.dueAt || null) || "-";

              return (
                <div
                  key={task.id}
                  className="grid grid-cols-12 gap-4 p-4 border-b border-border/30 items-center hover:bg-muted/40 transition-colors"
                >
                  <div className="col-span-1 flex items-center">
                    <Checkbox
                      checked={selectedTaskIds.has(task.id)}
                      onCheckedChange={(checked) => toggleTaskSelection(task.id, Boolean(checked))}
                      aria-label={`Select ${task.title}`}
                    />
                  </div>
                  <div className="col-span-3 flex items-center gap-3 min-w-0">
                    <GripVertical
                      className={cn(
                        "h-4 w-4",
                        isFiltering ? "text-muted-foreground/40" : "text-muted-foreground"
                      )}
                    />
                    <div className="min-w-0">
                      <h4 className="text-sm font-medium text-foreground truncate">
                        {task.title}
                      </h4>
                      {task.description ? (
                        <p className="text-xs text-muted-foreground truncate max-w-[220px]">
                          {task.description}
                        </p>
                      ) : null}
                    </div>
                  </div>

                  <div className="col-span-2 flex items-center gap-2 text-sm text-muted-foreground">
                    {getStatusIcon(statusId, statusMeta.color)}
                    <span className="capitalize">{statusMeta.label}</span>
                  </div>

                  <div className="col-span-2">
                    <PriorityBadge priority={task.priority || "medium"} />
                  </div>

                  <div className="col-span-2 text-sm text-muted-foreground">{dueLabel}</div>

                  <div className="col-span-1 flex justify-end">
                    <AssigneeAvatar label={assigneeName} person={assigneePerson} />
                  </div>

                  <div className="col-span-1 flex justify-end">
                    <TaskActionsMenu
                      onEdit={() => openEditTask(task)}
                      onDelete={() => handleDeleteTask(task)}
                    />
                  </div>
                </div>
              );
            })
          ) : (
            <div className="p-8 text-center text-muted-foreground">
              No tasks found matching your filters.
            </div>
          )}
        </div>
      </div>
    </div>
  );
  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-background">
      <DashboardHeader
        pageIcon={LayoutGrid}
        pageTitle={
          <div className="flex flex-col">
            <h1 className="text-2xl font-bold font-headline">Board</h1>
            <p className="text-sm text-muted-foreground">
              Manage tasks, track progress, and collaborate.
            </p>
          </div>
        }
      >
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search tasks"
              className="pl-9 w-64 bg-muted/60 border-transparent focus:bg-card"
            />
          </div>

          <div className="h-8 w-px bg-border/70" />

          <div className="flex bg-muted/60 p-1 rounded-lg">
            <button
              onClick={() => setViewMode("board")}
              className={cn(
                "p-1.5 rounded-md transition",
                viewMode === "board"
                  ? "bg-card shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
              type="button"
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={cn(
                "p-1.5 rounded-md transition",
                viewMode === "list"
                  ? "bg-card shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
              type="button"
            >
              <ListIcon className="w-4 h-4" />
            </button>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Filter className="mr-2 h-4 w-4" />
                Filters
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel>Assignee</DropdownMenuLabel>
              <DropdownMenuCheckboxItem
                checked={includeUnassigned}
                onCheckedChange={(checked) => setIncludeUnassigned(Boolean(checked))}
              >
                Unassigned
              </DropdownMenuCheckboxItem>
              {people.map((person) => (
                <DropdownMenuCheckboxItem
                  key={person.id}
                  checked={assigneeFilters.has(person.id)}
                  onCheckedChange={(checked) => {
                    setAssigneeFilters((prev) => {
                      const next = new Set(prev);
                      if (checked) {
                        next.add(person.id);
                      } else {
                        next.delete(person.id);
                      }
                      return next;
                    });
                  }}
                >
                  {person.name}
                </DropdownMenuCheckboxItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Due date</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={dueFilter}
                onValueChange={(value) => setDueFilter(value as DueFilter)}
              >
                <DropdownMenuRadioItem value="all">All dates</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="today">Due today</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="overdue">Overdue</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="this_week">This week</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Status</DropdownMenuLabel>
              {orderedStatuses.map((status) => (
                <DropdownMenuCheckboxItem
                  key={status.id}
                  checked={statusFilters.has(status.id)}
                  onCheckedChange={() => toggleStatusFilter(status.id)}
                >
                  {status.label}
                </DropdownMenuCheckboxItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Priority</DropdownMenuLabel>
              {priorityOptions.map((priority) => (
                <DropdownMenuCheckboxItem
                  key={priority}
                  checked={priorityFilters.has(priority)}
                  onCheckedChange={() => togglePriority(priority)}
                >
                  {priorityLabel[priority]}
                </DropdownMenuCheckboxItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={clearFilters} disabled={!isFiltering}>
                Clear filters
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {isFiltering ? (
            <Badge variant="outline" className="text-[11px]">
              Clear filters to reorder tasks
            </Badge>
          ) : null}

          <Button size="sm" onClick={() => openNewTask("todo")}>
            <Plus className="mr-2 h-4 w-4" />
            New task
          </Button>
        </div>
      </DashboardHeader>

      <main className="flex-1 overflow-hidden pt-6 flex flex-col">
        {viewMode === "board" ? renderBoardView() : renderListView()}
      </main>

      <SelectionToolbar
        selectedCount={viewMode === "list" ? selectedTaskIds.size : 0}
        onClear={clearSelection}
        onDelete={handleBulkDelete}
        onAssign={() => setIsAssignDialogOpen(true)}
        onSetDueDate={() => setIsSetDueDateDialogOpen(true)}
        onChangeStatus={openStatusDialog}
      />

      <Dialog open={isTaskDialogOpen} onOpenChange={setIsTaskDialogOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>{editingTask ? "Edit task" : "New task"}</DialogTitle>
            <DialogDescription>
              {editingTask
                ? "Update the task details and save your changes."
                : "Capture the task details and assign it to the right column."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="task-title">Title</Label>
              <Input
                id="task-title"
                value={taskDraft.title}
                onChange={(event) =>
                  setTaskDraft((prev) => ({ ...prev, title: event.target.value }))
                }
              />
            </div>
            <div>
              <Label htmlFor="task-description">Description</Label>
              <Textarea
                id="task-description"
                value={taskDraft.description}
                onChange={(event) =>
                  setTaskDraft((prev) => ({
                    ...prev,
                    description: event.target.value,
                  }))
                }
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label>Status</Label>
                <Select
                  value={taskDraft.status}
                  onValueChange={(value) =>
                    setTaskDraft((prev) => ({ ...prev, status: value as TaskStatus }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectContent>
                    {orderedStatuses.map((status) => (
                      <SelectItem key={status.id} value={status.id}>
                        {status.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Priority</Label>
                <Select
                  value={taskDraft.priority}
                  onValueChange={(value) =>
                    setTaskDraft((prev) => ({
                      ...prev,
                      priority: value as TaskPriority,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select priority" />
                  </SelectTrigger>
                  <SelectContent>
                    {priorityOptions.map((priority) => (
                      <SelectItem key={priority} value={priority}>
                        {priorityLabel[priority]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label>Assignee</Label>
                <Select
                  value={taskDraft.assigneeId || "__unassigned__"}
                  onValueChange={(value) =>
                    setTaskDraft((prev) => ({
                      ...prev,
                      assigneeId: value === "__unassigned__" ? "" : value,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Unassigned" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__unassigned__">Unassigned</SelectItem>
                    {people.map((person) => (
                      <SelectItem key={person.id} value={person.id}>
                        {person.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="task-due">Due date</Label>
                <Input
                  id="task-due"
                  type="date"
                  value={taskDraft.dueDate}
                  onChange={(event) =>
                    setTaskDraft((prev) => ({
                      ...prev,
                      dueDate: event.target.value,
                    }))
                  }
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsTaskDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveTask}>Save task</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AssignPersonDialog
        isOpen={isAssignDialogOpen}
        onClose={() => setIsAssignDialogOpen(false)}
        people={people}
        isLoadingPeople={isLoading}
        onAssign={handleBulkAssign}
        onCreatePerson={handleCreatePerson}
        task={null}
        selectedTaskIds={selectedTaskIds}
      />

      <SetDueDateDialog
        isOpen={isSetDueDateDialogOpen}
        onClose={() => setIsSetDueDateDialogOpen(false)}
        onConfirm={handleBulkSetDueDate}
      />

      <Dialog open={isStatusDialogOpen} onOpenChange={setIsStatusDialogOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Change status</DialogTitle>
            <DialogDescription>
              Apply a new status to the selected tasks.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Status</Label>
              <Select
                value={bulkStatus}
                onValueChange={(value) => setBulkStatus(value as TaskStatus)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  {orderedStatuses.map((status) => (
                    <SelectItem key={status.id} value={status.id}>
                      {status.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsStatusDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleBulkStatusChange}>Apply status</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
