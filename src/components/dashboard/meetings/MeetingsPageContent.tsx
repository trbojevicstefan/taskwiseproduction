
// src/components/dashboard/meetings/MeetingsPageContent.tsx
"use client";

import React, { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { v4 as uuidv4 } from "uuid";
import { motion } from "framer-motion";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Checkbox } from "@/components/ui/checkbox";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Users,
  MessageSquareText,
  ListTodo,
  Brain,
  Clock,
  ChevronDown,
  PlayCircle,
  ClipboardCheck,
  Search,
  Filter,
  Sparkles,
  FileText,
  Download,
  Link2,
  MoreHorizontal,
  Mic,
  Loader2,
  ChevronLeft,
  Webhook,
  ClipboardPaste,
  Video,
  UserPlus,
  Trash2,
  Edit2,
  Copy,
  CalendarDays,
  Edit3,
  Info,
  Paperclip,
  RefreshCw,
  UserCheck,
  Megaphone,
  ArrowUpRight,
  Languages,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { isValid } from 'date-fns';
import DashboardHeader from "../DashboardHeader";
import { useMeetingHistory } from "@/contexts/MeetingHistoryContext";
import { useChatHistory } from "@/contexts/ChatHistoryContext";
import { format, formatDistanceToNow, isSameWeek, isToday, isYesterday } from 'date-fns';
import { useSearchParams, useRouter } from 'next/navigation';
import { useToast } from "@/hooks/use-toast";
import Link from 'next/link';
import type { Meeting } from "@/types/meeting";
import type { ExtractedTaskSchema } from '@/types/chat';
import AssignPersonDialog from '../planning/AssignPersonDialog';
import { useAuth } from '@/contexts/AuthContext';
import { onPeopleSnapshot, addPerson, normalizeTask, updatePerson } from '@/lib/data';
import { getBestPersonMatch } from '@/lib/people-matching';
import type { Person } from '@/types/person';
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api";
import SelectionToolbar from '../common/SelectionToolbar';
import SetDueDateDialog from '../planning/SetDueDateDialog';
import { exportTasksToCSV, exportTasksToMarkdown, exportTasksToPDF, copyTextToClipboard, formatTasksToText } from '@/lib/exportUtils';
import TaskDetailDialog from '../planning/TaskDetailDialog';
import ShareToSlackDialog from '../common/ShareToSlackDialog';
import { useIntegrations } from '@/contexts/IntegrationsContext';
import PushToGoogleTasksDialog from '../common/PushToGoogleTasksDialog';
import PushToTrelloDialog from "../common/PushToTrelloDialog";
import PeopleDiscoveryDialog from '../people/PeopleDiscoveryDialog';
import SelectionViewDialog from '../explore/SelectionViewDialog';
import { TASK_TYPE_LABELS, TASK_TYPE_VALUES, type TaskTypeCategory } from '@/lib/task-types';
import { useWorkspaceBoards } from "@/hooks/use-workspace-boards";
import { moveTaskToBoard } from "@/lib/board-actions";
import { buildBriefContext } from "@/lib/brief-context";
import { usePasteAction } from '@/contexts/PasteActionContext';


const flavorMap: Record<string, { name: string; color: string; icon: React.ReactNode }> = {
  sales: { name: "Sales", color: "bg-rose-500/80", icon: <FileText className="h-4 w-4" /> },
  ai: { name: "AI", color: "bg-fuchsia-500/80", icon: <Brain className="h-4 w-4" /> },
  ops: { name: "Ops", color: "bg-emerald-500/80", icon: <ClipboardCheck className="h-4 w-4" /> },
  data: { name: "Data", color: "bg-sky-500/80", icon: <FileText className="h-4 w-4" /> },
  product: { name: "Product", color: "bg-amber-500/80", icon: <Sparkles className="h-4 w-4" /> },
  marketing: { name: "Mktg", color: "bg-lime-500/80", icon: <FileText className="h-4 w-4" /> },
  client: { name: "Client", color: "bg-blue-500/80", icon: <Users className="h-4 w-4" /> },
  support: { name: "Support", color: "bg-slate-500/80", icon: <MessageSquareText className="h-4 w-4" /> },
  default: { name: "General", color: "bg-gray-500/80", icon: <MessageSquareText className="h-4 w-4" /> },
};

const taskTypeOrder = new Map<string, number>(
  TASK_TYPE_VALUES.map((type, index) => [type, index])
);

const toDateValue = (value: unknown) =>
  (value as { toDate?: () => Date })?.toDate ? (value as { toDate: () => Date }).toDate() : value ? new Date(value as string | number | Date) : null;

// Type guard: checks if item is a full ExtractedTaskSchema (not a reference)
const isExtractedTask = (item: ExtractedTaskSchema | { taskId: string; sourceTaskId: string; title: string }): item is ExtractedTaskSchema => {
  return 'id' in item && 'priority' in item;
};

// Helper: filters meeting.extractedTasks to only ExtractedTaskSchema items
const getExtractedTasks = (tasks: (ExtractedTaskSchema | { taskId: string; sourceTaskId: string; title: string })[] | undefined): ExtractedTaskSchema[] => {
  if (!tasks) return [];
  return tasks.filter(isExtractedTask);
};

const isTaskCompleted = (status?: ExtractedTaskSchema["status"] | null) => status === "done";

const getMeetingTaskCounts = (meeting: Meeting) => {
  const tasks = getExtractedTasks(meeting.extractedTasks);
  const total = tasks.length;
  const completed = tasks.reduce((count, task) => {
    return count + (isTaskCompleted(task.status) ? 1 : 0);
  }, 0);

  return {
    total,
    completed,
    open: total - completed,
  };
};

const TIMESTAMP_REGEX = /\b(\d{1,2}:)?\d{1,2}:\d{2}\b/g;

const getInitials = (name: string | null | undefined) =>
  name ? name.split(" ").map((part) => part[0]).join("").toUpperCase().substring(0, 2) : "U";

const getMeetingPersonKey = (person: { name: string; title?: string; email?: string }) => {
  const name = person.name?.trim().toLowerCase() || "";
  const email = person.email?.trim().toLowerCase() || "";
  const title = person.title?.trim().toLowerCase() || "";
  return `${name}|${email}|${title}`;
};

const parseTimestampToSeconds = (value: string) => {
  const parts = value.split(":").map((part) => Number(part));
  if (parts.some((part) => Number.isNaN(part))) return null;
  if (parts.length === 3) {
    const [hours, minutes, seconds] = parts;
    return hours * 3600 + minutes * 60 + seconds;
  }
  if (parts.length === 2) {
    const [minutes, seconds] = parts;
    return minutes * 60 + seconds;
  }
  return null;
};

const getTranscriptDurationMinutes = (transcript?: string | null) => {
  if (!transcript) return null;
  const matches = transcript.match(TIMESTAMP_REGEX);
  if (!matches) return null;

  let maxSeconds = 0;
  matches.forEach((match) => {
    const seconds = parseTimestampToSeconds(match);
    if (seconds !== null && seconds > maxSeconds) {
      maxSeconds = seconds;
    }
  });

  if (maxSeconds <= 0) return null;
  return Math.max(1, Math.round(maxSeconds / 60));
};

const getMeetingDurationMinutes = (meeting: Meeting | null) => {
  if (!meeting) return null;
  if (typeof meeting.duration === "number" && meeting.duration > 0) {
    return meeting.duration;
  }
  const start = toDateValue(meeting.startTime);
  const end = toDateValue(meeting.endTime);
  if (start && end && end > start) {
    return Math.max(1, Math.round((end.getTime() - start.getTime()) / 60000));
  }
  return getTranscriptDurationMinutes(meeting.originalTranscript);
};


function MeetingListItem({
  m,
  onOpen,
  onChat,
  isSelected,
  onToggleSelection,
  selectionDisabled = false,
}: {
  m: Meeting;
  onOpen: (id: string) => void;
  onChat: (meeting: Meeting) => void;
  isSelected: boolean;
  onToggleSelection: (checked: boolean) => void;
  selectionDisabled?: boolean;
}) {
  const router = useRouter();
  const flavor = flavorMap[(m.tags?.[0] || 'default').toLowerCase() as keyof typeof flavorMap] || flavorMap.default;
  const { total: actionCount, completed: completedActions } = getMeetingTaskCounts(m);

  const handleNavigation = (e: React.MouseEvent, path: string) => {
    e.stopPropagation();
    router.push(path);
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="text-left w-full group/item"
    >
      <div
        onClick={() => onOpen(m.id)}
        className="cursor-pointer relative rounded-xl border border-border/20 shadow-sm hover:border-primary/40 hover:shadow-lg transition-all h-full flex items-center p-3 gap-4 bg-card/60 dark:bg-black/30 hover:bg-card/90"
      >
        <div className={cn("w-1 self-stretch rounded-full", flavor.color)} />
        {selectionDisabled ? (
          <div className="h-4 w-4" />
        ) : (
          <Checkbox
            checked={isSelected}
            onCheckedChange={(checked) => onToggleSelection(!!checked)}
            onClick={(event) => event.stopPropagation()}
          />
        )}
        <div className="flex-1 grid grid-cols-12 gap-4 items-center">
          <div className="col-span-5 min-w-0">
            <p className="font-semibold text-foreground truncate">{m.title}</p>
            <p className="text-sm text-muted-foreground truncate">{m.summary || 'No summary available.'}</p>
          </div>
          <div className="col-span-2">
            <AvatarGroup people={m.attendees || []} />
          </div>
          <div className="col-span-2 flex items-center gap-2 text-sm text-muted-foreground">
            <ListTodo size={16} />
            <span>{actionCount} Actions</span>
            <span className="text-xs text-muted-foreground/80">| {completedActions} Completed</span>
          </div>
          <div className="col-span-2 text-sm text-muted-foreground">
            {toDateValue(m.lastActivityAt)
              ? formatDistanceToNow(toDateValue(m.lastActivityAt) as Date, { addSuffix: true })
              : 'Just now'}
          </div>
          <div className="col-span-1 flex justify-end opacity-0 group-hover/item:opacity-100 transition-opacity">
            <TooltipProvider>
              <div className="flex items-center gap-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 rounded-full"
                      onClick={(e) => handleNavigation(e, `/meetings/${m.id}`)}
                    >
                      <ArrowUpRight className="h-4 w-4 text-white/70" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Open Details</p>
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 rounded-full"
                      onClick={(e) => {
                        e.stopPropagation();
                        onChat(m);
                      }}
                    >
                      <MessageSquareText className="h-4 w-4 text-white/70" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Go to Chat</p>
                  </TooltipContent>
                </Tooltip>
              </div>
            </TooltipProvider>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function MeetingStatsBar({ meetings }: { meetings: Meeting[] }) {
  const total = meetings.length;
  const actionCounts = meetings.reduce(
    (counts, meeting) => {
      const { open, completed } = getMeetingTaskCounts(meeting);
      return {
        open: counts.open + open,
        completed: counts.completed + completed,
      };
    },
    { open: 0, completed: 0 }
  );
  const avgSent = total > 0 ? Math.round((meetings.reduce((s, m) => s + (m.overallSentiment || 0), 0) / total) * 100) : 0;

  const StatPill = ({ label, value }: { label: string; value: string | number }) => (
    <div className="flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium bg-card/80 border border-border/30 shadow-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold text-foreground">{value}</span>
    </div>
  );

  return (
    <div className="flex flex-wrap items-center gap-3">
      <StatPill label="Total Meetings" value={total} />
      <StatPill label="Open Actions" value={actionCounts.open} />
      <StatPill label="Completed Actions" value={actionCounts.completed} />
      {avgSent > 0 && <StatPill label="Avg. Sentiment" value={`${avgSent}%`} />}
    </div>
  );
}

function DateSeparator({ label }: { label: string }) {
  return (
    <div className="flex items-center my-6" aria-label={`Date group: ${label}`}>
      <Separator className="flex-1" />
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mx-4">
        {label}
      </h2>
      <Separator className="flex-1" />
    </div>
  );
}

const getTaskAndAllDescendantIds = (task: ExtractedTaskSchema): string[] => {
  if (!task) return [];
  const ids = [task.id];
  if (task.subtasks) {
    task.subtasks.forEach(sub => ids.push(...getTaskAndAllDescendantIds(sub)));
  }
  return ids;
};

const getStatusLabel = (status?: ExtractedTaskSchema["status"] | null) => {
  switch (status) {
    case "done":
      return "Done";
    case "inprogress":
      return "In Progress";
    case "recurring":
      return "Recurring";
    case "todo":
    default:
      return "To Do";
  }
};

const getStatusVariant = (status?: ExtractedTaskSchema["status"] | null) => {
  if (status === "done") return "default";
  if (status === "inprogress") return "outline";
  if (status === "recurring") return "secondary";
  return "secondary";
};

const TaskRow: React.FC<{
  task: ExtractedTaskSchema;
  onAssign: () => void;
  onDelete: () => void;
  onConfirmCompletion?: (task: ExtractedTaskSchema) => void;
  onDismissCompletion?: (task: ExtractedTaskSchema) => void;
  onToggleSelection: (id: string, checked: boolean) => void;
  onViewDetails: (task: ExtractedTaskSchema) => void;
  isSelected: boolean;
  isIndeterminate: boolean;
  selectionDisabled?: boolean;
  level: number;
  selectedTaskIds: Set<string>;
  getCheckboxState: (task: ExtractedTaskSchema, selectedIds: Set<string>) => 'checked' | 'unchecked' | 'indeterminate';
}> = ({ task, onAssign, onDelete, onConfirmCompletion, onDismissCompletion, onToggleSelection, onViewDetails, isSelected, isIndeterminate, selectionDisabled, level, selectedTaskIds, getCheckboxState }) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const hasSubtasks = task.subtasks && task.subtasks.length > 0;
  const assigneeName = task.assignee?.name || task.assigneeName || 'Unassigned';
  const isCompletionSuggested = Boolean(task.completionSuggested);
  const completionEvidence = task.completionEvidence?.[0]?.snippet;

  return (
    <div className={cn("flex flex-col", level > 0 && "pl-5 mt-2 border-l-2 border-border/30")}>
      <div className="flex items-start justify-between gap-3 rounded-xl border bg-card px-3 py-2 group">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {selectionDisabled ? (
            <div className="h-4 w-4" />
          ) : (
            <Checkbox id={`task-${task.id}`} checked={isIndeterminate ? 'indeterminate' : isSelected} onCheckedChange={(checked) => onToggleSelection(task.id, !!checked)} />
          )}
          {hasSubtasks ? (
            <button onClick={() => setIsExpanded(!isExpanded)} className="p-1">
              <ChevronDown size={14} className={cn("transition-transform", !isExpanded && "-rotate-90")} />
            </button>
          ) : <div className="w-6" />}
          <div className="flex-1 min-w-0 cursor-pointer" onClick={() => onViewDetails(task)}>
            <p className="text-sm font-medium hover:underline">{task.title}</p>
            {task.description && <p className="text-xs text-muted-foreground mt-1">{task.description}</p>}
            <div className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
              <span className="font-medium">Owner:</span>
              <Button variant="link" size="xs" className="p-0 h-auto text-xs" onClick={(e) => { e.stopPropagation(); onAssign(); }}>
                {assigneeName}
              </Button>
              {task.dueAt && <span>-</span>}
              {task.dueAt && <span>Due {isValid(new Date(task.dueAt as string)) ? format(new Date(task.dueAt as string), 'MMM d') : 'N/A'}</span>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {task.taskType && (
            <Badge variant="outline" className="rounded-full text-[11px] capitalize">
              {TASK_TYPE_LABELS[task.taskType as TaskTypeCategory] || task.taskType}
            </Badge>
          )}
          {task.priority && <Badge variant={task.priority === 'high' ? 'destructive' : 'secondary'} className="rounded-full text-[11px] capitalize">{task.priority}</Badge>}
          {task.status && task.status !== "todo" && (
            <Badge variant={getStatusVariant(task.status)} className="rounded-full text-[11px] capitalize">
              {getStatusLabel(task.status)}
            </Badge>
          )}
          {isCompletionSuggested && (
            <Badge variant="outline" className="rounded-full text-[11px]">
              Needs Review
            </Badge>
          )}
          {completionEvidence && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7">
                    <Info className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs text-xs leading-snug">
                  {completionEvidence}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {isCompletionSuggested && (
            <div className="flex items-center gap-1">
              <Button
                size="xs"
                className="h-7"
                onClick={(e) => {
                  e.stopPropagation();
                  onConfirmCompletion?.(task);
                }}
              >
                Confirm
              </Button>
              <Button
                size="xs"
                variant="ghost"
                className="h-7"
                onClick={(e) => {
                  e.stopPropagation();
                  onDismissCompletion?.(task);
                }}
              >
                Dismiss
              </Button>
            </div>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 opacity-0 group-hover:opacity-100"><MoreHorizontal className="h-4 w-4" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onSelect={() => onViewDetails(task)}><Edit3 className="mr-2 h-4 w-4" />Edit Details</DropdownMenuItem>
              <DropdownMenuItem onSelect={onAssign}><UserPlus className="mr-2 h-4 w-4" />Assign</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onDelete} className="text-destructive focus:text-destructive"><Trash2 className="mr-2 h-4 w-4" />Delete</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {hasSubtasks && isExpanded && (
        <div className="mt-2 space-y-2">
          {task.subtasks?.map(subtask => (
            <TaskRow
              key={subtask.id}
              task={subtask}
              onAssign={onAssign}
              onDelete={onDelete}
              onConfirmCompletion={onConfirmCompletion}
              onDismissCompletion={onDismissCompletion}
              onViewDetails={onViewDetails}
              level={level + 1}
              onToggleSelection={onToggleSelection}
              isSelected={selectedTaskIds.has(subtask.id)}
              isIndeterminate={getCheckboxState(subtask, selectedTaskIds) === 'indeterminate'}
              selectionDisabled={selectionDisabled}
              selectedTaskIds={selectedTaskIds}
              getCheckboxState={getCheckboxState}
            />
          ))}
        </div>
      )}
    </div>
  );
};

function AvatarGroup({ people }: { people: { name: string; avatarUrl?: string | null }[] }) {
  const size = 6;
  return (
    <div className="flex -space-x-2">
      {(people || []).slice(0, 3).map((p, i) => (
        <Avatar key={p.name + i} className={`h-${size} w-${size} ring-2 ring-background border border-border`}>
          <AvatarImage src={p.avatarUrl || `https://api.dicebear.com/8.x/initials/svg?seed=${p.name}`} alt={p.name} />
          <AvatarFallback className="text-[10px]">{p.name.slice(0, 2)}</AvatarFallback>
        </Avatar>
      ))}
      {people.length > 3 && (
        <div className={`h-${size} w-${size} rounded-full bg-muted text-[10px] grid place-content-center ring-2 ring-background`}>+{people.length - 3}</div>
      )}
    </div>
  );
}

type MeetingPerson = { name: string; title?: string; email?: string; avatarUrl?: string | null };

function PersonRow({
  p,
  role,
  isSelected,
  onToggleSelection,
  onOpen,
  isInDirectory,
  isBlocked = false,
}: {
  p: MeetingPerson;
  role: "attendee" | "mentioned";
  isSelected: boolean;
  onToggleSelection: (checked: boolean) => void;
  onOpen: () => void;
  isInDirectory: boolean;
  isBlocked?: boolean;
}) {
  return (
    <div
      className="flex items-center justify-between gap-3 rounded-xl border bg-card px-3 py-2 cursor-pointer transition-colors hover:border-primary/40"
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      role="button"
      tabIndex={0}
    >
      <div className="flex items-center gap-3 min-w-0">
        <Checkbox
          checked={isSelected}
          onCheckedChange={(checked) => onToggleSelection(!!checked)}
          onClick={(e) => e.stopPropagation()}
          disabled={isBlocked}
        />
        <Avatar className="h-8 w-8">
          <AvatarImage src={p.avatarUrl || `https://api.dicebear.com/8.x/initials/svg?seed=${p.name}`} />
          <AvatarFallback>{getInitials(p.name)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{p.name}</p>
          <p className="text-xs text-muted-foreground truncate">
            {p.title || ""}
            {p.title && p.email ? " | " : ""}
            {p.email || ""}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Badge variant={isInDirectory ? "secondary" : "outline"} className="text-[10px]">
          {isInDirectory ? "Saved" : "New"}
        </Badge>
        {isBlocked && (
          <Badge variant="destructive" className="text-[10px]">
            Blocked
          </Badge>
        )}
        <Badge variant={role === "attendee" ? "default" : "secondary"} className="capitalize">
          {role}
        </Badge>
      </div>
    </div>
  );
}

function MomentRow({ m }: { m: { timestamp: string; description: string } }) {
  return (
    <div className="flex items-center justify-between rounded-xl border bg-muted/30 px-3 py-2">
      <div className="flex items-center gap-2 text-sm">
        <Clock className="h-4 w-4" />
        <span className="tabular-nums">{m.timestamp}</span>
        <span>-</span>
        <span>{m.description}</span>
      </div>
    </div>
  );
}

function ArtifactsSection({ meeting }: { meeting: Meeting }) {
  const { artifacts, originalTranscript } = meeting;
  const { toast } = useToast();
  const { updateMeeting } = useMeetingHistory();
  const [isTranslateOpen, setIsTranslateOpen] = useState(false);
  const [targetLanguage, setTargetLanguage] = useState("English");
  const [isTranslating, setIsTranslating] = useState(false);

  const allArtifacts = artifacts || [];
  const translationArtifacts = allArtifacts.filter(
    (artifact) => artifact.type === "transcript_translation"
  );
  const fileArtifacts = allArtifacts.filter(
    (artifact) => artifact.type !== "transcript_translation"
  );
  const hasFileArtifacts = fileArtifacts.length > 0;
  const hasTranslations = translationArtifacts.length > 0;

  const handleCopyTranscript = async () => {
    if (!originalTranscript) return;
    const result = await copyTextToClipboard(originalTranscript);
    if (result.success) {
      toast({ title: "Transcript copied", description: "The full transcript is on your clipboard." });
    } else {
      toast({ title: "Copy failed", description: "Could not copy the transcript.", variant: "destructive" });
    }
  };

  const handleCopyTranslation = async (text: string, languageLabel: string) => {
    const result = await copyTextToClipboard(text);
    if (result.success) {
      toast({
        title: "Translation copied",
        description: `The ${languageLabel} transcript is on your clipboard.`,
      });
    } else {
      toast({
        title: "Copy failed",
        description: "Could not copy the translated transcript.",
        variant: "destructive",
      });
    }
  };

  const handleTranslateTranscript = async () => {
    if (!originalTranscript) {
      toast({
        title: "Transcript missing",
        description: "This meeting does not have a transcript to translate.",
        variant: "destructive",
      });
      return;
    }
    const language = targetLanguage.trim();
    if (!language) {
      toast({ title: "Language required", variant: "destructive" });
      return;
    }
    const normalizedLanguage = language.toLowerCase();
    const existingTranslation = translationArtifacts.find(
      (artifact) => (artifact.language || "").toLowerCase() === normalizedLanguage
    );
    if (existingTranslation) {
      toast({
        title: "Already translated",
        description: `A ${language} translation already exists.`,
      });
      return;
    }

    setIsTranslating(true);
    try {
      const response = await fetch(`/api/meetings/${meeting.id}/translate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetLanguage: language }),
      });
      const responseText = await response.text();
      let payload: Record<string, unknown> = {};
      if (responseText) {
        try {
          payload = JSON.parse(responseText) as Record<string, unknown>;
        } catch {
          payload = {};
        }
      }
      if (!response.ok) {
        const baseMessage =
          (payload?.error as string | undefined) ||
          `Translation failed (HTTP ${response.status}).`;
        const details = payload?.details ? ` ${payload.details}` : "";
        const model = payload?.model ? ` Model: ${payload.model}.` : "";
        const reference = payload?.reference ? ` Ref: ${payload.reference}.` : "";
        const fallbackDetails = !details && responseText
          ? ` Response: ${responseText.slice(0, 300).replace(/\s+/g, " ")}`
          : "";
        throw new Error(
          `${baseMessage}${details}${fallbackDetails}${model}${reference}`.trim()
        );
      }
      const translatedTranscript = payload?.translatedTranscript;
      if (typeof translatedTranscript !== "string" || !translatedTranscript.trim()) {
        throw new Error("Translation returned empty output.");
      }

      const newArtifact = {
        artifactId: uuidv4(),
        type: "transcript_translation" as const,
        driveFileId: language,
        storagePath: "",
        processedText: translatedTranscript,
        status: "available" as const,
        language,
        createdAt: new Date().toISOString(),
      };
      const updatedArtifacts = [...allArtifacts, newArtifact];
      await updateMeeting(meeting.id, { artifacts: updatedArtifacts });
      toast({
        title: "Translation saved",
        description: `Transcript translated to ${language}.`,
      });
      setIsTranslateOpen(false);
    } catch (error) {
      console.error("Transcript translation failed:", error);
      toast({
        title: "Translation failed",
        description:
          error instanceof Error
            ? error.message
            : "Could not translate the transcript.",
        variant: "destructive",
      });
    } finally {
      setIsTranslating(false);
    }
  };

  const getIconForType = (type: string) => {
    switch (type) {
      case "transcript":
        return <FileText className="h-5 w-5 text-blue-500" />;
      case "recording":
        return <Mic className="h-5 w-5 text-red-500" />;
      case "chat":
        return <MessageSquareText className="h-5 w-5 text-green-500" />;
      case "transcript_translation":
        return <Languages className="h-5 w-5 text-purple-500" />;
      default:
        return <Paperclip className="h-5 w-5 text-muted-foreground" />;
    }
  };

  return (
    <>
      <div className="space-y-4">
        {originalTranscript && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Full Transcript
              </CardTitle>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1"
                  onClick={handleCopyTranscript}
                >
                  <Copy className="h-3.5 w-3.5" />
                  Copy
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1"
                  onClick={() => setIsTranslateOpen(true)}
                  disabled={isTranslating}
                >
                  <Languages className="h-3.5 w-3.5" />
                  Translate
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-48">
                <pre className="text-xs whitespace-pre-wrap font-mono text-muted-foreground">
                  {originalTranscript}
                </pre>
              </ScrollArea>
            </CardContent>
          </Card>
        )}

        {translationArtifacts.map((artifact, index) => {
          const translatedText = artifact.processedText;
          if (!translatedText) return null;
          const languageLabel = artifact.language || artifact.driveFileId || "Translation";
          return (
            <Card key={artifact.artifactId || `${languageLabel}-${index}`}>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Languages className="h-4 w-4" />
                  Translated Transcript ({languageLabel})
                </CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1"
                  onClick={() => handleCopyTranslation(translatedText, languageLabel)}
                >
                  <Copy className="h-3.5 w-3.5" />
                  Copy
                </Button>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-48">
                  <pre className="text-xs whitespace-pre-wrap font-mono text-muted-foreground">
                    {translatedText}
                  </pre>
                </ScrollArea>
              </CardContent>
            </Card>
          );
        })}

        {hasFileArtifacts &&
          fileArtifacts.map((artifact, index) => (
            <a
              key={artifact.artifactId || index}
              href={artifact.storagePath}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between p-3 rounded-lg border bg-muted/30 hover:bg-muted/50 transition-colors"
            >
              <div className="flex items-center gap-3">
                {getIconForType(artifact.type)}
                <div className="flex flex-col">
                  <span className="font-semibold text-sm capitalize">{artifact.type}</span>
                  <span className="text-xs text-muted-foreground">{artifact.driveFileId}</span>
                </div>
              </div>
              <Download className="h-4 w-4 text-muted-foreground" />
            </a>
          ))}

        {!hasFileArtifacts && !originalTranscript && !hasTranslations && (
          <div className="text-center py-8">
            <p className="text-muted-foreground">No artifacts or transcript found for this meeting.</p>
          </div>
        )}
      </div>

      <Dialog open={isTranslateOpen} onOpenChange={setIsTranslateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Translate Transcript</DialogTitle>
            <DialogDescription>
              The translation keeps timestamps and formatting intact.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="translation-language">Target language</Label>
            <Input
              id="translation-language"
              placeholder="e.g. English, Spanish, French"
              value={targetLanguage}
              onChange={(event) => setTargetLanguage(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              We will preserve the original timestamps and layout.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsTranslateOpen(false)}
              disabled={isTranslating}
            >
              Cancel
            </Button>
            <Button onClick={handleTranslateTranscript} disabled={isTranslating}>
              {isTranslating ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Languages className="mr-2 h-4 w-4" />
              )}
              Translate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function MeetingDetailSheet({
  id,
  onClose,
  onNavigateToChat,
  variant = "sheet",
}: {
  id: string | null;
  onClose: () => void;
  onNavigateToChat: (meeting: Meeting) => void;
  variant?: "sheet" | "page";
}) {
  const { user } = useAuth();
  const workspaceId = user?.workspace?.id;
  const { boards } = useWorkspaceBoards(workspaceId);
  const { meetings, isLoadingMeetingHistory, updateMeeting, deleteMeeting, refreshMeetings } = useMeetingHistory();
  const { isSlackConnected, isGoogleTasksConnected, isTrelloConnected } = useIntegrations();
  const { updateSession } = useChatHistory();
  const [people, setPeople] = useState<Person[]>([]);
  const [isLoadingPeople, setIsLoadingPeople] = useState(true);
  const [isAssignDialogOpen, setIsAssignDialogOpen] = useState(false);
  const [taskToAssign, setTaskToAssign] = useState<ExtractedTaskSchema | null>(null);
  const [filterByPerson, setFilterByPerson] = useState<string>('all');
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);
  const [isRescanLoading, setIsRescanLoading] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editableTitle, setEditableTitle] = useState("");
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [selectedPeopleKeys, setSelectedPeopleKeys] = useState<Set<string>>(new Set());
  const [isSetDueDateDialogOpen, setIsSetDueDateDialogOpen] = useState(false);
  const [isTaskDetailDialogVisible, setIsTaskDetailDialogVisible] = useState(false);
  const [taskForDetailView, setTaskForDetailView] = useState<ExtractedTaskSchema | null>(null);
  const [isShareToSlackOpen, setIsShareToSlackOpen] = useState(false);
  const [isPushToGoogleOpen, setIsPushToGoogleOpen] = useState(false);
  const [isPushToTrelloOpen, setIsPushToTrelloOpen] = useState(false);
  const [isDiscoveryDialogOpen, setIsDiscoveryDialogOpen] = useState(false);
  const [isSelectionViewVisible, setIsSelectionViewVisible] = useState(false);
  const [activePerson, setActivePerson] = useState<{
    person: MeetingPerson;
    role: "attendee" | "mentioned";
    existingPerson: Person | null;
  } | null>(null);
  const lastMeetingIdRef = useRef<string | null>(null);

  const meeting = useMemo(() => meetings.find((m) => m.id === id) || null, [id, meetings]);
  const { toast } = useToast();
  const isPageVariant = variant === "page";

  const syncMeetingTasks = useCallback(
    async (tasks: ExtractedTaskSchema[]) => {
      if (!meeting) return null;
      const sanitized = tasks.map((task) => normalizeTask(task));
      const updated = await updateMeeting(meeting.id, { extractedTasks: sanitized });
      const chatSessionId = updated?.chatSessionId || meeting.chatSessionId;
      if (chatSessionId) {
        await updateSession(chatSessionId, { suggestedTasks: sanitized });
      }
      return updated;
    },
    [meeting, updateMeeting, updateSession]
  );

  const getCheckboxState = useCallback((task: ExtractedTaskSchema, currentSelectedIds: Set<string>): 'checked' | 'unchecked' | 'indeterminate' => {
    if (!task.subtasks || task.subtasks.length === 0) {
      return currentSelectedIds.has(task.id) ? 'checked' : 'unchecked';
    }
    const allDescendantIds = getTaskAndAllDescendantIds(task).slice(1);
    const selectedDescendantsCount = allDescendantIds.filter(id => currentSelectedIds.has(id)).length;

    if (selectedDescendantsCount === 0 && !currentSelectedIds.has(task.id)) {
      return 'unchecked';
    }
    if (selectedDescendantsCount === allDescendantIds.length && currentSelectedIds.has(task.id)) {
      return 'checked';
    }
    return 'indeterminate';
  }, []);


  const handleToggleSelection = useCallback((taskId: string, isSelected: boolean) => {
    setSelectedTaskIds(prev => {
      const newSet = new Set(prev);
      if (!meeting?.extractedTasks) return newSet;

      const findTaskRecursive = (tasks: ExtractedTaskSchema[], idToFind: string): ExtractedTaskSchema | null => {
        for (const task of tasks) {
          if (task.id === idToFind) return task;
          if (task.subtasks) {
            const found = findTaskRecursive(task.subtasks, idToFind);
            if (found) return found;
          }
        }
        return null;
      };

      const task = findTaskRecursive(getExtractedTasks(meeting.extractedTasks), taskId);

      if (!task) return newSet; // Safe guard

      const taskAndDescendants = getTaskAndAllDescendantIds(task);

      taskAndDescendants.forEach(id => {
        if (isSelected) newSet.add(id);
        else newSet.delete(id);
      });
      return newSet;
    });
  }, [meeting]);

  const handleSelectAll = (checked: boolean) => {
    setSelectedTaskIds(checked ? allMeetingTaskIds : new Set<string>());
  };

  const getGroupTaskIds = useCallback((tasks: ExtractedTaskSchema[]) => {
    const ids = new Set<string>();
    tasks.forEach((task) => {
      getTaskAndAllDescendantIds(task).forEach((id) => ids.add(id));
    });
    return ids;
  }, []);

  const getGroupCheckboxState = useCallback((tasks: ExtractedTaskSchema[], currentSelectedIds: Set<string>) => {
    const groupIds = Array.from(getGroupTaskIds(tasks));
    if (groupIds.length === 0) return "unchecked";
    const selectedCount = groupIds.filter((id) => currentSelectedIds.has(id)).length;
    if (selectedCount === 0) return "unchecked";
    if (selectedCount === groupIds.length) return "checked";
    return "indeterminate";
  }, [getGroupTaskIds]);

  const handleToggleGroupSelection = useCallback((tasks: ExtractedTaskSchema[], isSelected: boolean) => {
    setSelectedTaskIds((prev) => {
      const next = new Set(prev);
      const groupIds = getGroupTaskIds(tasks);
      groupIds.forEach((id) => {
        if (isSelected) next.add(id);
        else next.delete(id);
      });
      return next;
    });
  }, [getGroupTaskIds]);

  useEffect(() => {
    if (user?.uid) {
      setIsLoadingPeople(true);
      const unsubscribe = onPeopleSnapshot(user.uid, (loadedPeople) => {
        setPeople(loadedPeople);
        setIsLoadingPeople(false);
      });
      return () => unsubscribe();
    }
  }, [user]);

  const peopleByName = useMemo(() => {
    return new Map(people.map((person) => [person.name.toLowerCase(), person]));
  }, [people]);

  const peopleByEmail = useMemo(() => {
    return new Map(
      people
        .filter((person) => person.email)
        .map((person) => [person.email!.toLowerCase(), person])
    );
  }, [people]);

  const blockedPeopleByName = useMemo(() => {
    return new Set(
      people
        .filter((person) => person.isBlocked)
        .map((person) => person.name.toLowerCase())
    );
  }, [people]);

  const blockedPeopleByEmail = useMemo(() => {
    return new Set(
      people
        .filter((person) => person.isBlocked && person.email)
        .map((person) => person.email!.toLowerCase())
    );
  }, [people]);

  const isMeetingPersonBlocked = useCallback(
    (person: MeetingPerson) => {
      const nameKey = person.name?.toLowerCase();
      const emailKey = person.email?.toLowerCase();
      if (nameKey && blockedPeopleByName.has(nameKey)) return true;
      if (emailKey && blockedPeopleByEmail.has(emailKey)) return true;
      return false;
    },
    [blockedPeopleByEmail, blockedPeopleByName]
  );

  const findExistingPerson = useCallback((person: MeetingPerson) => {
    if (person.email) {
      const byEmail = peopleByEmail.get(person.email.toLowerCase());
      if (byEmail) return byEmail;
    }
    return peopleByName.get(person.name.toLowerCase()) || null;
  }, [peopleByEmail, peopleByName]);

  const meetingPeople = useMemo(() => meeting?.attendees || [], [meeting]);

  const selectableMeetingPeople = useMemo(() => {
    return meetingPeople.filter((person) => !isMeetingPersonBlocked(person));
  }, [meetingPeople, isMeetingPersonBlocked]);

  const allMeetingPeopleKeys = useMemo(() => {
    return new Set(selectableMeetingPeople.map(getMeetingPersonKey));
  }, [selectableMeetingPeople]);

  const selectedPeople = useMemo(() => {
    return selectableMeetingPeople.filter((person) => selectedPeopleKeys.has(getMeetingPersonKey(person)));
  }, [selectableMeetingPeople, selectedPeopleKeys]);

  useEffect(() => {
    if (!meeting) {
      lastMeetingIdRef.current = null;
      return;
    }
    if (lastMeetingIdRef.current !== meeting.id) {
      lastMeetingIdRef.current = meeting.id;
      setSelectedTaskIds(new Set());
      setSelectedPeopleKeys(new Set());
      setActivePerson(null);
    }
  }, [meeting?.id]);

  useEffect(() => {
    if (!meeting || isEditingTitle) return;
    setEditableTitle(meeting.title);
  }, [isEditingTitle, meeting?.id, meeting?.title]);

  useEffect(() => {
    if (!meeting) return;
    const hasSeenPopup = sessionStorage.getItem(`seen-people-popup-${meeting.id}`);
    if (user?.onboardingCompleted && selectableMeetingPeople.length > 0 && !hasSeenPopup) {
      setIsDiscoveryDialogOpen(true);
      sessionStorage.setItem(`seen-people-popup-${meeting.id}`, 'true');
    }
  }, [meeting?.id, user?.onboardingCompleted, selectableMeetingPeople]);

  useEffect(() => {
    if (!meeting) return;
    if (meeting.ingestSource !== "fathom" || meeting.fathomNotificationReadAt) return;
    void updateMeeting(meeting.id, {
      fathomNotificationReadAt: new Date().toISOString(),
    });
  }, [meeting, updateMeeting]);

  const handleTogglePersonSelection = useCallback((personKey: string, isSelected: boolean) => {
    setSelectedPeopleKeys((prev) => {
      const next = new Set(prev);
      if (isSelected) next.add(personKey);
      else next.delete(personKey);
      return next;
    });
  }, []);

  const handleSelectAllPeople = (checked: boolean) => {
    setSelectedPeopleKeys(checked ? new Set(allMeetingPeopleKeys) : new Set());
  };

  const handleOpenPersonDetails = (person: MeetingPerson, role: "attendee" | "mentioned") => {
    setActivePerson({
      person,
      role,
      existingPerson: findExistingPerson(person),
    });
  };

  const handleOpenAssignDialog = (task?: ExtractedTaskSchema) => {
    if (task) {
      setTaskToAssign(task);
    } else if (selectedTaskIds.size === 0) {
      toast({ title: "No tasks selected", variant: "destructive" });
      return;
    }
    setIsAssignDialogOpen(true);
  };

  const handleAssignPerson = async (person: Person) => {
    if (!meeting || !user) return;

    const idsToUpdate = taskToAssign ? getTaskAndAllDescendantIds(taskToAssign) : Array.from(selectedTaskIds);
    const idSetToUpdate = new Set(idsToUpdate);

    const updateTasks = (tasks: ExtractedTaskSchema[]): ExtractedTaskSchema[] => {
      return tasks.map(t => {
        const updatedTask = { ...t };
        if (idSetToUpdate.has(t.id)) {
          updatedTask.assignee = {
            uid: person.id,
            name: person.name,
            email: person.email ?? null, // Ensure null instead of undefined
            photoURL: person.avatarUrl ?? null, // Ensure null instead of undefined
          };
          updatedTask.assigneeName = person.name;
        }
        if (t.subtasks) {
          updatedTask.subtasks = updateTasks(t.subtasks);
        }
        return updatedTask;
      });
    };

    const updatedTasks = updateTasks(getExtractedTasks(meeting.extractedTasks));
    await syncMeetingTasks(updatedTasks);

    const taskTitle = taskToAssign ? `"${taskToAssign.title}" and its subtasks` : `${selectedTaskIds.size} tasks`;
    toast({ title: "Tasks Assigned", description: `${taskTitle} assigned to ${person.name}.` });
    setIsAssignDialogOpen(false);
    setTaskToAssign(null);
    setSelectedTaskIds(new Set());
  };


  const handleCreatePerson = async (name: string): Promise<string | undefined> => {
    if (!user || !meeting) return undefined;
    try {
      const newPersonId = await addPerson(user.uid, { name }, meeting.id);
      toast({ title: "Person Added", description: `${name} has been added.` });
      return newPersonId;
    } catch {
      toast({ title: "Error", description: "Could not create person.", variant: "destructive" });
    }
    return undefined;
  };

  const handleViewDetails = (task: ExtractedTaskSchema) => {
    setTaskForDetailView({ ...task, sourceSessionId: meeting?.id });
    setIsTaskDetailDialogVisible(true);
  };

  const handleSaveTaskDetails = async (updatedTask: ExtractedTaskSchema, options?: { close?: boolean }) => {
    if (!meeting) return;
    const updateRecursively = (tasks: ExtractedTaskSchema[]): ExtractedTaskSchema[] => {
      return tasks.map(t => {
        if (t.id === updatedTask.id) return updatedTask;
        if (t.subtasks) return { ...t, subtasks: updateRecursively(t.subtasks) };
        return t;
      });
    };
    const updatedTasks = updateRecursively(getExtractedTasks(meeting.extractedTasks));
    await syncMeetingTasks(updatedTasks);
    if (options?.close !== false) {
      setIsTaskDetailDialogVisible(false);
    }
    toast({ title: "Task Updated" });
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
      buildBriefContext(task, meetings, people, { primaryMeetingId: meeting?.id }),
    [meeting?.id, meetings, people]
  );

  const flavor = meeting ? flavorMap[meeting.tags?.[0].toLowerCase() as keyof typeof flavorMap || 'default'] : null;
  const meetingDurationMinutes = useMemo(() => getMeetingDurationMinutes(meeting || null), [meeting]);
  const meetingStart = useMemo(() => (meeting ? toDateValue(meeting.startTime) : null), [meeting]);
  const meetingEnd = useMemo(() => (meeting ? toDateValue(meeting.endTime) : null), [meeting]);
  const meetingDateLabel = useMemo(() => {
    if (meetingStart) return format(meetingStart, "MMM d, yyyy");
    if (meetingEnd) return format(meetingEnd, "MMM d, yyyy");
    return null;
  }, [meetingStart, meetingEnd]);
  const meetingTimeLabel = useMemo(() => {
    if (!meetingStart) return null;
    if (meetingEnd) {
      return `${format(meetingStart, "h:mm a")} - ${format(meetingEnd, "h:mm a")}`;
    }
    return format(meetingStart, "h:mm a");
  }, [meetingStart, meetingEnd]);
  const meetingDetailRows = useMemo(() => {
    if (!meeting) return [];
    const confidence = meeting.meetingMetadata?.confidence;
    const sentiment = meeting.overallSentiment;
    return [
      { label: "Organizer", value: meeting.organizerEmail },
      { label: "Meeting type", value: meeting.meetingMetadata?.type },
      { label: "Confidence", value: confidence != null ? `${Math.round(confidence * 100)}%` : null },
      { label: "Sentiment", value: sentiment != null ? `${Math.round(sentiment * 100)}%` : null },
      { label: "Start time", value: meetingStart ? format(meetingStart, "PPpp") : null },
      { label: "End time", value: meetingEnd ? format(meetingEnd, "PPpp") : null },
      { label: "Duration", value: meetingDurationMinutes ? `${meetingDurationMinutes} min` : null },
      { label: "State", value: meeting.state },
      { label: "Calendar Event ID", value: meeting.calendarEventId },
      { label: "Conference ID", value: meeting.conferenceId },
    ].filter((row) => row.value);
  }, [meeting, meetingDurationMinutes, meetingEnd, meetingStart]);

  const meetingRecordingLink = meeting?.recordingUrl || meeting?.shareUrl;
  const isTaskDone = useCallback(
    (task: ExtractedTaskSchema) => (task.status || "todo") === "done",
    []
  );
  const isTaskReview = useCallback(
    (task: ExtractedTaskSchema) => Boolean(task.completionSuggested),
    []
  );
  const openTasks = useMemo(() => {
    if (!meeting) return [];
    return getExtractedTasks(meeting.extractedTasks).filter(
      (task) => !isTaskDone(task) || isTaskReview(task)
    );
  }, [meeting, isTaskDone, isTaskReview]);
  const allMeetingTaskIds = useMemo(() => {
    if (!openTasks.length) return new Set<string>();
    const ids = new Set<string>();
    const collectIds = (tasks: ExtractedTaskSchema[]) => {
      tasks.forEach(task => {
        ids.add(task.id);
        if (task.subtasks) collectIds(task.subtasks);
      });
    };
    collectIds(openTasks);
    return ids;
  }, [openTasks]);
  useEffect(() => {
    if (!meeting?.extractedTasks) return;
    setSelectedTaskIds((prev) => {
      if (prev.size === 0) return prev;
      const validIds = new Set<string>();
      const collect = (tasks: ExtractedTaskSchema[]) => {
        tasks.forEach((task) => {
          validIds.add(task.id);
          if (task.subtasks) collect(task.subtasks);
        });
      };
      collect(getExtractedTasks(meeting.extractedTasks));
      let changed = false;
      const next = new Set<string>();
      prev.forEach((id) => {
        if (validIds.has(id)) {
          next.add(id);
        } else {
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [meeting?.extractedTasks]);
  const completedTasks = useMemo(() => {
    if (!meeting) return [];
    return getExtractedTasks(meeting.extractedTasks).filter(
      (task) => isTaskDone(task) && !isTaskReview(task)
    );
  }, [meeting, isTaskDone, isTaskReview]);
  const filterTasksByPerson = useCallback(
    (tasks: ExtractedTaskSchema[]) => {
      if (filterByPerson === "all") return tasks;
      if (filterByPerson === "unassigned") {
        return tasks.filter((t) => !t.assignee && !t.assigneeName);
      }

      const selectedPerson = selectableMeetingPeople.find(
        (p) => p.name === filterByPerson
      );
      if (!selectedPerson) return tasks;

      return tasks.filter(
        (t) =>
          t.assignee?.name === selectedPerson.name ||
          t.assigneeName === selectedPerson.name
      );
    },
    [filterByPerson, selectableMeetingPeople]
  );

  const filteredOpenTasks = useMemo(
    () => filterTasksByPerson(openTasks),
    [filterTasksByPerson, openTasks]
  );
  const filteredCompletedTasks = useMemo(
    () => filterTasksByPerson(completedTasks),
    [filterTasksByPerson, completedTasks]
  );

  const groupedTasks = useMemo(() => {
    const groups = new Map<string, ExtractedTaskSchema[]>();
    filteredOpenTasks.forEach((task) => {
      const type = task.taskType || 'general';
      if (!groups.has(type)) {
        groups.set(type, []);
      }
      groups.get(type)!.push(task);
    });
    return Array.from(groups.entries())
      .sort(([aType], [bType]) => {
        const aOrder = taskTypeOrder.get(aType) ?? 999;
        const bOrder = taskTypeOrder.get(bType) ?? 999;
        return aOrder - bOrder;
      })
      .map(([type, tasks]) => ({
        type,
        label: TASK_TYPE_LABELS[type as TaskTypeCategory] || 'General',
        tasks,
      }));
  }, [filteredOpenTasks]);

  const groupedCompletedTasks = useMemo(() => {
    const groups = new Map<string, ExtractedTaskSchema[]>();
    filteredCompletedTasks.forEach((task) => {
      const type = task.taskType || 'general';
      if (!groups.has(type)) {
        groups.set(type, []);
      }
      groups.get(type)!.push(task);
    });
    return Array.from(groups.entries())
      .sort(([aType], [bType]) => {
        const aOrder = taskTypeOrder.get(aType) ?? 999;
        const bOrder = taskTypeOrder.get(bType) ?? 999;
        return aOrder - bOrder;
      })
      .map(([type, tasks]) => ({
        type,
        label: TASK_TYPE_LABELS[type as TaskTypeCategory] || 'General',
        tasks,
      }));
  }, [filteredCompletedTasks]);

  const handleDeleteMeeting = async () => {
    if (!meeting) return;
    try {
      await deleteMeeting(meeting.id);
      toast({
        title: "Meeting Deleted",
        description: `"${meeting.title}" was hidden and its extracted tasks were removed.`,
      });
      onClose(); // Close the sheet after deletion
    } catch {
      toast({ title: "Deletion Failed", description: "Could not delete the meeting.", variant: "destructive" });
    }
    setIsDeleteConfirmOpen(false);
  };

  const handleDeleteTask = async (taskId: string) => {
    if (!meeting) return;
    const filterTasks = (tasks: ExtractedTaskSchema[], idToDelete: string): ExtractedTaskSchema[] => {
      return tasks.filter(t => t.id !== idToDelete).map(t => {
        if (t.subtasks) {
          return { ...t, subtasks: filterTasks(t.subtasks, idToDelete) };
        }
        return t;
      });
    };

    const updatedTasks = filterTasks(getExtractedTasks(meeting.extractedTasks), taskId);
    await syncMeetingTasks(updatedTasks);
    toast({ title: "Task Deleted", description: "The task has been removed from this meeting." });
  };

  const handleConfirmCompletion = async (task: ExtractedTaskSchema) => {
    if (!meeting) return;
    const targets = task.completionTargets || [];

    const updateRecursively = (tasks: ExtractedTaskSchema[]): ExtractedTaskSchema[] =>
      tasks.map((t) => {
        if (t.id === task.id) {
          return {
            ...t,
            status: "done",
            completionSuggested: false,
          };
        }
        if (t.subtasks) {
          return { ...t, subtasks: updateRecursively(t.subtasks) };
        }
        return t;
      });

    const updatedTasks = updateRecursively(getExtractedTasks(meeting.extractedTasks));
    await syncMeetingTasks(updatedTasks);

    const updates = targets.map((target) => {
      if (target.sourceType === "task") {
        return apiFetch(`/api/tasks/${target.taskId}`, {
          method: "PATCH",
          body: JSON.stringify({ status: "done" }),
        });
      }
      return apiFetch("/api/tasks/status", {
        method: "PATCH",
        body: JSON.stringify({
          sourceSessionId: target.sourceSessionId,
          sourceSessionType: target.sourceType,
          taskId: target.taskId,
          status: "done",
        }),
      });
    });

    if (updates.length) {
      await Promise.allSettled(updates);
    }

    toast({
      title: "Completion Confirmed",
      description: "The linked tasks have been marked as done.",
    });
  };

  const handleDismissCompletion = async (task: ExtractedTaskSchema) => {
    if (!meeting) return;
    const filterTasks = (tasks: ExtractedTaskSchema[], idToDelete: string): ExtractedTaskSchema[] => {
      return tasks.filter(t => t.id !== idToDelete).map(t => {
        if (t.subtasks) {
          return { ...t, subtasks: filterTasks(t.subtasks, idToDelete) };
        }
        return t;
      });
    };

    const updatedTasks = filterTasks(getExtractedTasks(meeting.extractedTasks), task.id);
    await syncMeetingTasks(updatedTasks);
    toast({ title: "Suggestion Dismissed", description: "Completion suggestion removed." });
  };

  const handleDeleteSelectedTasks = async () => {
    if (!meeting || selectedTaskIds.size === 0) return;

    let tasksAfterDeletion = [...getExtractedTasks(meeting.extractedTasks)];
    const idsToDelete = new Set(selectedTaskIds);

    const filterRecursively = (tasks: ExtractedTaskSchema[]): ExtractedTaskSchema[] => {
      return tasks.filter(task => !idsToDelete.has(task.id)).map(task => {
        if (task.subtasks) {
          return { ...task, subtasks: filterRecursively(task.subtasks) };
        }
        return task;
      });
    };

    tasksAfterDeletion = filterRecursively(tasksAfterDeletion);

    await syncMeetingTasks(tasksAfterDeletion);
    toast({ title: `${selectedTaskIds.size} Tasks Deleted`, description: "The selected tasks have been removed." });
    setSelectedTaskIds(new Set()); // Clear selection
  };

  const handleResetTasks = async () => {
    if (!meeting) {
      toast({ title: "Reset Failed", description: "Meeting data unavailable.", variant: "destructive" });
      return;
    }
    const initialTasks =
      meeting.originalAiTasks ||
      meeting.originalAllTaskLevels?.medium ||
      meeting.allTaskLevels?.medium;

    if (!initialTasks) {
      toast({ title: "Reset Failed", description: "No initial task state available to reset to.", variant: "destructive" });
      return;
    }

    await syncMeetingTasks(initialTasks);

    toast({ title: "Tasks Reset", description: "The task list has been reset to its initial state." });
    setIsResetConfirmOpen(false);
  };

  const handleRescanTasks = async () => {
    if (!meeting || isRescanLoading) return;
    setIsRescanLoading(true);
    try {
      const result = await apiFetch<{
        stats?: {
          newTasksAdded?: number;
          completionUpdates?: number;
          autoApproved?: boolean;
        };
      }>(`/api/meetings/${meeting.id}/rescan`, {
        method: "POST",
        body: JSON.stringify({ mode: "completed" }),
      });
      await refreshMeetings();
      const newTasksAdded = result?.stats?.newTasksAdded ?? 0;
      const completionUpdates = result?.stats?.completionUpdates ?? 0;
      const autoApproved = Boolean(result?.stats?.autoApproved);
      const completionLabel =
        completionUpdates > 0
          ? `${completionUpdates} ${autoApproved ? "completed" : "flagged"}`
          : "No completions found";
      toast({
        title: "Rescan Complete",
        description: `Added ${newTasksAdded} task(s). ${completionLabel}.`,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not rescan meeting.";
      toast({ title: "Rescan Failed", description: message, variant: "destructive" });
    } finally {
      setIsRescanLoading(false);
    }
  };

  const handleSaveTitle = async () => {
    if (!meeting || !editableTitle.trim()) {
      toast({ title: "Title cannot be empty", variant: "destructive" });
      return;
    }
    if (meeting.title === editableTitle.trim()) {
      setIsEditingTitle(false);
      return;
    }
    await updateMeeting(meeting.id, { title: editableTitle.trim() });
    toast({ title: "Meeting Renamed" });
    setIsEditingTitle(false);
  };

  const handleConfirmSetDueDate = async (date: Date | undefined) => {
    if (!meeting) return;
    const newDueDateISO = date ? date.toISOString() : null;

    const updateDueDatesRecursively = (tasks: ExtractedTaskSchema[]): ExtractedTaskSchema[] => {
      return tasks.map(task => {
        const updatedTask = { ...task };
        if (selectedTaskIds.has(task.id)) {
          updatedTask.dueAt = newDueDateISO;
        }
        if (task.subtasks) {
          updatedTask.subtasks = updateDueDatesRecursively(task.subtasks);
        }
        return updatedTask;
      });
    };

    const newExtractedTasks = updateDueDatesRecursively(getExtractedTasks(meeting.extractedTasks));
    await syncMeetingTasks(newExtractedTasks);
    toast({ title: "Due Dates Updated", description: `Due dates set for ${selectedTaskIds.size} task(s).` });
    setIsSetDueDateDialogOpen(false);
    setSelectedTaskIds(new Set());
  };

  const getSelectedTasksRecursive = (tasks: ExtractedTaskSchema[]): ExtractedTaskSchema[] => {
    return tasks.reduce((acc, task) => {
      const isSelected = selectedTaskIds.has(task.id);
      const selectedSubtasks = task.subtasks ? getSelectedTasksRecursive(task.subtasks) : [];
      if (isSelected || selectedSubtasks.length > 0) {
        acc.push({ ...task, subtasks: selectedSubtasks });
      }
      return acc;
    }, [] as ExtractedTaskSchema[]);
  };

  const handleExport = (format: 'csv' | 'md' | 'pdf') => {
    if (!meeting || selectedTaskIds.size === 0) {
      toast({ title: "No tasks selected", variant: "destructive" });
      return;
    }

    const tasksToExport = getSelectedTasksRecursive(getExtractedTasks(meeting.extractedTasks));
    const filename = `${meeting.title.replace(/\s+/g, '_')}_export`;

    if (format === 'csv') exportTasksToCSV(tasksToExport, `${filename}.csv`);
    if (format === 'md') exportTasksToMarkdown(tasksToExport, `${filename}.md`);
    if (format === 'pdf') exportTasksToPDF(tasksToExport, meeting.title);

    toast({ title: `Exported to ${format.toUpperCase()}` });
  };

  const handleCopySelected = async () => {
    if (!meeting || selectedTaskIds.size === 0) {
      toast({ title: "No tasks selected", description: "Please select tasks to copy.", variant: "destructive" });
      return;
    }
    const tasksToCopy = getSelectedTasksRecursive(getExtractedTasks(meeting.extractedTasks));
    const textToCopy = formatTasksToText(tasksToCopy);
    const { success } = await copyTextToClipboard(textToCopy);
    if (success) {
      toast({ title: "Copied!", description: `Copied ${tasksToCopy.length} task branches to clipboard.` });
    } else {
      toast({ title: "Copy Failed", description: "Could not copy tasks to clipboard.", variant: "destructive" });
    }
  };



  const handleShareToSlack = () => {
    if (selectedTaskIds.size === 0) {
      toast({ title: "No tasks selected", description: "Please select one or more tasks to share.", variant: "destructive" });
      return;
    }
    setIsShareToSlackOpen(true);
  };

  const handlePushToGoogleTasks = () => {
    if (selectedTaskIds.size === 0) {
      toast({ title: "No tasks selected", description: "Please select tasks to push to Google Tasks.", variant: "destructive" });
      return;
    }
    setIsPushToGoogleOpen(true);
  };

  const handlePushToTrello = () => {
    if (selectedTaskIds.size === 0) {
      toast({ title: "No tasks selected", description: "Please select tasks to push to Trello.", variant: "destructive" });
      return;
    }
    setIsPushToTrelloOpen(true);
  };

  const handleDiscoveryDialogClose = async (peopleToCreate: Partial<Person>[]) => {
    setIsDiscoveryDialogOpen(false);
    if (!user || !id) return;

    if (peopleToCreate.length > 0) {
      toast({
        title: "Adding New People...",
        description: `Saving ${peopleToCreate.length} new people to your directory.`,
      });

      const addPromises = peopleToCreate.map(person => addPerson(user.uid, person, id));
      await Promise.all(addPromises);
      toast({ title: "People Added!", description: "New people have been saved to your directory." });
    }
  };

  const buildUniquePersonName = (baseName: string, existingNames: Set<string>) => {
    const normalizedBase = baseName.trim() || "Unknown";
    let candidate = normalizedBase;
    let index = 2;
    while (existingNames.has(candidate.toLowerCase())) {
      candidate = `${normalizedBase} (${index})`;
      index += 1;
    }
    existingNames.add(candidate.toLowerCase());
    return candidate;
  };

  const handleAddPeopleToDirectory = async (peopleToAdd: MeetingPerson[], forceUnique: boolean) => {
    if (!user || !meeting) return;

    const existingNames = new Set(people.map((p) => p.name.toLowerCase()));
    const existingEmails = new Set(
      people
        .map((p) => p.email?.toLowerCase())
        .filter((email): email is string => Boolean(email))
    );

    const seenKeys = new Set<string>();
    const filteredPeople = peopleToAdd.filter((person) => {
      if (isMeetingPersonBlocked(person)) return false;
      const personKey = getMeetingPersonKey(person);
      if (seenKeys.has(personKey)) return false;
      seenKeys.add(personKey);

      if (forceUnique) return true;
      const fuzzyMatch = getBestPersonMatch(
        { name: person.name, email: person.email },
        people,
        0.9
      );
      if (fuzzyMatch) return false;
      if (person.email && existingEmails.has(person.email.toLowerCase())) return false;
      if (existingNames.has(person.name.toLowerCase())) return false;
      return true;
    });

    if (filteredPeople.length === 0) {
      toast({ title: "No new people to add", description: "All selected people already exist in your directory." });
      return;
    }

    const addPromises = filteredPeople.map((person) => {
      const baseName = person.name || "Unknown";
      let name = baseName;
      let aliases: string[] | undefined;

      if (forceUnique) {
        const uniqueName = buildUniquePersonName(baseName, existingNames);
        if (uniqueName !== baseName) {
          aliases = [baseName];
        }
        name = uniqueName;
      } else {
        existingNames.add(baseName.toLowerCase());
      }

      return addPerson(user.uid, {
        name,
        email: person.email,
        title: person.title,
        avatarUrl: person.avatarUrl,
        ...(aliases ? { aliases } : {}),
      }, meeting.id);
    });

    await Promise.all(addPromises);
    toast({ title: "People Added", description: `${filteredPeople.length} people saved to your directory.` });
  };

  const handleAddSelectedPeople = async () => {
    if (selectedPeople.length === 0) {
      toast({ title: "No people selected", variant: "destructive" });
      return;
    }
    await handleAddPeopleToDirectory(selectedPeople, false);
    setSelectedPeopleKeys(new Set());
  };

  const handleRememberSelectedPeople = async () => {
    if (selectedPeople.length === 0) {
      toast({ title: "No people selected", variant: "destructive" });
      return;
    }
    await handleAddPeopleToDirectory(selectedPeople, true);
    setSelectedPeopleKeys(new Set());
  };

  const handleRemoveSelectedPeople = async () => {
    if (!meeting || selectedPeople.length === 0) {
      toast({ title: "No people selected", variant: "destructive" });
      return;
    }
    const selectedKeys = new Set(selectedPeopleKeys);
    const updatedAttendees = (meeting.attendees || []).filter((person) => !selectedKeys.has(getMeetingPersonKey(person)));
    const updated = await updateMeeting(meeting.id, { attendees: updatedAttendees });
    if (!updated) {
      toast({ title: "Update Failed", description: "Could not remove people from this meeting.", variant: "destructive" });
      return;
    }
    await refreshMeetings();
    setSelectedPeopleKeys(new Set());
    toast({ title: "People removed", description: `${selectedPeople.length} people removed from this meeting.` });
  };

  const handleAddPersonFromDialog = async (person: MeetingPerson) => {
    await handleAddPeopleToDirectory([person], false);
    setActivePerson(null);
  };

  const handleMatchExistingPerson = async ({ person, matchedPerson }: { person: Partial<Person>; matchedPerson: Person }) => {
    if (!user || !meeting) return;
    const aliases = new Set(matchedPerson.aliases || []);
    if (person.name && person.name.toLowerCase() !== matchedPerson.name.toLowerCase()) {
      aliases.add(person.name);
    }
    const sourceSessionIds = new Set(matchedPerson.sourceSessionIds || []);
    sourceSessionIds.add(meeting.id);
    const update: Partial<Person> = {
      aliases: Array.from(aliases),
      sourceSessionIds: Array.from(sourceSessionIds),
      ...(matchedPerson.email ? {} : person.email ? { email: person.email } : {}),
      ...(matchedPerson.title ? {} : person.title ? { title: person.title } : {}),
      ...(matchedPerson.avatarUrl ? {} : person.avatarUrl ? { avatarUrl: person.avatarUrl } : {}),
    };
    await updatePerson(user.uid, matchedPerson.id, update);
    toast({
      title: "Person matched",
      description: `${person.name} is now linked to ${matchedPerson.name}.`,
    });
  };

  const attendees = useMemo(
    () => meetingPeople.filter((person) => person.role === "attendee"),
    [meetingPeople]
  );
  const mentionedPeople = useMemo(
    () => meetingPeople.filter((person) => person.role === "mentioned"),
    [meetingPeople]
  );

  const selectedTasks = useMemo(() => {
    if (!meeting) return [];
    return getSelectedTasksRecursive(getExtractedTasks(meeting.extractedTasks));
  }, [selectedTaskIds, meeting]);


  if (isLoadingMeetingHistory && id) {
    if (isPageVariant) {
      return (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      );
    }
    return (
      <Sheet open={true} onOpenChange={onClose}>
        <SheetContent side="right" className="w-full sm:max-w-2xl p-0">
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  if (!meeting && id) {
    if (isPageVariant) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
          <div className="rounded-full bg-muted p-3 text-muted-foreground">
            <Info className="h-5 w-5" />
          </div>
          <div>
            <p className="text-lg font-semibold">Meeting not found</p>
            <p className="text-sm text-muted-foreground">
              This meeting might have been removed or you no longer have access to it.
            </p>
          </div>
          <Button variant="outline" onClick={onClose}>
            Back to Meetings
          </Button>
        </div>
      );
    }
    return (
      <Sheet open={true} onOpenChange={onClose}>
        <SheetContent side="right" className="w-full sm:max-w-2xl p-0">
          <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
            <div className="rounded-full bg-muted p-3 text-muted-foreground">
              <Info className="h-5 w-5" />
            </div>
            <div>
              <p className="text-lg font-semibold">Meeting not found</p>
              <p className="text-sm text-muted-foreground">
                This meeting might have been removed or you no longer have access to it.
              </p>
            </div>
            <Button variant="outline" onClick={onClose}>
              Back to Meetings
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  const detailContent = meeting && flavor && (
    <div className={cn("h-full grid grid-rows-[auto,1fr,auto]", isPageVariant && "max-w-6xl mx-auto w-full")}>
      <div className="relative px-6 pt-6 pb-4 border-b">
        {isPageVariant && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              {isEditingTitle ? (
                <Input
                  value={editableTitle}
                  onChange={(e) => setEditableTitle(e.target.value)}
                  onBlur={handleSaveTitle}
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveTitle()}
                  className="text-xl font-bold tracking-tight h-9"
                  autoFocus
                />
              ) : (
                <h1 className="text-2xl font-semibold tracking-tight flex-grow">{meeting.title}</h1>
              )}
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setIsEditingTitle(!isEditingTitle)}>
                <Edit2 className="h-4 w-4" />
              </Button>
            </div>
            <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
              <span>
                {toDateValue(meeting.lastActivityAt)
                  ? formatDistanceToNow(toDateValue(meeting.lastActivityAt) as Date, { addSuffix: true })
                  : "Just now"}
              </span>
              <span>|</span>
              <span>{meetingDurationMinutes ? `${meetingDurationMinutes} min` : "N/A"}</span>
              <span>|</span>
              <span className="flex items-center gap-1"><Users className="h-3 w-3" />{meetingPeople.length}</span>
              {meetingDateLabel && (
                <>
                  <span>|</span>
                  <span className="flex items-center gap-1">
                    <CalendarDays className="h-3 w-3" />
                    {meetingDateLabel}
                    {meetingTimeLabel ? ` - ${meetingTimeLabel}` : ""}
                  </span>
                </>
              )}
            </div>
          </div>
        )}
        {!isPageVariant && (
          <SheetHeader>
            <div className="flex items-center gap-2">
              {isEditingTitle ? (
                <Input
                  value={editableTitle}
                  onChange={(e) => setEditableTitle(e.target.value)}
                  onBlur={handleSaveTitle}
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveTitle()}
                  className="text-xl font-bold tracking-tight h-9"
                  autoFocus
                />
              ) : (
                <SheetTitle className="text-xl tracking-tight flex-grow">{meeting.title}</SheetTitle>
              )}
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setIsEditingTitle(!isEditingTitle)}>
                <Edit2 className="h-4 w-4" />
              </Button>
            </div>

            <SheetDescription asChild>
              <div className="text-muted-foreground flex items-center gap-2 text-xs">
                {/* <FlavorBadge flavor={meeting.tags?.[0].toLowerCase() as keyof typeof flavorMap || 'default'} /> */}
                <span>
                  {toDateValue(meeting.lastActivityAt)
                    ? formatDistanceToNow(toDateValue(meeting.lastActivityAt) as Date, { addSuffix: true })
                    : "Just now"}
                </span>
                <span>|</span>
                <span>{meetingDurationMinutes ? `${meetingDurationMinutes} min` : "N/A"}</span>
                <span>|</span>
                <span className="flex items-center gap-1"><Users className="h-3 w-3" />{meetingPeople.length}</span>
                {meetingDateLabel && (
                  <>
                    <span>|</span>
                    <span className="flex items-center gap-1">
                      <CalendarDays className="h-3 w-3" />
                      {meetingDateLabel}
                      {meetingTimeLabel ? ` - ${meetingTimeLabel}` : ""}
                    </span>
                  </>
                )}
              </div>
            </SheetDescription>
          </SheetHeader>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {(meeting.tags || []).map((t: string, i: number) => (<Badge key={i} variant="secondary" className="rounded-full">{t}</Badge>))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {isPageVariant && (
            <Button size="sm" variant="outline" className="h-8 gap-1" onClick={onClose}>
              <ChevronLeft className="h-4 w-4" />
              Back to Meetings
            </Button>
          )}
          {meetingRecordingLink ? (
            <Button size="sm" className="h-8 gap-1" asChild>
              <a href={meetingRecordingLink} target="_blank" rel="noreferrer">
                <PlayCircle className="h-4 w-4" />
                Play Recording
              </a>
            </Button>
          ) : (
            <Button size="sm" className="h-8 gap-1" disabled>
              <PlayCircle className="h-4 w-4" />
              Play Recording
            </Button>
          )}
          {!isPageVariant && (
            <Button size="sm" variant="outline" className="h-8 gap-1" asChild>
              <Link href={`/meetings/${meeting.id}`}>
                <ArrowUpRight className="h-4 w-4" />
                Open Details
              </Link>
            </Button>
          )}
          <Button size="sm" variant="outline" className="h-8 gap-1" onClick={() => onNavigateToChat(meeting)}>
            <MessageSquareText className="h-4 w-4" />
            Go to Chat
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 ml-auto"><MoreHorizontal className="h-4 w-4" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  void handleRescanTasks();
                }}
                disabled={isRescanLoading}
              >
                {isRescanLoading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="mr-2 h-4 w-4" />
                )}
                <span>{isRescanLoading ? "Rescanning Tasks" : "Rescan Tasks"}</span>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setIsResetConfirmOpen(true)}>
                <RefreshCw className="mr-2 h-4 w-4" />
                <span>Reset to Initial State</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setIsDeleteConfirmOpen(true); }} className="text-destructive focus:text-destructive">
                <Trash2 className="mr-2 h-4 w-4" />
                <span>Delete Meeting</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <ScrollArea className="h-full">
        <div className="px-6 py-4 space-y-6">
          <Tabs defaultValue="tasks" className="w-full">
            <div className="flex items-center justify-between">
              <TabsList>
                <TabsTrigger value="summary">Summary</TabsTrigger>
                <TabsTrigger value="details">Details</TabsTrigger>
                <TabsTrigger value="tasks">Tasks</TabsTrigger>
                <TabsTrigger value="completed">Completed</TabsTrigger>
                <TabsTrigger value="attendees">People</TabsTrigger>
                <TabsTrigger value="artifacts">Artifacts</TabsTrigger>
              </TabsList>

            </div>
            <div className="pt-4">
              <TabsContent value="summary" className="space-y-4 m-0">
                <Card className="rounded-xl"><CardHeader className="pb-2"><CardTitle className="text-sm">Summary</CardTitle></CardHeader><CardContent className="p-4 pt-0 text-sm">{meeting.summary}</CardContent></Card>
                {meeting.keyMoments && meeting.keyMoments.length > 0 && (
                  <Card className="rounded-xl">
                    <CardHeader className="pb-2"><CardTitle className="text-sm">Key Moments</CardTitle></CardHeader>
                    <CardContent className="space-y-2 p-4 pt-0">
                      {meeting.keyMoments.map((k, i) => (<MomentRow key={i} m={k} />))}
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              <TabsContent value="details" className="space-y-4 m-0">
                <Card className="rounded-xl">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Meeting Metadata</CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-3 p-4 pt-0 text-sm md:grid-cols-2">
                    {meetingDetailRows.length === 0 && (
                      <p className="text-muted-foreground">No metadata available.</p>
                    )}
                    {meetingDetailRows.map((row) => (
                      <div key={row.label} className="space-y-1">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">{row.label}</p>
                        <p className="font-medium text-foreground">{row.value}</p>
                      </div>
                    ))}
                  </CardContent>
                </Card>

                {(meetingRecordingLink || meeting.shareUrl) && (
                  <Card className="rounded-xl">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Links</CardTitle>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-2 p-4 pt-0 text-sm">
                      {meetingRecordingLink && (
                        <a
                          href={meetingRecordingLink}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-2 text-primary hover:underline"
                        >
                          <Link2 className="h-4 w-4" />
                          Open Recording
                        </a>
                      )}
                      {meeting.shareUrl && (
                        <a
                          href={meeting.shareUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-2 text-primary hover:underline"
                        >
                          <Link2 className="h-4 w-4" />
                          Share Link
                        </a>
                      )}
                    </CardContent>
                  </Card>
                )}

                {(meeting.meetingMetadata?.reasoning || meeting.meetingMetadata?.blockers?.length) && (
                  <Card className="rounded-xl">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">AI Insights</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3 p-4 pt-0 text-sm">
                      {meeting.meetingMetadata?.reasoning && (
                        <p className="text-muted-foreground">{meeting.meetingMetadata.reasoning}</p>
                      )}
                      {meeting.meetingMetadata?.blockers && meeting.meetingMetadata.blockers.length > 0 && (
                        <div>
                          <p className="text-xs uppercase tracking-wide text-muted-foreground">Blockers</p>
                          <ul className="mt-2 list-disc space-y-1 pl-5 text-foreground">
                            {meeting.meetingMetadata.blockers.map((blocker) => (
                              <li key={blocker}>{blocker}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}

                {meeting.speakerActivity && meeting.speakerActivity.length > 0 && (
                  <Card className="rounded-xl">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Speaker Activity</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 p-4 pt-0 text-sm">
                      {meeting.speakerActivity.map((speaker) => (
                        <div key={speaker.name} className="flex items-center justify-between">
                          <span className="font-medium text-foreground">{speaker.name}</span>
                          <span className="text-muted-foreground">{speaker.wordCount} words</span>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              <TabsContent value="tasks" className="space-y-2 m-0">
                <div className="flex items-center justify-between py-2 border-b">
                  <div className="flex items-center gap-2">
                    <Checkbox id="select-all-meeting-tasks" onCheckedChange={handleSelectAll} checked={allMeetingTaskIds.size > 0 && selectedTaskIds.size === allMeetingTaskIds.size} />
                    <label htmlFor="select-all-meeting-tasks" className="text-sm font-medium">Select All</label>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" className="h-8 gap-1.5 ml-auto">
                        <Filter className="h-4 w-4" />
                        <span>{filterByPerson === 'all' ? 'All Assignees' : filterByPerson}</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuLabel>Filter by Assignee</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      <DropdownMenuRadioGroup value={filterByPerson} onValueChange={setFilterByPerson}>
                        <DropdownMenuRadioItem value="all">All</DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="unassigned">Unassigned</DropdownMenuRadioItem>
                        {selectableMeetingPeople.map((p) => (
                          <DropdownMenuRadioItem key={p.name} value={p.name}>{p.name}</DropdownMenuRadioItem>
                        ))}
                      </DropdownMenuRadioGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                {groupedTasks.length === 0 && (
                  <div className="py-8 text-center text-sm text-muted-foreground">
                    No open tasks to review.
                  </div>
                )}
                {groupedTasks.map((group) => {
                  const groupCheckboxState = getGroupCheckboxState(group.tasks, selectedTaskIds);
                  const groupChecked = groupCheckboxState === "checked";
                  const groupIndeterminate = groupCheckboxState === "indeterminate";
                  const groupId = `select-task-group-${group.type}`;

                  return (
                    <div key={group.type} className="space-y-2 pt-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Checkbox
                            id={groupId}
                            checked={groupIndeterminate ? "indeterminate" : groupChecked}
                            onCheckedChange={(checked) => handleToggleGroupSelection(group.tasks, !!checked)}
                          />
                          <label htmlFor={groupId} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            {group.label}
                          </label>
                          <Badge variant="secondary" className="text-[10px]">{group.tasks.length}</Badge>
                        </div>
                      </div>
                      {group.tasks.map((t) => (
                        <TaskRow
                          key={t.id}
                          task={t}
                          onAssign={() => handleOpenAssignDialog(t)}
                          onDelete={() => handleDeleteTask(t.id)}
                          onConfirmCompletion={handleConfirmCompletion}
                          onDismissCompletion={handleDismissCompletion}
                          level={0}
                          onToggleSelection={handleToggleSelection}
                          onViewDetails={handleViewDetails}
                          isSelected={selectedTaskIds.has(t.id)}
                          isIndeterminate={getCheckboxState(t, selectedTaskIds) === 'indeterminate'}
                          selectedTaskIds={selectedTaskIds}
                          getCheckboxState={getCheckboxState}
                        />
                      ))}
                    </div>
                  );
                })}
                <div className="pt-2 flex items-center gap-2"><Input placeholder="New action item..." /><Button>Add</Button></div>
              </TabsContent>

              <TabsContent value="completed" className="space-y-2 m-0">
                {groupedCompletedTasks.length === 0 && (
                  <div className="py-8 text-center text-sm text-muted-foreground">
                    No completed tasks yet.
                  </div>
                )}
                {groupedCompletedTasks.map((group) => (
                  <div key={group.type} className="space-y-2 pt-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          {group.label}
                        </label>
                        <Badge variant="secondary" className="text-[10px]">{group.tasks.length}</Badge>
                      </div>
                    </div>
                    {group.tasks.map((t) => (
                      <TaskRow
                        key={t.id}
                        task={t}
                        onAssign={() => handleOpenAssignDialog(t)}
                        onDelete={() => handleDeleteTask(t.id)}
                        level={0}
                        onToggleSelection={handleToggleSelection}
                        onViewDetails={handleViewDetails}
                        isSelected={false}
                        isIndeterminate={false}
                        selectionDisabled
                        selectedTaskIds={selectedTaskIds}
                        getCheckboxState={getCheckboxState}
                      />
                    ))}
                  </div>
                ))}
              </TabsContent>

              <TabsContent value="attendees" className="space-y-4 m-0">
                <div className="flex items-center justify-between py-2 border-b">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="select-all-people"
                      checked={allMeetingPeopleKeys.size > 0 && selectedPeopleKeys.size === allMeetingPeopleKeys.size}
                      onCheckedChange={(checked) => handleSelectAllPeople(!!checked)}
                    />
                    <label htmlFor="select-all-people" className="text-sm font-medium">Select All</label>
                    {selectedPeopleKeys.size > 0 && (
                      <span className="text-xs text-muted-foreground">{selectedPeopleKeys.size} selected</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" className="h-8 gap-1" disabled={selectedPeopleKeys.size === 0} onClick={handleAddSelectedPeople}>
                      <UserPlus className="h-4 w-4" />
                      Add
                    </Button>
                    <Button size="sm" variant="outline" className="h-8 gap-1" disabled={selectedPeopleKeys.size === 0} onClick={handleRememberSelectedPeople}>
                      <UserCheck className="h-4 w-4" />
                      Remember as Different
                    </Button>
                    <Button size="sm" variant="outline" className="h-8 gap-1" disabled={selectedPeopleKeys.size === 0} onClick={handleRemoveSelectedPeople}>
                      <Trash2 className="h-4 w-4" />
                      Remove
                    </Button>
                  </div>
                </div>
                {attendees.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-sm font-semibold flex items-center gap-2"><Users className="h-4 w-4 text-primary" /> Meeting Attendees</h4>
                    {attendees.map((p, i) => (
                      <PersonRow
                        key={`att-${i}`}
                        p={p}
                        role="attendee"
                        isSelected={selectedPeopleKeys.has(getMeetingPersonKey(p))}
                        onToggleSelection={(checked) => handleTogglePersonSelection(getMeetingPersonKey(p), checked)}
                        onOpen={() => handleOpenPersonDetails(p, "attendee")}
                        isInDirectory={Boolean(findExistingPerson(p))}
                        isBlocked={isMeetingPersonBlocked(p)}
                      />
                    ))}
                  </div>
                )}
                {mentionedPeople.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-sm font-semibold flex items-center gap-2"><Megaphone className="h-4 w-4 text-muted-foreground" /> Mentioned People</h4>
                    {mentionedPeople.map((p, i) => (
                      <PersonRow
                        key={`men-${i}`}
                        p={p}
                        role="mentioned"
                        isSelected={selectedPeopleKeys.has(getMeetingPersonKey(p))}
                        onToggleSelection={(checked) => handleTogglePersonSelection(getMeetingPersonKey(p), checked)}
                        onOpen={() => handleOpenPersonDetails(p, "mentioned")}
                        isInDirectory={Boolean(findExistingPerson(p))}
                        isBlocked={isMeetingPersonBlocked(p)}
                      />
                    ))}
                  </div>
                )}
                {(attendees.length === 0 && mentionedPeople.length === 0) && (
                  <div className="text-center py-10 text-muted-foreground">
                    <Users className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p>No people were identified for this meeting.</p>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="artifacts" className="space-y-2 m-0">
                <ArtifactsSection meeting={meeting} />
              </TabsContent>

            </div>
          </Tabs>
        </div>
      </ScrollArea>
      <div className="px-6 pb-4">
        <SelectionToolbar
          selectedCount={selectedTaskIds.size}
          onClear={() => setSelectedTaskIds(new Set())}
          onView={() => setIsSelectionViewVisible(true)}
          onAssign={() => handleOpenAssignDialog()}
          onSetDueDate={() => setIsSetDueDateDialogOpen(true)}
          onDelete={() => handleDeleteSelectedTasks()}
          onSend={(format) => handleExport(format)}
          onCopy={handleCopySelected}
          onShareToSlack={handleShareToSlack}
          isSlackConnected={isSlackConnected}
          onPushToGoogleTasks={handlePushToGoogleTasks}
          isGoogleTasksConnected={isGoogleTasksConnected}
          onPushToTrello={handlePushToTrello}
          isTrelloConnected={isTrelloConnected}
        />
      </div>
    </div>
  );

  return (
    <>
      {isPageVariant ? (
        <div className="flex flex-col h-full">{detailContent}</div>
      ) : (
        <Sheet open={!!id} onOpenChange={(open) => { if (!open) onClose(); }}>
          <SheetContent side="right" className="w-full sm:max-w-3xl p-0">
            {detailContent}
          </SheetContent>
        </Sheet>
      )}
      <AssignPersonDialog
        isOpen={isAssignDialogOpen}
        onClose={() => setIsAssignDialogOpen(false)}
        people={people}
        isLoadingPeople={isLoadingPeople}
        onAssign={handleAssignPerson}
        onCreatePerson={handleCreatePerson}
        task={taskToAssign}
        selectedTaskIds={selectedTaskIds}
      />
      <SetDueDateDialog
        isOpen={isSetDueDateDialogOpen}
        onClose={() => setIsSetDueDateDialogOpen(false)}
        onConfirm={handleConfirmSetDueDate}
      />
      <AlertDialog open={isDeleteConfirmOpen} onOpenChange={setIsDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the meeting "{meeting?.title}" and its linked chat session. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteMeeting} className="bg-destructive hover:bg-destructive/90 text-destructive-foreground">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={isResetConfirmOpen} onOpenChange={setIsResetConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset Task State?</AlertDialogTitle>
            <AlertDialogDescription>
              This will revert all tasks in this meeting to their original, AI-generated state. Any changes you've made (assignments, edits, added tasks) will be lost. Are you sure you want to proceed?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleResetTasks}>Reset</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <TaskDetailDialog
        isOpen={isTaskDetailDialogVisible}
        onClose={() => setIsTaskDetailDialogVisible(false)}
        task={taskForDetailView}
        onSave={handleSaveTaskDetails}
        people={people}
        workspaceId={workspaceId}
        boards={boards}
        currentBoardId={taskForDetailView?.addedToBoardId ?? null}
        onMoveToBoard={handleMoveTaskToBoard}
        getBriefContext={getBriefContext}
        shareTitle={meeting?.title || "Meeting"}
      />
      <Dialog open={!!activePerson} onOpenChange={(open) => { if (!open) setActivePerson(null); }}>
        <DialogContent className="sm:max-w-md">
          {activePerson && (
            <>
              <DialogHeader>
                <DialogTitle>{activePerson.person.name || "Person Details"}</DialogTitle>
                <DialogDescription>
                  {activePerson.existingPerson
                    ? "Saved in your people directory."
                    : "Not yet saved in your people directory."}
                </DialogDescription>
              </DialogHeader>
              <div className="flex items-center gap-3">
                <Avatar className="h-12 w-12">
                  <AvatarImage src={activePerson.person.avatarUrl || `https://api.dicebear.com/8.x/initials/svg?seed=${activePerson.person.name}`} />
                  <AvatarFallback>{getInitials(activePerson.person.name)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate">{activePerson.person.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{activePerson.person.title || "No title"}</p>
                  <p className="text-xs text-muted-foreground truncate">{activePerson.person.email || "No email"}</p>
                </div>
              </div>
              <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Role</span>
                  <span className="capitalize">{activePerson.role}</span>
                </div>
              </div>
              <DialogFooter>
                {activePerson.existingPerson ? (
                  <Button variant="outline" asChild>
                    <Link href={`/people/${activePerson.existingPerson.id}`}>Open Profile</Link>
                  </Button>
                ) : (
                  <Button onClick={() => handleAddPersonFromDialog(activePerson.person)}>
                    <UserPlus className="mr-2 h-4 w-4" />
                    Add to People
                  </Button>
                )}
                <Button variant="outline" onClick={() => setActivePerson(null)}>Close</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
      {meeting && (
        <ShareToSlackDialog
          isOpen={isShareToSlackOpen}
          onClose={() => setIsShareToSlackOpen(false)}
          tasks={selectedTasks}
          sessionTitle={meeting.title}
        />
      )}
      {meeting && (
        <PushToGoogleTasksDialog
          isOpen={isPushToGoogleOpen}
          onClose={() => setIsPushToGoogleOpen(false)}
          tasks={selectedTasks}
        />
      )}
      {meeting && (
        <PushToTrelloDialog
          isOpen={isPushToTrelloOpen}
          onClose={() => setIsPushToTrelloOpen(false)}
          tasks={selectedTasks}
        />
      )}
      <PeopleDiscoveryDialog
        isOpen={isDiscoveryDialogOpen}
        onClose={handleDiscoveryDialogClose}
        onMatch={handleMatchExistingPerson}
        discoveredPeople={selectableMeetingPeople}
        existingPeople={people}
      />
      <SelectionViewDialog
        isOpen={isSelectionViewVisible}
        onClose={() => setIsSelectionViewVisible(false)}
        tasks={selectedTasks}
      />
    </>
  );
}

type FilterOption = "all" | "today" | "this_week";
type FathomSyncRange = "today" | "this_week" | "last_week" | "this_month" | "all";

export default function MeetingsPageContent() {
  const {
    meetings,
    isLoadingMeetingHistory,
    updateMeeting,
    deleteMeetings,
    refreshMeetings,
  } = useMeetingHistory();
  const { sessions, createNewSession, setActiveSessionId } = useChatHistory();
  const { openPasteDialog } = usePasteAction();
  const { isFathomConnected } = useIntegrations();
  const [openId, setOpenId] = useState<string | null>(null);
  const { toast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState<FilterOption>("all");
  const [isSyncingFathom, setIsSyncingFathom] = useState(false);
  const [isRestoringFathom, setIsRestoringFathom] = useState(false);
  const [fathomSyncRange, setFathomSyncRange] = useState<FathomSyncRange>("this_week");
  const lastMeetingIdsRef = useRef<Set<string>>(new Set());
  const hasInitializedMeetingPoll = useRef(false);
  const [selectedMeetingIds, setSelectedMeetingIds] = useState<Set<string>>(new Set());
  const [isBulkDeleteMeetingsOpen, setIsBulkDeleteMeetingsOpen] = useState(false);

  const clearDuplicateChatLinks = useCallback(
    async (chatSessionId: string, meetingId: string) => {
      const duplicates = meetings.filter(
        (item) => item.chatSessionId === chatSessionId && item.id !== meetingId
      );
      if (duplicates.length === 0) return;
      await Promise.all(
        duplicates.map((duplicate) =>
          updateMeeting(duplicate.id, { chatSessionId: null })
        )
      );
    },
    [meetings, updateMeeting]
  );

  useEffect(() => {
    const meetingToOpen = searchParams.get('open');
    if (meetingToOpen) {
      setOpenId(meetingToOpen);
      // Clean the URL
      router.replace('/meetings', { scroll: false });
    }
  }, [searchParams, router]);

  useEffect(() => {
    lastMeetingIdsRef.current = new Set(meetings.map((meeting) => meeting.id));
  }, [meetings]);

  useEffect(() => {
    setSelectedMeetingIds((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set<string>();
      meetings.forEach((meeting) => {
        if (prev.has(meeting.id)) {
          next.add(meeting.id);
        }
      });
      return next;
    });
  }, [meetings]);

  useEffect(() => {
    if (!isFathomConnected) return;
    let isActive = true;

    const pollForNewMeetings = async () => {
      try {
        const latestMeetings = await apiFetch<Meeting[]>("/api/meetings");
        if (!isActive) return;
        const latestIds = new Set(latestMeetings.map((meeting) => meeting.id));

        if (!hasInitializedMeetingPoll.current) {
          lastMeetingIdsRef.current = latestIds;
          hasInitializedMeetingPoll.current = true;
          return;
        }

        const previousIds = lastMeetingIdsRef.current;
        const newlyAdded = latestMeetings.filter((meeting) => !previousIds.has(meeting.id));
        if (newlyAdded.length > 0) {
          lastMeetingIdsRef.current = latestIds;
          await refreshMeetings();
          toast({
            title: "New meeting imported",
            description: `${newlyAdded.length} new meeting${newlyAdded.length === 1 ? "" : "s"} added from Fathom.`,
          });
        }
      } catch (error) {
        console.error("Failed to check for new meetings:", error);
      }
    };

    pollForNewMeetings();
    const interval = setInterval(pollForNewMeetings, 20000);
    return () => {
      isActive = false;
      clearInterval(interval);
    };
  }, [isFathomConnected, refreshMeetings, toast]);

  const [isNavigatingToChat, setIsNavigatingToChat] = useState(false);

  const handleChatNavigation = async (meeting: Meeting) => {
    if (isNavigatingToChat) return;
    setIsNavigatingToChat(true);
    try {
      const sessionFromMeeting = meeting.chatSessionId
        ? sessions.find((session) => session.id === meeting.chatSessionId)
        : undefined;
      const sessionFromLookup = sessions.find(
        (session) => session.sourceMeetingId === meeting.id
      );
      const existingSession = sessionFromMeeting || sessionFromLookup;

      if (existingSession) {
        await clearDuplicateChatLinks(existingSession.id, meeting.id);
        if (meeting.chatSessionId !== existingSession.id) {
          await updateMeeting(meeting.id, { chatSessionId: existingSession.id });
        }
        setActiveSessionId(existingSession.id);
        router.push('/chat');
        return;
      }

      toast({ title: 'Creating Chat Session...' });
      const newSession = await createNewSession({
        title: `Chat about "${meeting.title}"`,
        sourceMeetingId: meeting.id,
        initialTasks: getExtractedTasks(meeting.extractedTasks),
        initialPeople: meeting.attendees,
      });

      if (newSession) {
        await clearDuplicateChatLinks(newSession.id, meeting.id);
        await updateMeeting(meeting.id, { chatSessionId: newSession.id });
        setActiveSessionId(newSession.id);
        router.push('/chat');
      } else {
        toast({ title: 'Error', description: 'Could not create chat session.', variant: 'destructive' });
        setIsNavigatingToChat(false);
      }
    } catch (error) {
      console.error("Navigation error:", error);
      setIsNavigatingToChat(false);
    }
  };

  const getFathomRangeLabel = (range: FathomSyncRange) => {
    switch (range) {
      case "today":
        return "Today";
      case "this_week":
        return "This Week";
      case "last_week":
        return "Last Week";
      case "this_month":
        return "This Month";
      default:
        return "All Time";
    }
  };

  const handleSyncFathom = async (rangeOverride?: FathomSyncRange) => {
    if (isSyncingFathom) return;
    setIsSyncingFathom(true);
    try {
      const rangeToUse = rangeOverride || fathomSyncRange;
      if (rangeOverride) {
        setFathomSyncRange(rangeOverride);
      }
      const response = await fetch(`/api/fathom/sync?range=${rangeToUse}`, { method: "POST" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || "Fathom sync failed.");
      }
      await refreshMeetings();
      toast({
        title: "Fathom Sync Complete",
        description: `Imported ${payload.created || 0} meetings, skipped ${payload.skipped || 0}.`,
      });
    } catch (error) {
      console.error("Fathom sync failed:", error);
      toast({
        title: "Fathom Sync Failed",
        description: error instanceof Error ? error.message : "Could not sync meetings.",
        variant: "destructive",
      });
    } finally {
      setIsSyncingFathom(false);
    }
  };

  const handleRestoreFathomMeetings = async () => {
    if (isRestoringFathom) return;
    setIsRestoringFathom(true);
    try {
      const response = await fetch("/api/fathom/restore", { method: "POST" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || "Restore failed.");
      }
      await refreshMeetings();
      const restored = payload.restored || 0;
      toast({
        title: "Deleted meetings restored",
        description: `Restored ${restored} meeting${restored === 1 ? "" : "s"}.`,
      });
    } catch (error) {
      console.error("Fathom restore failed:", error);
      toast({
        title: "Restore failed",
        description: error instanceof Error ? error.message : "Could not restore meetings.",
        variant: "destructive",
      });
    } finally {
      setIsRestoringFathom(false);
    }
  };

  const filteredMeetings = useMemo(() => {
    let meetingsToFilter = [...meetings];

    // Apply date filter
    if (filter === "today") {
      meetingsToFilter = meetingsToFilter.filter(m => {
        const date = toDateValue(m.lastActivityAt);
        return date ? isToday(date) : false;
      });
    } else if (filter === "this_week") {
      meetingsToFilter = meetingsToFilter.filter(m => {
        const date = toDateValue(m.lastActivityAt);
        return date ? isSameWeek(date, new Date(), { weekStartsOn: 1 }) : false;
      });
    }

    // Apply search query
    if (searchQuery) {
      const lowercasedQuery = searchQuery.toLowerCase();
      meetingsToFilter = meetingsToFilter.filter(m =>
        m.title.toLowerCase().includes(lowercasedQuery) ||
        m.summary?.toLowerCase().includes(lowercasedQuery) ||
        (m.attendees || []).some(a => a.name.toLowerCase().includes(lowercasedQuery))
      );
    }

    return meetingsToFilter;

  }, [meetings, searchQuery, filter]);

  const selectedVisibleCount = useMemo(
    () => filteredMeetings.filter((meeting) => selectedMeetingIds.has(meeting.id)).length,
    [filteredMeetings, selectedMeetingIds]
  );

  const allVisibleSelected =
    filteredMeetings.length > 0 && selectedVisibleCount === filteredMeetings.length;

  const handleToggleMeetingSelection = useCallback(
    (meetingId: string, checked: boolean) => {
      setSelectedMeetingIds((prev) => {
        const next = new Set(prev);
        if (checked) {
          next.add(meetingId);
        } else {
          next.delete(meetingId);
        }
        return next;
      });
    },
    []
  );

  const handleSelectAllMeetings = useCallback(() => {
    setSelectedMeetingIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        filteredMeetings.forEach((meeting) => next.delete(meeting.id));
      } else {
        filteredMeetings.forEach((meeting) => next.add(meeting.id));
      }
      return next;
    });
  }, [allVisibleSelected, filteredMeetings]);

  const handleClearMeetingSelection = useCallback(() => {
    setSelectedMeetingIds(new Set());
  }, []);

  const handleBulkDeleteMeetings = useCallback(async () => {
    if (selectedMeetingIds.size === 0) return;
    const ids = Array.from(selectedMeetingIds);
    await deleteMeetings(ids);
    if (openId && selectedMeetingIds.has(openId)) {
      setOpenId(null);
    }
    setSelectedMeetingIds(new Set());
    setIsBulkDeleteMeetingsOpen(false);
  }, [deleteMeetings, openId, selectedMeetingIds]);


  const groupedMeetings = useMemo(() => {
    if (!filteredMeetings) return [];

    const groupMeetingsByDate = (meetingsToSort: Meeting[]) => {
      const groups: { [key: string]: Meeting[] } = {};

      meetingsToSort.forEach(meeting => {
        const date = toDateValue(meeting.lastActivityAt);
        if (!date) return;

        if (isToday(date)) {
          groups['Today'] = groups['Today'] || [];
          groups['Today'].push(meeting);
        } else if (isYesterday(date)) {
          groups['Yesterday'] = groups['Yesterday'] || [];
          groups['Yesterday'].push(meeting);
        } else if (isSameWeek(date, new Date(), { weekStartsOn: 1 })) {
          groups['This Week'] = groups['This Week'] || [];
          groups['This Week'].push(meeting);
        } else if (isSameWeek(date, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), { weekStartsOn: 1 })) {
          groups['Last Week'] = groups['Last Week'] || [];
          groups['Last Week'].push(meeting);
        } else {
          const key = format(date, 'MMMM yyyy');
          groups[key] = groups[key] || [];
          groups[key].push(meeting);
        }
      });

      const groupOrder = ['Today', 'Yesterday', 'This Week', 'Last Week'];
      const sortedGroupedMeetings = groupOrder
        .filter(key => groups[key])
        .map(key => ({ label: key, meetings: groups[key] }));

      Object.keys(groups)
        .filter(key => !groupOrder.includes(key))
        .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())
        .forEach(key => {
          sortedGroupedMeetings.push({ label: key, meetings: groups[key] });
        });

      return sortedGroupedMeetings;
    };

    return groupMeetingsByDate(filteredMeetings);
  }, [filteredMeetings]);

  if (isLoadingMeetingHistory) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  if (meetings.length === 0 && !isLoadingMeetingHistory) {
    return (
      <>
        <DashboardHeader pageIcon={Video} pageTitle={<h1 className="text-2xl font-bold font-headline">Meetings</h1>} />
        <div className="flex-grow flex items-center justify-center p-8">
          <Card className="max-w-lg text-center p-8 border-dashed shadow-none bg-card/50 backdrop-blur-sm">
            <CardHeader>
              <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                <Video className="h-8 w-8 text-primary" />
              </div>
              <CardTitle className="text-2xl font-headline">Log Your First Meeting</CardTitle>
              <CardDescription className="text-base">
                Transform your conversations into actionable insights.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-muted-foreground">
                Simply paste a meeting transcript anywhere in the app (<kbd className="px-2 py-1.5 text-xs font-mono text-foreground bg-muted border rounded-md">Ctrl+V</kbd>) to get started. Or, head over to the chat to begin a new conversation.
              </p>
              <div className="flex flex-wrap justify-center gap-4">
                <Button asChild>
                  <Link href="/chat">
                    <MessageSquareText className="mr-2 h-4 w-4" />
                    Go to Chat
                  </Link>
                </Button>
                <Button variant="secondary" onClick={() => openPasteDialog('')}>
                  <ClipboardPaste className="mr-2 h-4 w-4" />
                  Quick Paste
                </Button>
                {isFathomConnected ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" disabled={isSyncingFathom || isRestoringFathom}>
                        {isSyncingFathom ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <RefreshCw className="mr-2 h-4 w-4" />
                        )}
                        Sync Fathom
                        <span className="ml-2 text-xs text-muted-foreground">
                          ({getFathomRangeLabel(fathomSyncRange)})
                        </span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuItem onSelect={() => handleSyncFathom("today")}>Sync Today</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => handleSyncFathom("this_week")}>Sync This Week</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => handleSyncFathom("last_week")}>Sync Last Week</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => handleSyncFathom("this_month")}>Sync This Month</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => handleSyncFathom("all")}>Sync All Time</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onSelect={handleRestoreFathomMeetings}
                        disabled={isRestoringFathom || isSyncingFathom}
                      >
                        Restore deleted meetings
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : (
                  <Button variant="outline" asChild>
                    <Link href="/settings">
                      <Webhook className="mr-2 h-4 w-4" />
                      Connect Fathom
                    </Link>
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background">
      <DashboardHeader pageIcon={Video} pageTitle={<h1 className="text-2xl font-bold font-headline">Meetings</h1>}>
        <div className="flex items-center gap-2">
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search meetings..." className="pl-9 h-9" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
          </div>
          {isFathomConnected && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-9" disabled={isSyncingFathom || isRestoringFathom}>
                  {isSyncingFathom ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-2 h-4 w-4" />
                  )}
                  Sync Fathom
                  <span className="ml-2 text-xs text-muted-foreground">
                    ({getFathomRangeLabel(fathomSyncRange)})
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onSelect={() => handleSyncFathom("today")}>Sync Today</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => handleSyncFathom("this_week")}>Sync This Week</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => handleSyncFathom("last_week")}>Sync Last Week</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => handleSyncFathom("this_month")}>Sync This Month</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => handleSyncFathom("all")}>Sync All Time</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={handleRestoreFathomMeetings}
                  disabled={isRestoringFathom || isSyncingFathom}
                >
                  Restore deleted meetings
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" className="h-9 w-9"><Filter className="h-4 w-4" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Filter by Date</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={filter} onValueChange={(v) => setFilter(v as FilterOption)}>
                <DropdownMenuRadioItem value="all">All Time</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="today">Today</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="this_week">This Week</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="outline"
            size="sm"
            className="h-9"
            onClick={handleSelectAllMeetings}
            disabled={filteredMeetings.length === 0}
          >
            {allVisibleSelected ? "Clear selection" : "Select all"}
          </Button>
        </div>
      </DashboardHeader>

      <ScrollArea className="flex-grow">
        <div className="p-4 sm:p-6 lg:p-8 space-y-6">
          <MeetingStatsBar meetings={filteredMeetings} />

          <div className="mt-6">
            {groupedMeetings.length > 0 ? groupedMeetings.map((group) => (
              <React.Fragment key={group.label}>
                <DateSeparator label={group.label} />
                <div className="space-y-4">
                  {group.meetings.map((m) => (
                    <MeetingListItem
                      key={m.id}
                      m={m}
                      onOpen={(id) => setOpenId(id)}
                      onChat={handleChatNavigation}
                      isSelected={selectedMeetingIds.has(m.id)}
                      onToggleSelection={(checked) =>
                        handleToggleMeetingSelection(m.id, checked)
                      }
                    />
                  ))}
                </div>
              </React.Fragment>
            )) : (
              <div className="text-center py-20 text-muted-foreground">
                <Search className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <h3 className="text-lg font-semibold">No Meetings Found</h3>
                <p>Your search for "{searchQuery}" did not match any meetings.</p>
              </div>
            )}
          </div>

          <div className="h-10" />
        </div>
      </ScrollArea>

      <MeetingDetailSheet id={openId} onClose={() => setOpenId(null)} onNavigateToChat={handleChatNavigation} />
      <SelectionToolbar
        selectedCount={selectedMeetingIds.size}
        onDelete={() => setIsBulkDeleteMeetingsOpen(true)}
        onClear={handleClearMeetingSelection}
      />
      <AlertDialog
        open={isBulkDeleteMeetingsOpen}
        onOpenChange={setIsBulkDeleteMeetingsOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete selected meetings?</AlertDialogTitle>
            <AlertDialogDescription>
              This hides the meetings and removes all tasks extracted from them. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleBulkDeleteMeetings}
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
