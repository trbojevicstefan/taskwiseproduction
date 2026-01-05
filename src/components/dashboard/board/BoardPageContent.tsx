"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
  Palette,
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { BOARD_TEMPLATES, DEFAULT_BOARD_TEMPLATE_ID } from "@/lib/board-templates";
import type { Task } from "@/types/project";
import type { Board, BoardStatus, BoardStatusCategory } from "@/types/board";
import type { Person } from "@/types/person";

type TaskPriority = Task["priority"];

type ViewMode = "board" | "list";
type DragPosition = "before" | "after" | null;

type BoardTaskItem = Task & {
  boardItemId: string;
  boardStatusId: string;
  boardRank: number;
};

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

const applyHexAlpha = (hex: string, alpha: number) => {
  if (!hex) return `rgba(0, 0, 0, ${alpha})`;
  let value = hex.replace("#", "").trim();
  if (value.length === 3) {
    value = value
      .split("")
      .map((ch) => ch + ch)
      .join("");
  }
  if (value.length !== 6) {
    return `rgba(0, 0, 0, ${alpha})`;
  }
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  if ([r, g, b].some((part) => Number.isNaN(part))) {
    return `rgba(0, 0, 0, ${alpha})`;
  }
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
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
  statusId: string;
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
    if (label && label !== "Unassigned") {
      return (
        <div className={cn(frameClass, "bg-primary/10 text-primary")} title={name}>
          {initials}
        </div>
      );
    }
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
          data-no-drag
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

function AssigneeDropdown({
  task,
  assigneeName,
  assigneePerson,
  people,
  onAssign,
}: {
  task: Task;
  assigneeName: string;
  assigneePerson: Person | null;
  people: Person[];
  onAssign: (task: Task, person: Person | null) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" data-no-drag>
          <AssigneeAvatar label={assigneeName} person={assigneePerson} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onSelect={() => onAssign(task, null)}>
          Unassigned
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {people.length ? (
          people.map((person) => (
            <DropdownMenuItem
              key={person.id}
              onSelect={() => onAssign(task, person)}
            >
              {person.name}
            </DropdownMenuItem>
          ))
        ) : (
          <DropdownMenuItem disabled>No people yet</DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function BoardTaskCard({
  task,
  assigneeName,
  assigneePerson,
  people,
  onEdit,
  onDelete,
  onOpen,
  onAssign,
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
  people: Person[];
  onEdit: () => void;
  onDelete: () => void;
  onOpen: () => void;
  onAssign: (task: Task, person: Person | null) => void;
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

      <button
        type="button"
        data-no-drag
        onClick={onOpen}
        className="mt-2 text-left text-sm font-semibold text-foreground leading-snug hover:text-primary"
      >
        {task.title}
      </button>
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
          <AssigneeDropdown
            task={task}
            assigneeName={assigneeName}
            assigneePerson={assigneePerson}
            people={people}
            onAssign={onAssign}
          />
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
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchParamsString = searchParams.toString();
  const boardIdParam = searchParams.get("boardId");
  const [boards, setBoards] = useState<Board[]>([]);
  const [activeBoardId, setActiveBoardId] = useState<string | null>(null);
  const [boardStatuses, setBoardStatuses] = useState<BoardStatus[]>([]);
  const [tasks, setTasks] = useState<BoardTaskItem[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>("board");
  const [searchQuery, setSearchQuery] = useState("");
  const [dueFilter, setDueFilter] = useState<DueFilter>("all");
  const [statusFilters, setStatusFilters] = useState<Set<string>>(new Set());
  const [priorityFilters, setPriorityFilters] = useState<Set<TaskPriority>>(
    new Set(priorityOptions)
  );
  const [assigneeFilters, setAssigneeFilters] = useState<Set<string>>(new Set());
  const [includeUnassigned, setIncludeUnassigned] = useState(false);
  const [isTaskDialogOpen, setIsTaskDialogOpen] = useState(false);
  const [isBoardDialogOpen, setIsBoardDialogOpen] = useState(false);
  const [isStageDialogOpen, setIsStageDialogOpen] = useState(false);
  const [isStageColorDialogOpen, setIsStageColorDialogOpen] = useState(false);
  const [stageToEdit, setStageToEdit] = useState<BoardStatus | null>(null);
  const [stageColorDraft, setStageColorDraft] = useState("#2563eb");
  const [stageToDelete, setStageToDelete] = useState<BoardStatus | null>(null);
  const [isAssignDialogOpen, setIsAssignDialogOpen] = useState(false);
  const [isSetDueDateDialogOpen, setIsSetDueDateDialogOpen] = useState(false);
  const [isStatusDialogOpen, setIsStatusDialogOpen] = useState(false);
  const [newBoardName, setNewBoardName] = useState("");
  const [newBoardDescription, setNewBoardDescription] = useState("");
  const [newBoardTemplateId, setNewBoardTemplateId] = useState(
    DEFAULT_BOARD_TEMPLATE_ID
  );
  const [newBoardColor, setNewBoardColor] = useState("#2563eb");
  const [newStageLabel, setNewStageLabel] = useState("");
  const [newStageCategory, setNewStageCategory] =
    useState<BoardStatusCategory>("todo");
  const [newStageColor, setNewStageColor] = useState("#2563eb");
  const [taskDraft, setTaskDraft] = useState<TaskDraft>({
    title: "",
    description: "",
    statusId: "",
    priority: "medium",
    assigneeId: "",
    dueDate: "",
  });
  const [editingTask, setEditingTask] = useState<BoardTaskItem | null>(null);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [bulkStatusId, setBulkStatusId] = useState<string>("");
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const [dragOverTaskId, setDragOverTaskId] = useState<string | null>(null);
  const [dragOverPosition, setDragOverPosition] = useState<DragPosition>(null);

  const orderedStatuses = useMemo(
    () => [...boardStatuses].sort((a, b) => a.order - b.order),
    [boardStatuses]
  );

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
    return tasks.filter((task) => {
      const statusId = task.boardStatusId || orderedStatuses[0]?.id || "";
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

  const tasksByStatus = useMemo(() => {
    const map = new Map<string, BoardTaskItem[]>();
    orderedStatuses.forEach((status) => map.set(status.id, []));
    filteredTasks.forEach((task) => {
      const statusId = task.boardStatusId || orderedStatuses[0]?.id;
      if (!statusId || !map.has(statusId)) return;
      map.get(statusId)?.push(task);
    });
    map.forEach((items) =>
      items.sort((a, b) => {
        const rankA = typeof a.boardRank === "number" ? a.boardRank : 0;
        const rankB = typeof b.boardRank === "number" ? b.boardRank : 0;
        if (rankA !== rankB) return rankA - rankB;
        return a.title.localeCompare(b.title);
      })
    );
    return map;
  }, [filteredTasks, orderedStatuses]);

  const totalTasksByStatus = useMemo(() => {
    const map = new Map<string, number>();
    tasks.forEach((task) => {
      const statusId = task.boardStatusId || orderedStatuses[0]?.id;
      if (!statusId) return;
      map.set(statusId, (map.get(statusId) ?? 0) + 1);
    });
    return map;
  }, [orderedStatuses, tasks]);

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
    (statusId?: string | null) =>
      orderedStatuses.find((entry) => entry.id === statusId) || orderedStatuses[0],
    [orderedStatuses]
  );

  const getStatusIcon = (category: BoardStatusCategory | null | undefined, color: string) => {
    switch (category) {
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

  const loadBoards = useCallback(async () => {
    if (!_workspaceId) return;
    setIsLoading(true);
    try {
      const [boardList, peopleList] = await Promise.all([
        apiFetch<Board[]>(`/api/workspaces/${_workspaceId}/boards`),
        apiFetch<Person[]>("/api/people"),
      ]);

      setBoards(boardList);
      setPeople(peopleList);
      if (!boardList.length) {
        setIsLoading(false);
      }
    } catch (error) {
      console.error("Failed to load boards:", error);
      toast({
        title: "Board load failed",
        description:
          error instanceof Error ? error.message : "Could not load board data.",
        variant: "destructive",
      });
      setIsLoading(false);
    }
  }, [_workspaceId, toast]);

  const loadBoardData = useCallback(
    async (boardId: string) => {
      if (!_workspaceId || !boardId) return;
      setIsLoading(true);
      try {
        const [statusList, boardItems] = await Promise.all([
          apiFetch<BoardStatus[]>(
            `/api/workspaces/${_workspaceId}/boards/${boardId}/statuses`
          ),
          apiFetch<BoardTaskItem[]>(
            `/api/workspaces/${_workspaceId}/boards/${boardId}/items`
          ),
        ]);
        setBoardStatuses(statusList);
        setTasks(boardItems);
        setSelectedTaskIds(new Set());
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
    },
    [_workspaceId, toast]
  );

  useEffect(() => {
    loadBoards();
  }, [loadBoards]);

  useEffect(() => {
    if (!boards.length) return;
    const paramMatch = boardIdParam && boards.find((board) => board.id === boardIdParam);
    const nextBoardId = paramMatch?.id || boards[0]?.id || null;
    if (nextBoardId && nextBoardId !== activeBoardId) {
      setActiveBoardId(nextBoardId);
    }
    if (nextBoardId && nextBoardId !== boardIdParam) {
      const params = new URLSearchParams(searchParamsString);
      params.set("boardId", nextBoardId);
      router.replace(`/workspaces/${_workspaceId}/board?${params.toString()}`);
    }
  }, [
    activeBoardId,
    boardIdParam,
    boards,
    router,
    searchParamsString,
    _workspaceId,
  ]);

  useEffect(() => {
    if (activeBoardId) {
      loadBoardData(activeBoardId);
    }
  }, [activeBoardId, loadBoardData]);

  const resolveBoardStatusId = useCallback(
    (statusId?: string | null) => {
      if (statusId && orderedStatuses.some((status) => status.id === statusId)) {
        return statusId;
      }
      return orderedStatuses[0]?.id || "";
    },
    [orderedStatuses]
  );

  const resolveStatusIdByCategory = useCallback(
    (category?: BoardStatusCategory | null) => {
      if (!category) return resolveBoardStatusId(null);
      const match = orderedStatuses.find((status) => status.category === category);
      return match?.id || resolveBoardStatusId(null);
    },
    [orderedStatuses, resolveBoardStatusId]
  );

  const computeRank = useCallback((before?: number | null, after?: number | null) => {
    if (before == null && after == null) return 0;
    if (before == null) return (after as number) - 1000;
    if (after == null) return before + 1000;
    if (after - before > 0.0001) return (before + after) / 2;
    return before + 0.0001;
  }, []);

  const updateBoardItem = useCallback(
    async (
      taskId: string,
      options: { statusId?: string; rank?: number; taskUpdates?: Record<string, any> }
    ) => {
      if (!activeBoardId) return;
      const current = tasks.find((task) => task.id === taskId);
      if (!current) return;

      const previous = tasks;
      const nextTasks = tasks.map((task) =>
        task.id === taskId
          ? {
              ...task,
              boardStatusId: options.statusId ?? task.boardStatusId,
              boardRank:
                typeof options.rank === "number" ? options.rank : task.boardRank,
              ...(options.taskUpdates || {}),
            }
          : task
      );
      setTasks(nextTasks);

      try {
        const payload: Record<string, any> = {};
        if (options.statusId) payload.statusId = options.statusId;
        if (typeof options.rank === "number") payload.rank = options.rank;
        if (options.taskUpdates) payload.taskUpdates = options.taskUpdates;
        const updated = await apiFetch<BoardTaskItem>(
          `/api/workspaces/${_workspaceId}/boards/${activeBoardId}/items/${current.boardItemId}`,
          {
            method: "PATCH",
            body: JSON.stringify(payload),
          }
        );
        setTasks((prev) =>
          prev.map((task) => (task.id === updated.id ? { ...task, ...updated } : task))
        );
      } catch (error) {
        console.error("Board update failed:", error);
        setTasks(previous);
        toast({
          title: "Task update failed",
          description:
            error instanceof Error ? error.message : "Try again in a moment.",
          variant: "destructive",
        });
      }
    },
    [activeBoardId, _workspaceId, tasks, toast]
  );

  const clearDragState = useCallback(() => {
    setDraggedTaskId(null);
    setDragOverColumn(null);
    setDragOverTaskId(null);
    setDragOverPosition(null);
  }, []);

  const applyDrop = useCallback(
    (targetStatusId: string, targetTaskId?: string | null, position?: DragPosition) => {
      if (!draggedTaskId) return;

      const activeTask = tasks.find((task) => task.id === draggedTaskId);
      if (!activeTask) return;

      const resolvedTargetStatusId = resolveBoardStatusId(targetStatusId);
      const targetTasks = tasksByStatus.get(resolvedTargetStatusId) || [];
      const visibleTargets = targetTasks.filter((task) => task.id !== activeTask.id);

      let insertIndex = visibleTargets.length;
      if (targetTaskId) {
        const overIndex = visibleTargets.findIndex((task) => task.id === targetTaskId);
        if (overIndex >= 0) {
          insertIndex = position === "after" ? overIndex + 1 : overIndex;
        }
      }

      const before = insertIndex > 0 ? visibleTargets[insertIndex - 1] : null;
      const after =
        insertIndex < visibleTargets.length ? visibleTargets[insertIndex] : null;
      const newRank = computeRank(before?.boardRank, after?.boardRank);

      updateBoardItem(activeTask.id, {
        statusId: resolvedTargetStatusId,
        rank: newRank,
      });
    },
    [computeRank, draggedTaskId, resolveBoardStatusId, tasks, tasksByStatus, updateBoardItem]
  );
  const handleDragStart = useCallback(
    (event: React.DragEvent<HTMLDivElement>, taskId: string) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest?.("[data-no-drag]")) {
        event.preventDefault();
        return;
      }
      setDraggedTaskId(taskId);
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", taskId);
    },
    []
  );

  const handleDragOverColumn = useCallback(
    (event: React.DragEvent<HTMLDivElement>, statusId: string) => {
      event.preventDefault();
      setDragOverColumn(statusId);
      setDragOverTaskId(null);
      setDragOverPosition(null);
    },
    []
  );

  const handleDragOverTask = useCallback(
    (event: React.DragEvent<HTMLDivElement>, task: BoardTaskItem) => {
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      const offset = event.clientY - rect.top;
      const position: DragPosition = offset < rect.height / 2 ? "before" : "after";
      setDragOverColumn(task.boardStatusId || resolveBoardStatusId(null));
      setDragOverTaskId(task.id);
      setDragOverPosition(position);
    },
    [resolveBoardStatusId]
  );

  const handleDropOnColumn = useCallback(
    (event: React.DragEvent<HTMLDivElement>, statusId: string) => {
      event.preventDefault();
      if (!draggedTaskId) {
        clearDragState();
        return;
      }
      applyDrop(statusId, null, null);
      clearDragState();
    },
    [applyDrop, clearDragState, draggedTaskId]
  );

  const handleDropOnTask = useCallback(
    (event: React.DragEvent<HTMLDivElement>, task: BoardTaskItem) => {
      event.preventDefault();
      if (!draggedTaskId) {
        clearDragState();
        return;
      }
      const statusId = task.boardStatusId || resolveBoardStatusId(null);
      applyDrop(statusId, task.id, dragOverPosition);
      clearDragState();
    },
    [applyDrop, clearDragState, draggedTaskId, dragOverPosition, resolveBoardStatusId]
  );

  const resetTaskDraft = (statusId: string) => {
    setTaskDraft({
      title: "",
      description: "",
      statusId,
      priority: "medium",
      assigneeId: "",
      dueDate: "",
    });
  };

  const openNewTask = (statusId?: string | null) => {
    setEditingTask(null);
    const nextStatusId = statusId
      ? resolveBoardStatusId(statusId)
      : resolveStatusIdByCategory("todo");
    resetTaskDraft(nextStatusId);
    setIsTaskDialogOpen(true);
  };

  const openEditTask = (task: BoardTaskItem) => {
    const rawAssignee = task.assignee as { uid?: string; id?: string } | undefined;
    const assigneeNameKey =
      task.assigneeNameKey ||
      (task.assigneeName ? normalizePersonNameKey(task.assigneeName) : "");
    setEditingTask(task);
    setTaskDraft({
      title: task.title,
      description: task.description || "",
      statusId: task.boardStatusId || resolveBoardStatusId(null),
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
    if (!taskDraft.statusId) {
      toast({
        title: "Select a column",
        description: "Choose a column for this task before saving.",
        variant: "destructive",
      });
      return;
    }

    if (!activeBoardId) {
      toast({
        title: "Board not ready",
        description: "Select a board before saving tasks.",
        variant: "destructive",
      });
      return;
    }

    const assignee = peopleById.get(taskDraft.assigneeId || "");
    const assigneePayload = assignee
      ? { id: assignee.id, name: assignee.name, email: assignee.email || undefined }
      : null;
    const taskUpdates = {
      title: taskDraft.title.trim(),
      description: taskDraft.description.trim(),
      priority: taskDraft.priority,
      assignee: assigneePayload,
      assigneeName: assignee?.name || null,
      dueAt: normalizeDateInput(taskDraft.dueDate),
    };

    try {
      if (editingTask) {
        const updated = await apiFetch<BoardTaskItem>(
          `/api/workspaces/${_workspaceId}/boards/${activeBoardId}/items/${editingTask.boardItemId}`,
          {
            method: "PATCH",
            body: JSON.stringify({
              statusId: taskDraft.statusId,
              taskUpdates,
            }),
          }
        );
        setTasks((prev) =>
          prev.map((task) => (task.id === updated.id ? { ...task, ...updated } : task))
        );
      } else {
        const created = await apiFetch<BoardTaskItem>(
          `/api/workspaces/${_workspaceId}/boards/${activeBoardId}/items`,
          {
            method: "POST",
            body: JSON.stringify({
              ...taskUpdates,
              statusId: taskDraft.statusId,
            }),
          }
        );
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

  const handleDeleteTask = async (task: BoardTaskItem) => {
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

  const handleAssignTask = useCallback(
    (task: Task, person: Person | null) => {
      const assigneePayload = person
        ? { id: person.id, name: person.name, email: person.email || undefined }
        : null;
      updateBoardItem(task.id, {
        taskUpdates: {
          assignee: assigneePayload,
          assigneeName: person?.name || null,
        },
      });
    },
    [updateBoardItem]
  );

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

  const toggleStatusFilter = (statusId: string) => {
    setStatusFilters((prev) => {
      const next = new Set(prev);
      if (next.has(statusId)) {
        next.delete(statusId);
      } else {
        next.add(statusId);
      }
      if (!next.size) {
        next.add(statusId);
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

  useEffect(() => {
    if (!orderedStatuses.length) return;
    const statusIds = orderedStatuses.map((status) => status.id);
    setStatusFilters(new Set(statusIds));
    setBulkStatusId((prev) => (prev && statusIds.includes(prev) ? prev : statusIds[0]));
    setTaskDraft((prev) => ({
      ...prev,
      statusId: statusIds.includes(prev.statusId) ? prev.statusId : statusIds[0],
    }));
  }, [orderedStatuses]);

  const activeBoard = useMemo(
    () => boards.find((board) => board.id === activeBoardId) || null,
    [activeBoardId, boards]
  );

  const handleBoardChange = useCallback(
    (boardId: string) => {
      if (!boardId) return;
      setActiveBoardId(boardId);
      const params = new URLSearchParams(searchParamsString);
      params.set("boardId", boardId);
      router.replace(`/workspaces/${_workspaceId}/board?${params.toString()}`);
    },
    [_workspaceId, router, searchParamsString]
  );

  const handleBoardColorChange = useCallback(
    async (nextColor: string) => {
      if (!activeBoardId) return;
      const previous = boards;
      setBoards((prev) =>
        prev.map((board) =>
          board.id === activeBoardId ? { ...board, color: nextColor } : board
        )
      );
      try {
        await apiFetch(
          `/api/workspaces/${_workspaceId}/boards/${activeBoardId}`,
          {
            method: "PATCH",
            body: JSON.stringify({ color: nextColor }),
          }
        );
      } catch (error) {
        console.error("Failed to update board color:", error);
        setBoards(previous);
        toast({
          title: "Could not update board color",
          description: error instanceof Error ? error.message : "Try again in a moment.",
          variant: "destructive",
        });
      }
    },
    [_workspaceId, activeBoardId, boards, toast]
  );

  const openBoardDialog = () => {
    setNewBoardName("");
    setNewBoardDescription("");
    setNewBoardTemplateId(DEFAULT_BOARD_TEMPLATE_ID);
    setNewBoardColor("#2563eb");
    setIsBoardDialogOpen(true);
  };

  const handleCreateBoard = useCallback(async () => {
    const name = newBoardName.trim();
    if (!name) {
      toast({
        title: "Board name required",
        description: "Give your board a name before creating it.",
        variant: "destructive",
      });
      return;
    }

    try {
      const created = await apiFetch<Board>(
        `/api/workspaces/${_workspaceId}/boards`,
        {
          method: "POST",
          body: JSON.stringify({
            name,
            description: newBoardDescription.trim() || null,
            templateId: newBoardTemplateId,
            color: newBoardColor,
          }),
        }
      );
      setBoards((prev) => [...prev, created]);
      handleBoardChange(created.id);
      setIsBoardDialogOpen(false);
    } catch (error) {
      console.error("Failed to create board:", error);
      toast({
        title: "Could not create board",
        description: error instanceof Error ? error.message : "Try again in a moment.",
        variant: "destructive",
      });
    }
  }, [
    _workspaceId,
    handleBoardChange,
    newBoardDescription,
    newBoardName,
    newBoardTemplateId,
    newBoardColor,
    toast,
  ]);

  const selectedTemplate = useMemo(
    () =>
      BOARD_TEMPLATES.find((template) => template.id === newBoardTemplateId) ||
      BOARD_TEMPLATES[0],
    [newBoardTemplateId]
  );

  const openStageDialog = useCallback(() => {
    setNewStageLabel("");
    setNewStageCategory("todo");
    setNewStageColor("#2563eb");
    setIsStageDialogOpen(true);
  }, []);

  const handleCreateStage = useCallback(async () => {
    const label = newStageLabel.trim();
    if (!label) {
      toast({
        title: "Stage name required",
        description: "Add a label before creating the stage.",
        variant: "destructive",
      });
      return;
    }
    if (!activeBoardId) {
      toast({
        title: "Board not ready",
        description: "Select a board before adding stages.",
        variant: "destructive",
      });
      return;
    }

    try {
      const created = await apiFetch<BoardStatus>(
        `/api/workspaces/${_workspaceId}/boards/${activeBoardId}/statuses`,
        {
          method: "POST",
          body: JSON.stringify({
            label,
            category: newStageCategory,
            color: newStageColor,
          }),
        }
      );
      setBoardStatuses((prev) => [...prev, created]);
      setIsStageDialogOpen(false);
    } catch (error) {
      console.error("Failed to create stage:", error);
      toast({
        title: "Could not create stage",
        description: error instanceof Error ? error.message : "Try again in a moment.",
        variant: "destructive",
      });
    }
  }, [
    _workspaceId,
    activeBoardId,
    newStageCategory,
    newStageColor,
    newStageLabel,
    toast,
  ]);

  const openStageColorDialog = useCallback((status: BoardStatus) => {
    setStageToEdit(status);
    setStageColorDraft(status.color || "#2563eb");
    setIsStageColorDialogOpen(true);
  }, []);

  const handleUpdateStageColor = useCallback(async () => {
    if (!stageToEdit || !activeBoardId) {
      setIsStageColorDialogOpen(false);
      return;
    }
    const nextColor = stageColorDraft.trim();
    if (!nextColor) return;
    try {
      const updated = await apiFetch<BoardStatus>(
        `/api/workspaces/${_workspaceId}/boards/${activeBoardId}/statuses/${stageToEdit.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ color: nextColor }),
        }
      );
      setBoardStatuses((prev) =>
        prev.map((status) => (status.id === updated.id ? updated : status))
      );
      setIsStageColorDialogOpen(false);
      setStageToEdit(null);
    } catch (error) {
      console.error("Failed to update stage color:", error);
      toast({
        title: "Could not update stage",
        description: error instanceof Error ? error.message : "Try again in a moment.",
        variant: "destructive",
      });
    }
  }, [_workspaceId, activeBoardId, stageColorDraft, stageToEdit, toast]);

  const handleDeleteStage = useCallback(async () => {
    if (!stageToDelete || !activeBoardId) {
      setStageToDelete(null);
      return;
    }
    try {
      await apiFetch(
        `/api/workspaces/${_workspaceId}/boards/${activeBoardId}/statuses/${stageToDelete.id}`,
        { method: "DELETE" }
      );
      setBoardStatuses((prev) => prev.filter((status) => status.id !== stageToDelete.id));
      setStageToDelete(null);
    } catch (error) {
      console.error("Failed to delete stage:", error);
      toast({
        title: "Could not delete stage",
        description: error instanceof Error ? error.message : "Stage may still have tasks.",
        variant: "destructive",
      });
    }
  }, [_workspaceId, activeBoardId, stageToDelete, toast]);

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
    async (
      nextTasks: BoardTaskItem[],
      payload: { taskIds: string[]; updates?: Record<string, any>; statusId?: string }
    ) => {
      if (!activeBoardId || !payload.taskIds.length) return;
      const previous = tasks;
      setTasks(nextTasks);
      try {
        await apiFetch(
          `/api/workspaces/${_workspaceId}/boards/${activeBoardId}/items/bulk`,
          {
            method: "POST",
            body: JSON.stringify(payload),
          }
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
    [activeBoardId, _workspaceId, clearSelection, tasks, toast]
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
      await applyBulkUpdates(nextTasks, {
        taskIds: selectedTasks.map((task) => task.id),
        updates: {
          assignee: assigneePayload,
          assigneeName: person.name,
        },
      });
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
      await applyBulkUpdates(nextTasks, {
        taskIds: selectedTasks.map((task) => task.id),
        updates: { dueAt },
      });
      setIsSetDueDateDialogOpen(false);
    },
    [applyBulkUpdates, selectedTaskIds, selectedTasks, tasks]
  );

  const openStatusDialog = useCallback(() => {
    if (!selectedTasks.length) return;
    const uniqueStatuses = new Set(
      selectedTasks.map((task) => task.boardStatusId || resolveBoardStatusId(null))
    );
    if (uniqueStatuses.size === 1) {
      setBulkStatusId(Array.from(uniqueStatuses)[0]);
    }
    setIsStatusDialogOpen(true);
  }, [resolveBoardStatusId, selectedTasks]);

  const handleBulkStatusChange = useCallback(async () => {
    if (!selectedTasks.length) {
      setIsStatusDialogOpen(false);
      return;
    }

    const targetStatusId = resolveBoardStatusId(bulkStatusId);
    if (!targetStatusId) {
      setIsStatusDialogOpen(false);
      return;
    }
    const targetStatusMeta = getStatusMeta(targetStatusId);
    const targetCategory = targetStatusMeta?.category || "todo";

    const maxRankByStatus = new Map<string, number>();
    tasks.forEach((task) => {
      const statusId = task.boardStatusId || resolveBoardStatusId(null);
      const rank = typeof task.boardRank === "number" ? task.boardRank : 0;
      const currentMax = maxRankByStatus.get(statusId) ?? 0;
      if (rank > currentMax) {
        maxRankByStatus.set(statusId, rank);
      }
    });

    let nextRank = maxRankByStatus.get(targetStatusId) ?? 0;
    const taskIdsToUpdate = new Set(
      selectedTasks
        .filter((task) => task.boardStatusId !== targetStatusId)
        .map((task) => task.id)
    );
    if (!taskIdsToUpdate.size) {
      setIsStatusDialogOpen(false);
      return;
    }
    const nextTasks = tasks.map((task) => {
      if (!selectedTaskIds.has(task.id)) return task;
      if (!taskIdsToUpdate.has(task.id)) return task;
      nextRank += 1000;
      return {
        ...task,
        boardStatusId: targetStatusId,
        boardRank: nextRank,
        status: targetCategory,
      };
    });

    await applyBulkUpdates(nextTasks, {
      taskIds: Array.from(taskIdsToUpdate),
      statusId: targetStatusId,
    });
    setIsStatusDialogOpen(false);
  }, [
    applyBulkUpdates,
    bulkStatusId,
    selectedTaskIds,
    selectedTasks,
    tasks,
    getStatusMeta,
    resolveBoardStatusId,
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
          const totalTasksForStatus = totalTasksByStatus.get(status.id) || 0;
          return (
            <div
              key={status.id}
              onDragOver={(event) => handleDragOverColumn(event, status.id)}
              onDrop={(event) => handleDropOnColumn(event, status.id)}
              className={cn(
                "flex h-full w-80 shrink-0 flex-col rounded-xl border border-border/50 bg-card/60",
                dragOverColumn === status.id ? "ring-2 ring-primary/30 bg-primary/5" : ""
              )}
            >
              <div
                className="p-3 flex items-center justify-between sticky top-0 border-b border-t-2 border-border/40 rounded-t-xl"
                style={{
                  backgroundColor: applyHexAlpha(status.color, 0.12),
                  borderTopColor: status.color,
                }}
              >
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
                      <DropdownMenuItem onSelect={() => openStageColorDialog(status)}>
                        Change color
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() => setStageToDelete(status)}
                        disabled={totalTasksForStatus > 0 || orderedStatuses.length <= 1}
                        className="text-destructive focus:text-destructive"
                      >
                        Delete stage
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
              <div className="flex-1 p-3 flex flex-col gap-3 overflow-y-auto">
                {columnTasks.map((task) => (
                  <BoardTaskCard
                    key={task.id}
                    task={task}
                    assigneeName={getAssigneeName(task)}
                    assigneePerson={getAssigneePerson(task)}
                    people={people}
                    onEdit={() => openEditTask(task)}
                    onDelete={() => handleDeleteTask(task)}
                    onOpen={() => openEditTask(task)}
                    onAssign={handleAssignTask}
                    onDragStart={(event) => handleDragStart(event, task.id)}
                    onDragOver={(event) => handleDragOverTask(event, task)}
                    onDrop={(event) => handleDropOnTask(event, task)}
                    onDragEnd={clearDragState}
                    isDragging={draggedTaskId === task.id}
                    isDragOver={dragOverTaskId === task.id}
                    dragPosition={dragOverPosition}
                    dragDisabled={false}
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
        <button
          type="button"
          onClick={openStageDialog}
          className="flex h-full w-72 shrink-0 flex-col items-center justify-center rounded-xl border border-dashed border-border/60 bg-muted/20 text-sm font-medium text-muted-foreground transition hover:bg-muted/40"
        >
          <Plus className="mb-2 h-4 w-4" />
          Add stage
        </button>
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
              const statusId = task.boardStatusId || resolveBoardStatusId(null);
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
                      <button
                        type="button"
                        data-no-drag
                        onClick={() => openEditTask(task)}
                        className="text-left text-sm font-medium text-foreground truncate hover:text-primary"
                      >
                        {task.title}
                      </button>
                      {task.description ? (
                        <p className="text-xs text-muted-foreground truncate max-w-[220px]">
                          {task.description}
                        </p>
                      ) : null}
                    </div>
                  </div>

                  <div className="col-span-2 flex items-center gap-2 text-sm text-muted-foreground">
                    {getStatusIcon(statusMeta?.category, statusMeta?.color || "currentColor")}
                    <span className="capitalize">{statusMeta?.label || "Status"}</span>
                  </div>

                  <div className="col-span-2">
                    <PriorityBadge priority={task.priority || "medium"} />
                  </div>

                  <div className="col-span-2 text-sm text-muted-foreground">{dueLabel}</div>

                  <div className="col-span-1 flex justify-end">
                    <AssigneeDropdown
                      task={task}
                      assigneeName={assigneeName}
                      assigneePerson={assigneePerson}
                      people={people}
                      onAssign={handleAssignTask}
                    />
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
          <div className="flex items-center gap-2">
            <Select
              value={activeBoardId || ""}
              onValueChange={handleBoardChange}
              disabled={!boards.length}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Select board" />
              </SelectTrigger>
              <SelectContent>
                {boards.map((board) => (
                  <SelectItem key={board.id} value={board.id}>
                    <div className="flex items-center gap-2">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: board.color || "#2563eb" }}
                      />
                      <span>{board.name}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={openBoardDialog}>
              <Plus className="mr-2 h-4 w-4" />
              New board
            </Button>
            <div className="flex items-center gap-2">
              <Palette className="h-4 w-4 text-muted-foreground" />
              <Input
                type="color"
                value={activeBoard?.color || "#2563eb"}
                onChange={(event) => handleBoardColorChange(event.target.value)}
                className="h-9 w-12 p-1"
                disabled={!activeBoard}
              />
            </div>
          </div>

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

          <Button size="sm" onClick={() => openNewTask()}>
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

      <Dialog open={isBoardDialogOpen} onOpenChange={setIsBoardDialogOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Create a new board</DialogTitle>
            <DialogDescription>
              Start from a template to get the right columns instantly.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="board-name">Board name</Label>
              <Input
                id="board-name"
                value={newBoardName}
                onChange={(event) => setNewBoardName(event.target.value)}
                placeholder="e.g. Product roadmap"
              />
            </div>
            <div>
              <Label htmlFor="board-description">Description</Label>
              <Textarea
                id="board-description"
                value={newBoardDescription}
                onChange={(event) => setNewBoardDescription(event.target.value)}
                placeholder="Optional context for your team"
              />
            </div>
            <div>
              <Label>Template</Label>
              <Select
                value={newBoardTemplateId}
                onValueChange={(value) => setNewBoardTemplateId(value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose a template" />
                </SelectTrigger>
                <SelectContent>
                  {BOARD_TEMPLATES.map((template) => (
                    <SelectItem key={template.id} value={template.id}>
                      {template.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedTemplate ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  {selectedTemplate.description}
                </p>
              ) : null}
            </div>
            <div>
              <Label htmlFor="board-color">Board color</Label>
              <Input
                id="board-color"
                type="color"
                value={newBoardColor}
                onChange={(event) => setNewBoardColor(event.target.value)}
                className="h-10 w-16 p-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsBoardDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateBoard}>Create board</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isStageDialogOpen} onOpenChange={setIsStageDialogOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Add a stage</DialogTitle>
            <DialogDescription>
              Create a new column for this board.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="stage-label">Stage name</Label>
              <Input
                id="stage-label"
                value={newStageLabel}
                onChange={(event) => setNewStageLabel(event.target.value)}
                placeholder="e.g. QA Review"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label>Category</Label>
                <Select
                  value={newStageCategory}
                  onValueChange={(value) =>
                    setNewStageCategory(value as BoardStatusCategory)
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Pick a category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todo">To do</SelectItem>
                    <SelectItem value="inprogress">In progress</SelectItem>
                    <SelectItem value="done">Done</SelectItem>
                    <SelectItem value="recurring">Recurring</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="stage-color">Header color</Label>
                <Input
                  id="stage-color"
                  type="color"
                  value={newStageColor}
                  onChange={(event) => setNewStageColor(event.target.value)}
                  className="h-10 w-16 p-1"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsStageDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateStage}>Add stage</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isStageColorDialogOpen}
        onOpenChange={(open) => {
          setIsStageColorDialogOpen(open);
          if (!open) setStageToEdit(null);
        }}
      >
        <DialogContent className="sm:max-w-[360px]">
          <DialogHeader>
            <DialogTitle>Stage color</DialogTitle>
            <DialogDescription>
              Update the header color for this stage.
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label htmlFor="stage-color-update">Color</Label>
            <Input
              id="stage-color-update"
              type="color"
              value={stageColorDraft}
              onChange={(event) => setStageColorDraft(event.target.value)}
              className="h-10 w-16 p-1"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsStageColorDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button onClick={handleUpdateStageColor}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(stageToDelete)} onOpenChange={() => setStageToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete stage?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the stage if it has no tasks assigned. You cannot undo this action.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteStage}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
                  value={taskDraft.statusId}
                  onValueChange={(value) =>
                    setTaskDraft((prev) => ({ ...prev, statusId: value }))
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
                value={bulkStatusId}
                onValueChange={(value) => setBulkStatusId(value)}
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
