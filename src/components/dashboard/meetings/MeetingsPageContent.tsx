
// src/components/dashboard/meetings/MeetingsPageContent.tsx
"use client";

import React, { useMemo, useState, useCallback, useEffect } from "react";
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
import { Textarea } from "@/components/ui/textarea";
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
  CheckCircle2,
  FileText,
  Download,
  Share2,
  Link2,
  MoreHorizontal,
  Mic,
  FileDown,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Webhook,
  ClipboardPaste,
  Video,
  UserPlus,
  Trash2,
  Edit2,
  Copy,
  CalendarDays,
  Edit3,
  Slack,
  Info,
  Paperclip,
  Check,
  RefreshCw,
  UserCheck,
  Megaphone,
  Eye,
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
import { format, formatDistanceToNow, isSameDay, isSameWeek, isToday, isYesterday, startOfWeek } from 'date-fns';
import { useSearchParams, useRouter } from 'next/navigation';
import { useToast } from "@/hooks/use-toast";
import Link from 'next/link';
import type { Meeting } from "@/types/meeting";
import type { ExtractedTaskSchema } from '@/types/chat';
import AssignPersonDialog from '../planning/AssignPersonDialog';
import { useAuth } from '@/contexts/AuthContext';
import { onPeopleSnapshot, addPerson } from '@/lib/data';
import type { Person } from '@/types/person';
import { cn } from "@/lib/utils";
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

const toDateValue = (value: any) =>
  value?.toDate ? value.toDate() : value ? new Date(value) : null;

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


function MeetingListItem({ m, onOpen, onChat }: { m: Meeting; onOpen: (id: string) => void; onChat: (meeting: Meeting) => void; }) {
  const router = useRouter();
  const flavor = flavorMap[(m.tags?.[0] || 'default').toLowerCase() as keyof typeof flavorMap] || flavorMap.default;

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
                <span>{(m.extractedTasks || []).length} Actions</span>
            </div>
            <div className="col-span-2 text-sm text-muted-foreground">
                {toDateValue(m.lastActivityAt)
                  ? formatDistanceToNow(toDateValue(m.lastActivityAt) as Date, { addSuffix: true })
                  : 'Just now'}
            </div>
            <div className="col-span-1 flex justify-end opacity-0 group-hover/item:opacity-100 transition-opacity">
                <TooltipProvider>
                    <Tooltip><TooltipTrigger asChild><Button size="icon" variant="ghost" className="h-7 w-7 rounded-full" onClick={(e) => handleNavigation(e, `/planning?fromMeeting=${m.id}`)}><Brain className="h-4 w-4 text-white/70"/></Button></TooltipTrigger><TooltipContent><p>Go to Plan</p></TooltipContent></Tooltip>
                    <Tooltip><TooltipTrigger asChild><Button size="icon" variant="ghost" className="h-7 w-7 rounded-full" onClick={(e) => onChat(m)}><MessageSquareText className="h-4 w-4 text-white/70"/></Button></TooltipTrigger><TooltipContent><p>Go to Chat</p></TooltipContent></Tooltip>
                </TooltipProvider>
            </div>
        </div>
      </div>
    </motion.div>
  );
}

function MeetingStatsBar({ meetings }: { meetings: any[] }) {
  const total = meetings.length;
  const actions = meetings.reduce((s, m) => s + (m.extractedTasks?.length || 0), 0);
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
        <StatPill label="Open Actions" value={actions} />
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

const TaskRow: React.FC<{ 
    task: ExtractedTaskSchema; 
    onAssign: () => void; 
    onDelete: () => void; 
    onToggleSelection: (id: string, checked: boolean) => void;
    onViewDetails: (task: ExtractedTaskSchema) => void;
    isSelected: boolean; 
    isIndeterminate: boolean;
    level: number;
    selectedTaskIds: Set<string>;
    getCheckboxState: (task: ExtractedTaskSchema, selectedIds: Set<string>) => 'checked' | 'unchecked' | 'indeterminate';
}> = ({ task, onAssign, onDelete, onToggleSelection, onViewDetails, isSelected, isIndeterminate, level, selectedTaskIds, getCheckboxState }) => {
    const [isExpanded, setIsExpanded] = useState(true);
    const hasSubtasks = task.subtasks && task.subtasks.length > 0;
    const assigneeName = task.assignee?.name || task.assigneeName || 'Unassigned';

    return (
        <div className={cn("flex flex-col", level > 0 && "pl-5 mt-2 border-l-2 border-border/30")}>
            <div className="flex items-start justify-between gap-3 rounded-xl border bg-card px-3 py-2 group">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                    <Checkbox id={`task-${task.id}`} checked={isIndeterminate ? 'indeterminate' : isSelected} onCheckedChange={(checked) => onToggleSelection(task.id, !!checked)} />
                    {hasSubtasks ? (
                        <button onClick={() => setIsExpanded(!isExpanded)} className="p-1">
                            <ChevronDown size={14} className={cn("transition-transform", !isExpanded && "-rotate-90")} />
                        </button>
                    ) : <div className="w-6"/>}
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
                            onViewDetails={onViewDetails}
                            level={level + 1} 
                            onToggleSelection={onToggleSelection} 
                            isSelected={selectedTaskIds.has(subtask.id)}
                            isIndeterminate={getCheckboxState(subtask, selectedTaskIds) === 'indeterminate'}
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
            <AvatarFallback className="text-[10px]">{p.name.slice(0,2)}</AvatarFallback>
            </Avatar>
        ))}
        {people.length > 3 && (
            <div className={`h-${size} w-${size} rounded-full bg-muted text-[10px] grid place-content-center ring-2 ring-background`}>+{people.length-3}</div>
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
}: {
  p: MeetingPerson;
  role: "attendee" | "mentioned";
  isSelected: boolean;
  onToggleSelection: (checked: boolean) => void;
  onOpen: () => void;
  isInDirectory: boolean;
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
    const hasArtifacts = artifacts && artifacts.length > 0;
    const { toast } = useToast();

    const handleCopyTranscript = async () => {
        if (!originalTranscript) return;
        const result = await copyTextToClipboard(originalTranscript);
        if (result.success) {
            toast({ title: "Transcript copied", description: "The full transcript is on your clipboard." });
        } else {
            toast({ title: "Copy failed", description: "Could not copy the transcript.", variant: "destructive" });
        }
    };

    const getIconForType = (type: string) => {
        switch (type) {
            case 'transcript': return <FileText className="h-5 w-5 text-blue-500" />;
            case 'recording': return <Mic className="h-5 w-5 text-red-500" />;
            case 'chat': return <MessageSquareText className="h-5 w-5 text-green-500" />;
            default: return <Paperclip className="h-5 w-5 text-muted-foreground" />;
        }
    };
    
    return (
        <div className="space-y-4">
            {originalTranscript && (
                 <Card>
                    <CardHeader className="flex flex-row items-center justify-between">
                        <CardTitle className="text-sm flex items-center gap-2">
                           <FileText className="h-4 w-4" />
                           Full Transcript
                        </CardTitle>
                        <Button variant="ghost" size="sm" className="h-7 gap-1" onClick={handleCopyTranscript}>
                            <Copy className="h-3.5 w-3.5" />
                            Copy
                        </Button>
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

            {hasArtifacts && artifacts.map((artifact, index) => (
                <a 
                    key={index}
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

            {!hasArtifacts && !originalTranscript && (
                <div className="text-center py-8">
                    <p className="text-muted-foreground">No artifacts or transcript found for this meeting.</p>
                </div>
            )}
        </div>
    );
}
  
function MeetingDetailSheet({ id, onClose, onNavigateToChat }: { id: string | null; onClose: () => void; onNavigateToChat: (meeting: Meeting) => void; }) {
    const { user } = useAuth();
    const { meetings, isLoadingMeetingHistory, updateMeeting, deleteMeeting } = useMeetingHistory();
    const { isSlackConnected, isGoogleTasksConnected, isTrelloConnected } = useIntegrations();
    const [people, setPeople] = useState<Person[]>([]);
    const [isLoadingPeople, setIsLoadingPeople] = useState(true);
    const [isAssignDialogOpen, setIsAssignDialogOpen] = useState(false);
    const [taskToAssign, setTaskToAssign] = useState<ExtractedTaskSchema | null>(null);
    const [filterByPerson, setFilterByPerson] = useState<string>('all');
    const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
    const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);
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

    const meeting = useMemo(() => meetings.find((m) => m.id === id) || null, [id, meetings]);
    const { toast } = useToast();

    useEffect(() => {
        if (meeting) {
            setEditableTitle(meeting.title);
            setSelectedTaskIds(new Set()); // Clear selection when meeting changes
            setSelectedPeopleKeys(new Set());
            setActivePerson(null);
            
            // Check for new people when a meeting is opened
            const hasSeenPopup = sessionStorage.getItem(`seen-people-popup-${meeting.id}`);
            if (user?.onboardingCompleted && meeting.attendees?.length > 0 && !hasSeenPopup) {
                setIsDiscoveryDialogOpen(true);
                sessionStorage.setItem(`seen-people-popup-${meeting.id}`, 'true');
            }
        }
    }, [meeting, user?.onboardingCompleted]);

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


    const allMeetingTaskIds = useMemo(() => {
      if (!meeting?.extractedTasks) return new Set<string>();
      const ids = new Set<string>();
      const collectIds = (tasks: ExtractedTaskSchema[]) => {
        tasks.forEach(task => {
          ids.add(task.id);
          if (task.subtasks) collectIds(task.subtasks);
        });
      };
      collectIds(meeting.extractedTasks);
      return ids;
    }, [meeting?.extractedTasks]);

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

            const task = findTaskRecursive(meeting.extractedTasks, taskId);
            
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

    const findExistingPerson = useCallback((person: MeetingPerson) => {
        if (person.email) {
            const byEmail = peopleByEmail.get(person.email.toLowerCase());
            if (byEmail) return byEmail;
        }
        return peopleByName.get(person.name.toLowerCase()) || null;
    }, [peopleByEmail, peopleByName]);

    const allMeetingPeople = useMemo(() => meeting?.attendees || [], [meeting]);

    const allMeetingPeopleKeys = useMemo(() => {
        return new Set(allMeetingPeople.map(getMeetingPersonKey));
    }, [allMeetingPeople]);

    const selectedPeople = useMemo(() => {
        return allMeetingPeople.filter((person) => selectedPeopleKeys.has(getMeetingPersonKey(person)));
    }, [allMeetingPeople, selectedPeopleKeys]);

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
                let updatedTask = { ...t };
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
    
        const updatedTasks = updateTasks(meeting.extractedTasks || []);
        await updateMeeting(meeting.id, { extractedTasks: updatedTasks });
        
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
        } catch(e) {
            toast({ title: "Error", description: "Could not create person.", variant: "destructive" });
        }
        return undefined;
    };

    const handleViewDetails = (task: ExtractedTaskSchema) => {
      setTaskForDetailView(task);
      setIsTaskDetailDialogVisible(true);
    };

    const handleSaveTaskDetails = (updatedTask: ExtractedTaskSchema, options?: { close?: boolean }) => {
        if (!meeting) return;
        const updateRecursively = (tasks: ExtractedTaskSchema[]): ExtractedTaskSchema[] => {
          return tasks.map(t => {
            if (t.id === updatedTask.id) return updatedTask;
            if (t.subtasks) return { ...t, subtasks: updateRecursively(t.subtasks) };
          return t;
        });
        };
        const updatedTasks = updateRecursively(meeting.extractedTasks || []);
        updateMeeting(meeting.id, { extractedTasks: updatedTasks });
        if (options?.close !== false) {
          setIsTaskDetailDialogVisible(false);
        }
        toast({ title: "Task Updated" });
      };
    
    const flavor = meeting ? flavorMap[meeting.tags?.[0].toLowerCase() as keyof typeof flavorMap || 'default'] : null;
    const meetingDurationMinutes = useMemo(() => getMeetingDurationMinutes(meeting || null), [meeting]);

    const filteredTasks = useMemo(() => {
        if (!meeting) return [];
        const tasks = meeting.extractedTasks || [];
        if (filterByPerson === 'all') return tasks;
        if (filterByPerson === 'unassigned') return tasks.filter(t => !t.assignee && !t.assigneeName);
        
        const selectedPerson = (meeting.attendees || []).find(p => p.name === filterByPerson);
        if (!selectedPerson) return tasks;

        return tasks.filter(t => t.assignee?.name === selectedPerson.name || t.assigneeName === selectedPerson.name);
    }, [meeting, filterByPerson]);

    const groupedTasks = useMemo(() => {
        const groups = new Map<string, ExtractedTaskSchema[]>();
        filteredTasks.forEach((task) => {
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
    }, [filteredTasks]);
    
    const handleDeleteMeeting = async () => {
        if (!meeting) return;
        try {
            await deleteMeeting(meeting.id);
            toast({ title: "Meeting Deleted", description: `"${meeting.title}" and all linked sessions have been removed.` });
            onClose(); // Close the sheet after deletion
        } catch (error) {
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

        const updatedTasks = filterTasks(meeting.extractedTasks || [], taskId);
        await updateMeeting(meeting.id, { extractedTasks: updatedTasks });
        toast({ title: "Task Deleted", description: "The task has been removed from this meeting." });
    };

    const handleDeleteSelectedTasks = async () => {
        if (!meeting || selectedTaskIds.size === 0) return;
        
        let tasksAfterDeletion = [...(meeting.extractedTasks || [])];
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

        await updateMeeting(meeting.id, { extractedTasks: tasksAfterDeletion });
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

        await updateMeeting(meeting.id, { extractedTasks: initialTasks });

        toast({ title: "Tasks Reset", description: "The task list has been reset to its initial state." });
        setIsResetConfirmOpen(false);
    };

    const handleSaveTitle = async () => {
      if (!meeting || !editableTitle.trim()) {
        toast({title: "Title cannot be empty", variant: "destructive"});
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

    const handleConfirmSetDueDate = (date: Date | undefined) => {
        if (!meeting) return;
        const newDueDateISO = date ? date.toISOString() : null;

        const updateDueDatesRecursively = (tasks: ExtractedTaskSchema[]): ExtractedTaskSchema[] => {
            return tasks.map(task => {
                let updatedTask = { ...task };
                if (selectedTaskIds.has(task.id)) {
                    updatedTask.dueAt = newDueDateISO;
                }
                if (task.subtasks) {
                    updatedTask.subtasks = updateDueDatesRecursively(task.subtasks);
                }
                return updatedTask;
            });
        };

        const newExtractedTasks = updateDueDatesRecursively(meeting.extractedTasks || []);
        updateMeeting(meeting.id, { extractedTasks: newExtractedTasks });
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

        const tasksToExport = getSelectedTasksRecursive(meeting.extractedTasks || []);
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
        const tasksToCopy = getSelectedTasksRecursive(meeting.extractedTasks || []);
        const textToCopy = formatTasksToText(tasksToCopy);
        const { success, method } = await copyTextToClipboard(textToCopy);
        if (success) {
            toast({ title: "Copied!", description: `Copied ${tasksToCopy.length} task branches to clipboard.` });
        } else {
            toast({ title: "Copy Failed", description: "Could not copy tasks to clipboard.", variant: "destructive" });
        }
    };


    const getSelectedTasksForIntegrations = (): ExtractedTaskSchema[] => {
        if (!meeting) return [];
        const getSelected = (tasks: ExtractedTaskSchema[]): ExtractedTaskSchema[] => {
            return tasks.reduce((acc, task) => {
                if (selectedTaskIds.has(task.id)) {
                    acc.push(task);
                } else if (task.subtasks) {
                    const selectedChildren = getSelected(task.subtasks);
                    if (selectedChildren.length > 0) {
                        acc.push({ ...task, subtasks: selectedChildren });
                    }
                }
                return acc;
            }, [] as ExtractedTaskSchema[]);
        };
        return getSelected(meeting.extractedTasks || []);
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

    const handleDiscoveryDialogClose = async (peopleToCreate: any[]) => {
      setIsDiscoveryDialogOpen(false);
      if (!user || !id) return;
  
      if (peopleToCreate.length > 0) {
        toast({
          title: "Adding New People...",
          description: `Saving ${peopleToCreate.length} new people to your directory.`,
        });
  
        const addPromises = peopleToCreate.map(person => addPerson(user.uid, person, id));
        await Promise.all(addPromises);
        toast({ title: "People Added!", description: "New people have been saved to your directory."});
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
            const personKey = getMeetingPersonKey(person);
            if (seenKeys.has(personKey)) return false;
            seenKeys.add(personKey);

            if (forceUnique) return true;
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
        await updateMeeting(meeting.id, { attendees: updatedAttendees });
        setSelectedPeopleKeys(new Set());
        toast({ title: "People removed", description: `${selectedPeople.length} people removed from this meeting.` });
    };

    const handleAddPersonFromDialog = async (person: MeetingPerson) => {
        await handleAddPeopleToDirectory([person], false);
        setActivePerson(null);
    };

    const attendees = useMemo(() => (meeting?.attendees || []).filter(p => p.role === 'attendee'), [meeting]);
    const mentionedPeople = useMemo(() => (meeting?.attendees || []).filter(p => p.role === 'mentioned'), [meeting]);
    
    const selectedTasks = useMemo(() => {
        if (!meeting) return [];
        return getSelectedTasksRecursive(meeting.extractedTasks || []);
    }, [selectedTaskIds, meeting]);


    if (isLoadingMeetingHistory && id) {
      return (
        <Sheet open={true} onOpenChange={onClose}>
          <SheetContent side="right" className="w-full sm:max-w-2xl p-0">
             <div className="flex items-center justify-center h-full">
                <Loader2 className="h-8 w-8 animate-spin"/>
             </div>
          </SheetContent>
        </Sheet>
      );
    }
    
    return (
      <>
        <Sheet open={!!id} onOpenChange={(open) => { if (!open) onClose(); }}>
            <SheetContent side="right" className="w-full sm:max-w-3xl p-0">
            {meeting && flavor && (
            <>
            <div className="h-full grid grid-rows-[auto,1fr,auto]">
                <div className="relative px-6 pt-6 pb-4 border-b">
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
                          <Edit2 className="h-4 w-4"/>
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
                        <span className="flex items-center gap-1"><Users className="h-3 w-3"/>{meeting.attendees?.length || 0}</span>
                    </div>
                    </SheetDescription>
                </SheetHeader>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                    {(meeting.tags || []).map((t: string, i: number) => (<Badge key={i} variant="secondary" className="rounded-full">{t}</Badge>))}
                </div>
                <div className="mt-3 flex items-center gap-2">
                    <Button size="sm" className="h-8 gap-1"><PlayCircle className="h-4 w-4"/>Play Recording</Button>
                    <Button size="sm" variant="outline" className="h-8 gap-1"><Brain className="h-4 w-4"/>Go to Plan</Button>
                    <Button size="sm" variant="outline" className="h-8 gap-1" onClick={() => onNavigateToChat(meeting)}><MessageSquareText className="h-4 w-4"/>Go to Chat</Button>
                     <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8 ml-auto"><MoreHorizontal className="h-4 w-4"/></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
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
                        <TabsTrigger value="tasks">Tasks</TabsTrigger>
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
                                            {(meeting.attendees || []).map(p => (
                                                <DropdownMenuRadioItem key={p.name} value={p.name}>{p.name}</DropdownMenuRadioItem>
                                            ))}
                                        </DropdownMenuRadioGroup>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            </div>
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
                                    <h4 className="text-sm font-semibold flex items-center gap-2"><Users className="h-4 w-4 text-primary"/> Meeting Attendees</h4>
                                    {attendees.map((p, i) => (
                                        <PersonRow
                                            key={`att-${i}`}
                                            p={p}
                                            role="attendee"
                                            isSelected={selectedPeopleKeys.has(getMeetingPersonKey(p))}
                                            onToggleSelection={(checked) => handleTogglePersonSelection(getMeetingPersonKey(p), checked)}
                                            onOpen={() => handleOpenPersonDetails(p, "attendee")}
                                            isInDirectory={Boolean(findExistingPerson(p))}
                                        />
                                    ))}
                                </div>
                            )}
                            {mentionedPeople.length > 0 && (
                                <div className="space-y-2">
                                    <h4 className="text-sm font-semibold flex items-center gap-2"><Megaphone className="h-4 w-4 text-muted-foreground"/> Mentioned People</h4>
                                    {mentionedPeople.map((p, i) => (
                                        <PersonRow
                                            key={`men-${i}`}
                                            p={p}
                                            role="mentioned"
                                            isSelected={selectedPeopleKeys.has(getMeetingPersonKey(p))}
                                            onToggleSelection={(checked) => handleTogglePersonSelection(getMeetingPersonKey(p), checked)}
                                            onOpen={() => handleOpenPersonDetails(p, "mentioned")}
                                            isInDirectory={Boolean(findExistingPerson(p))}
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
            
            </>
            )}
            </SheetContent>
        </Sheet>
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
                        This will permanently delete the meeting "{meeting?.title}" and its linked Chat and Plan sessions. This action cannot be undone.
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
            discoveredPeople={meeting?.attendees || []}
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

export default function MeetingsPageContent() {
  const { meetings, isLoadingMeetingHistory, updateMeeting, deleteMeeting, refreshMeetings } = useMeetingHistory();
  const { createNewSession, setActiveSessionId } = useChatHistory();
  const { isFathomConnected } = useIntegrations();
  const [openId, setOpenId] = useState<string | null>(null);
  const { toast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState<FilterOption>("all");
  const [isSyncingFathom, setIsSyncingFathom] = useState(false);

  useEffect(() => {
    const meetingToOpen = searchParams.get('open');
    if (meetingToOpen) {
        setOpenId(meetingToOpen);
        // Clean the URL
        router.replace('/meetings', { scroll: false });
    }
  }, [searchParams, router]);

  const handleChatNavigation = async (meeting: any) => {
    if (meeting.chatSessionId) {
      setActiveSessionId(meeting.chatSessionId);
      router.push('/chat');
    } else {
      toast({ title: 'Creating Chat Session...' });
      const newSession = await createNewSession({
        title: `Chat about "${meeting.title}"`,
        sourceMeetingId: meeting.id,
        initialTasks: meeting.extractedTasks,
        initialPeople: meeting.attendees,
      });

      if (newSession) {
        await updateMeeting(meeting.id, { chatSessionId: newSession.id });
        setActiveSessionId(newSession.id);
        router.push('/chat');
      } else {
        toast({ title: 'Error', description: 'Could not create chat session.', variant: 'destructive' });
      }
    }
  };

  const handleSyncFathom = async () => {
    if (isSyncingFathom) return;
    setIsSyncingFathom(true);
    try {
      const response = await fetch("/api/fathom/sync", { method: "POST" });
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
        .sort((a,b) => new Date(b).getTime() - new Date(a).getTime())
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
                        <Video className="h-8 w-8 text-primary"/>
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
                                <MessageSquareText className="mr-2 h-4 w-4"/>
                                Go to Chat
                            </Link>
                        </Button>
                        <Button variant="secondary" onClick={() => toast({ title: "Paste Anywhere!", description: "Press Ctrl+V or Cmd+V to open the paste dialog."})}>
                             <ClipboardPaste className="mr-2 h-4 w-4"/>
                             Quick Paste
                        </Button>
                        {isFathomConnected && (
                          <Button
                            variant="outline"
                            onClick={handleSyncFathom}
                            disabled={isSyncingFathom}
                          >
                            {isSyncingFathom ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <RefreshCw className="mr-2 h-4 w-4" />
                            )}
                            Sync Fathom
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
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"/>
                <Input placeholder="Search meetings..." className="pl-9 h-9" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
            </div>
            {isFathomConnected && (
              <Button
                variant="outline"
                size="sm"
                className="h-9"
                onClick={handleSyncFathom}
                disabled={isSyncingFathom}
              >
                {isSyncingFathom ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                Sync Fathom
              </Button>
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
                      <MeetingListItem key={m.id} m={m} onOpen={(id) => setOpenId(id)} onChat={handleChatNavigation} />
                    ))}
                  </div>
                </React.Fragment>
              )) : (
                <div className="text-center py-20 text-muted-foreground">
                    <Search className="h-12 w-12 mx-auto mb-4 opacity-50"/>
                    <h3 className="text-lg font-semibold">No Meetings Found</h3>
                    <p>Your search for "{searchQuery}" did not match any meetings.</p>
                </div>
              )}
            </div>

            <div className="h-10" />
        </div>
      </ScrollArea>

      <MeetingDetailSheet id={openId} onClose={() => setOpenId(null)} onNavigateToChat={handleChatNavigation} />
    </div>
  );
}
