// src/components/dashboard/chat/ChatPageContent.tsx
"use client";

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Send, Loader2, PlusCircle, MoreVertical, Edit, Zap as SimplifyIcon, Share2, Info, Folder as FolderIcon, FolderOpen, ClipboardPaste, Users, UserPlus, ListChecks, Network, Video, MessageSquareHeart, GripVertical, FileText, Quote, Undo2, Redo2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { extractTasksFromChat } from '@/ai/flows/extract-tasks';
import type { OrchestratorInput, OrchestratorOutput } from '@/ai/flows/schemas';
import { simplifyTaskBranch } from '@/ai/flows/simplify-task-branch-flow';
import { useToast } from "@/hooks/use-toast";
import { useChatHistory } from '@/contexts/ChatHistoryContext';
import { useFolders } from '@/contexts/FolderContext';
import { useUIState } from '@/contexts/UIStateContext';
import { useIntegrations } from '@/contexts/IntegrationsContext';
import type { Folder } from '@/types/folder';
import type { Message as ChatMessageType, ExtractedTaskSchema } from '@/types/chat';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import TaskDetailDialog from '../planning/TaskDetailDialog';
import PeopleDiscoveryDialog from '@/components/dashboard/people/PeopleDiscoveryDialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuPortal,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import { Logo } from '@/components/ui/logo';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { normalizeTask, addPerson, onPeopleSnapshot, updatePerson } from '@/lib/data';
import { extractTranscriptAttendees } from '@/lib/transcript-utils';
import { getBestPersonMatch } from '@/lib/people-matching';
import { apiFetch } from '@/lib/api';
import type { Person } from '@/types/person';
import type { Board } from '@/types/board';
import { shareTasksNative, formatTasksToText, copyTextToClipboard, exportTasksToCSV, exportTasksToMarkdown, exportTasksToPDF } from '@/lib/exportUtils';
import { moveTaskToBoard } from '@/lib/board-actions';
import AssignPersonDialog from '../planning/AssignPersonDialog';
import DashboardHeader from '../DashboardHeader';
import { RadialMenu } from './RadialMenu';
import TaskItem from '../tasks/TaskItem'; 
import { useMeetingHistory } from '@/contexts/MeetingHistoryContext';
import { usePlanningHistory } from '@/contexts/PlanningHistoryContext';
import { processPastedContent } from '@/ai/flows/process-pasted-content';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import SetDueDateDialog from '../planning/SetDueDateDialog';
import SelectionToolbar from '../common/SelectionToolbar';
import SelectionViewDialog from '../explore/SelectionViewDialog';
import ShareToSlackDialog from '../common/ShareToSlackDialog';
import PushToGoogleTasksDialog from '../common/PushToGoogleTasksDialog';
import PushToTrelloDialog from '../common/PushToTrelloDialog';
import { TASK_TYPE_LABELS, TASK_TYPE_VALUES, type TaskTypeCategory } from '@/lib/task-types';
import type { Meeting } from '@/types/meeting';
import { buildBriefContext } from "@/lib/brief-context";
import { generateTaskBrief } from "@/lib/task-insights-client";


const findTaskById = (tasks: ExtractedTaskSchema[], taskId: string): ExtractedTaskSchema | null => {
  for (const task of tasks) {
    if (task.id === taskId) return task;
    if (task.subtasks) {
      const foundInSubtask = findTaskById(task.subtasks, taskId);
      if (foundInSubtask) return foundInSubtask;
    }
  }
  return null;
};

const getTaskAndAllDescendantIds = (task: ExtractedTaskSchema): Set<string> => {
  const ids = new Set<string>();
  const queue: ExtractedTaskSchema[] = [task];
  while (queue.length > 0) {
    const current = queue.shift()!;
    ids.add(current.id);
    current.subtasks?.forEach(subTask => queue.push(subTask));
  }
  return ids;
};

const normalizePersonName = (name?: string | null): string =>
  (name || '').trim().toLowerCase();

const filterTasksByAssignee = (tasks: ExtractedTaskSchema[], personName: string): ExtractedTaskSchema[] => {
  const target = normalizePersonName(personName);
  const filterNodes = (nodes: ExtractedTaskSchema[]): ExtractedTaskSchema[] =>
    nodes
      .map((node: any) => {
        const assigneeName = normalizePersonName(node.assignee?.name || node.assigneeName || '');
        const filteredSubtasks = node.subtasks ? filterNodes(node.subtasks) : [];
        if (assigneeName === target || filteredSubtasks.length > 0) {
          return { ...node, subtasks: filteredSubtasks };
        }
        return null;
      })
      .filter(Boolean) as ExtractedTaskSchema[];
  return filterNodes(tasks);
};

const countTasksRecursive = (tasks: ExtractedTaskSchema[]): number =>
  tasks.reduce((count, task) => {
    const subCount = task.subtasks ? countTasksRecursive(task.subtasks) : 0;
    return count + 1 + subCount;
  }, 0);

const normalizeTaskType = (taskType?: string | null): TaskTypeCategory => {
  if (!taskType) return 'general';
  return TASK_TYPE_VALUES.includes(taskType as TaskTypeCategory)
    ? (taskType as TaskTypeCategory)
    : 'general';
};

const getMeetingTranscript = (meeting?: Meeting | null): string | undefined => {
  if (!meeting) return undefined;
  const direct = meeting.originalTranscript?.trim();
  if (direct) return direct;
  const artifactTranscript = meeting.artifacts?.find(
    (artifact) => artifact.type === 'transcript' && artifact.processedText?.trim()
  );
  return artifactTranscript?.processedText?.trim();
};

const truncateTitle = (title: string | undefined, maxLength: number = 20): string => {
  if (!title) return "New Chat";
  if (title.length <= maxLength) return title;
  return title.substring(0, maxLength - 3) + "...";
};

const TRANSCRIPT_TIMESTAMP_REGEX =
  /(^|\n)\s*(?:\[\d{1,2}:\d{2}(?::\d{2})?\]|\d{1,2}:\d{2}(?::\d{2})?)\b/m;

const isTranscriptLike = (text: string): boolean =>
  TRANSCRIPT_TIMESTAMP_REGEX.test(text) || extractTranscriptAttendees(text).length >= 2;


// Helper to convert nulls to undefineds for AI schema compatibility
const sanitizeTasksForAI = (tasks: ExtractedTaskSchema[]): any[] => {
  return tasks.map(task => {
    const sanitizedTask: any = { ...task };
    for (const key in sanitizedTask) {
      if (sanitizedTask[key] === null) {
        delete sanitizedTask[key];
      }
    }
    if (sanitizedTask.subtasks) {
      sanitizedTask.subtasks = sanitizeTasksForAI(sanitizedTask.subtasks);
    }
    return sanitizedTask;
  });
};

const useTypingEffect = (fullText: string, speed = 50, onFinished?: () => void) => {
    const [displayedText, setDisplayedText] = useState('');
    const words = useMemo(() => fullText.split(' '), [fullText]);

    useEffect(() => {
        setDisplayedText('');
        if (fullText) {
            let i = 0;
            const timer = setInterval(() => {
                if (i < words.length) {
                    setDisplayedText(prev => prev + (prev ? ' ' : '') + words[i]);
                    i++;
                } else {
                    clearInterval(timer);
                    if(onFinished) onFinished();
                }
            }, speed);
            return () => clearInterval(timer);
        }
    }, [fullText, words, speed, onFinished]);

    return displayedText;
};

type MessageSource = NonNullable<ChatMessageType['sources']>[number];

const MessageSourcesButton: React.FC<{ sources?: ChatMessageType['sources'] }> = ({ sources }) => {
  if (!sources || sources.length === 0) {
    return null;
  }
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground">
          <Quote className="mr-2 h-3.5 w-3.5" />
          Sources ({sources.length})
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Transcript Sources</DialogTitle>
          <DialogDescription>Evidence pulled from the meeting transcript.</DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh] pr-2">
          <div className="space-y-3">
            {sources.map((source: MessageSource, index: number) => (
              <div key={index} className="rounded-lg border border-border/60 bg-muted/40 p-3 text-sm text-muted-foreground">
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-primary">
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 font-mono">
                    {source.timestamp}
                  </span>
                  Transcript
                </div>
                <p className="text-sm text-foreground/90">"{source.snippet}"</p>
              </div>
            ))}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
};


const MessageDisplay: React.FC<{
  message: ChatMessageType;
  onShowFullText: (text: string) => void;
  onAnimationComplete: (id: string) => void;
  hasAnimated: boolean;
  onConfirmDelete: (taskTitle: string) => void;
  onCancelDelete: () => void;
}> = ({ message, onShowFullText, onAnimationComplete, hasAnimated, onConfirmDelete, onCancelDelete }) => {
  const isTyping = message.id === 'ai-typing-indicator';
  
  const handleAnimationFinish = useCallback(() => {
    onAnimationComplete(message.id);
  }, [onAnimationComplete, message.id]);

  const animatedText = useTypingEffect(message.text, 50, handleAnimationFinish);
  const displayedText = message.sender === 'ai' && !hasAnimated ? animatedText : message.text;
  
  if (isTyping) {
    return (
      <div className="flex items-end gap-2 p-3">
        <div className="h-2 w-2 bg-primary rounded-full animate-wave-breath" />
        <div className="h-2 w-2 bg-primary rounded-full animate-wave-breath" style={{ animationDelay: '0.2s' }} />
        <div className="h-2 w-2 bg-primary rounded-full animate-wave-breath" style={{ animationDelay: '0.4s' }} />
      </div>
    );
  }

  const contentPreview = message.attachedContent
    ? message.attachedContent.substring(0, 240) + (message.attachedContent.length > 240 ? '...' : '')
    : null;

  const confirmDeleteMatch =
    message.sender === 'ai'
      ? message.text.match(/Confirm deletion of\s+\"(.+?)\"/i)
      : null;

  return (
    <>
      <div className={`max-w-[78%] md:max-w-[560px] ${message.sender === 'user' ? 'self-end' : 'self-start'}`}>
        {contentPreview && (
            <div
              role="button"
              tabIndex={0}
              className="mb-2 p-3 rounded-xl shadow-md bg-muted text-muted-foreground border relative cursor-pointer hover:bg-muted/80"
              onClick={() => onShowFullText(message.attachedContent ?? '')}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onShowFullText(message.attachedContent ?? '')}
            >
              <div className="flex items-center justify-between text-xs mb-2">
                <div className="flex items-center gap-2 font-semibold text-muted-foreground">
                  <ClipboardPaste className="h-3.5 w-3.5" />
                  Pasted text
                </div>
                <Badge variant="secondary" className="text-[10px]">{message.attachedContent?.length.toLocaleString()} chars</Badge>
              </div>
              <pre className="text-xs font-mono whitespace-pre-wrap break-words">
                <code>{contentPreview}</code>
              </pre>
              <span className="absolute bottom-2 right-3 text-[10px] text-muted-foreground">Click to expand</span>
            </div>
        )}
        {message.text && (
          <div
            className={cn(
              "p-4 rounded-2xl border shadow-[0_14px_30px_-24px_rgba(0,0,0,0.55)]",
              message.sender === 'user'
                ? "bg-primary/90 text-primary-foreground border-primary/30"
                : "bg-background/70 text-card-foreground border-border/50 backdrop-blur-md"
            )}
          >
            <div className="text-sm font-body leading-relaxed whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: displayedText.replace(/\n/g, '<br />') }} />
            {message.sender === 'ai' && (
              <div className="mt-2 flex items-center gap-2">
                <MessageSourcesButton sources={message.sources} />
                {confirmDeleteMatch && (
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="destructive"
                      className="h-7 px-2 text-xs"
                      onClick={() => onConfirmDelete(confirmDeleteMatch[1])}
                    >
                      Confirm
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-xs"
                      onClick={onCancelDelete}
                    >
                      Cancel
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
};


export default function ChatPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const { toast } = useToast();
  const {
    sessions,
    activeSessionId,
    setActiveSessionId,
    getActiveSession,
    addMessageToActiveSession,
    createNewSession,
    isLoadingHistory,
    updateActiveSessionSuggestions,
    removeSuggestionFromActiveSession,
    updateSessionTitle,
    updateSession,
  } = useChatHistory();
  const { createNewPlanningSession } = usePlanningHistory();
  const { folders } = useFolders();
  const { setShowCopyHint } = useUIState();
  const { meetings, createNewMeeting, updateMeeting } = useMeetingHistory();
  const { isSlackConnected, isGoogleTasksConnected, isTrelloConnected } = useIntegrations();
  const workspaceId = user?.workspace?.id;

  const [inputValue, setInputValue] = useState('');
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [suggestedTasks, setSuggestedTasks] = useState<ExtractedTaskSchema[]>([]);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [undoStack, setUndoStack] = useState<ExtractedTaskSchema[][]>([]);
  const [redoStack, setRedoStack] = useState<ExtractedTaskSchema[][]>([]);
  
  const [isProcessingAiAction, setIsProcessingAiAction] = useState(false);
  
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editableTitle, setEditableTitle] = useState("");
  
  const [isTaskDetailDialogVisible, setIsTaskDetailDialogVisible] = useState(false);
  const [taskForDetailView, setTaskForDetailView] = useState<ExtractedTaskSchema | null>(null);
  const [isSetDueDateDialogOpen, setIsSetDueDateDialogOpen] = useState(false);
  const [isShareToSlackOpen, setIsShareToSlackOpen] = useState(false);
  const [isPushToGoogleOpen, setIsPushToGoogleOpen] = useState(false);
  const [isPushToTrelloOpen, setIsPushToTrelloOpen] = useState(false);

  const [isFullTextViewerOpen, setIsFullTextViewerOpen] = useState(false);
  const [textForViewer, setTextForViewer] = useState("");
  
  const [animatedMessages, setAnimatedMessages] = useState<Set<string>>(new Set());


  const [isAssignPersonDialogOpen, setIsAssignPersonDialogOpen] = useState(false);
  const [people, setPeople] = useState<Person[]>([]);
  const [isLoadingPeople, setIsLoadingPeople] = useState(true);
  const [boards, setBoards] = useState<Board[]>([]);
  const [isBoardPickerOpen, setIsBoardPickerOpen] = useState(false);
  const [boardPickerTask, setBoardPickerTask] = useState<ExtractedTaskSchema | null>(null);
  const [selectedBoardId, setSelectedBoardId] = useState<string>("");
  const [isAddingToBoard, setIsAddingToBoard] = useState(false);

  const [isDiscoveryDialogOpen, setIsDiscoveryDialogOpen] = useState(false);
  const [activeSidePanel, setActiveSidePanel] = useState<'tasks' | 'people' | null>('tasks');
  const [panelWidth, setPanelWidth] = useState(420);
  const [isPanelResizing, setIsPanelResizing] = useState(false);
  const [isSelectionViewVisible, setIsSelectionViewVisible] = useState(false);
  const [isTranscriptDialogOpen, setIsTranscriptDialogOpen] = useState(false);
  const [isGeneratingBriefs, setIsGeneratingBriefs] = useState(false);
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const [isTasksGrouped, setIsTasksGrouped] = useState(true);
  
  const [radialMenuState, setRadialMenuState] = useState<{ open: boolean; x: number; y: number }>({ open: false, x: 0, y: 0 });
  const [taskToDelete, setTaskToDelete] = useState<string | null>(null);
  
  const [isSimplifyConfirmOpen, setIsSimplifyConfirmOpen] = useState(false);


  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const layoutRef = useRef<HTMLDivElement>(null);
  const activeSessionIdRef = useRef<string | null>(null);
  const lastSelectionSessionIdRef = useRef<string | null>(null);
  const lastChatIdParamRef = useRef<string | null>(null);
  const hasHandledChatParamRef = useRef(false);

  const chatIdParam = searchParams.get('id');
  const searchParamsString = searchParams.toString();

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  useEffect(() => {
    if (!workspaceId) return;
    let isActive = true;
    apiFetch<Board[]>(`/api/workspaces/${workspaceId}/boards`)
      .then((boardList) => {
        if (isActive) {
          setBoards(boardList);
        }
      })
      .catch((error) => {
        console.error("Failed to load boards:", error);
        toast({
          title: "Could not load boards",
          description: error instanceof Error ? error.message : "Try again in a moment.",
          variant: "destructive",
        });
      });
    return () => {
      isActive = false;
    };
  }, [toast, workspaceId]);

  useEffect(() => {
    if (!chatIdParam) {
      lastChatIdParamRef.current = null;
      hasHandledChatParamRef.current = false;
      return;
    }

    if (lastChatIdParamRef.current !== chatIdParam) {
      lastChatIdParamRef.current = chatIdParam;
      hasHandledChatParamRef.current = false;
    }

    if (hasHandledChatParamRef.current) return;

    if (chatIdParam === activeSessionIdRef.current) {
      hasHandledChatParamRef.current = true;
      return;
    }

    const exists = sessions.some((session: any) => session.id === chatIdParam);
    if (exists) {
      setActiveSessionId(chatIdParam);
    }
    hasHandledChatParamRef.current = true;
  }, [chatIdParam, sessions, setActiveSessionId]);

  useEffect(() => {
    if (activeSessionId) {
      if (chatIdParam !== activeSessionId) {
        const params = new URLSearchParams(searchParamsString);
        params.set('id', activeSessionId);
        router.replace(`/chat?${params.toString()}`);
      }
      return;
    }
    if (chatIdParam) {
      const params = new URLSearchParams(searchParamsString);
      params.delete('id');
      const query = params.toString();
      router.replace(query ? `/chat?${query}` : "/chat");
    }
  }, [activeSessionId, chatIdParam, searchParamsString, router]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const currentMessages = getActiveSession()?.messages || [];
  const isTabletOrMobile = useIsMobile();
  
  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior, block: 'end' });
      return;
    }
    const viewport = scrollAreaRef.current?.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement | null;
    if (viewport) {
      viewport.scrollTo({ top: viewport.scrollHeight, behavior });
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [currentMessages, scrollToBottom]);

  useEffect(() => {
    if (!isPanelResizing) return;
    const handleMove = (event: MouseEvent) => {
      const container = layoutRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const rawWidth = rect.right - event.clientX;
      const minWidth = 260;
      const minChatWidth = 260;
      const maxWidth = Math.max(minWidth, rect.width - minChatWidth);
      const nextWidth = Math.max(minWidth, Math.min(maxWidth, rawWidth));
      setPanelWidth(nextWidth);
    };
    const handleUp = () => setIsPanelResizing(false);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [isPanelResizing]);

  useEffect(() => {
    if (user?.uid) {
      setIsLoadingPeople(true);
      const unsubscribe = onPeopleSnapshot(user.uid, (loadedPeople) => {
        setPeople(loadedPeople);
        setIsLoadingPeople(false);
      });
      return () => unsubscribe();
    }
  }, [user?.uid]);

  const handleShowFullText = (text: string) => {
    setTextForViewer(text);
    setIsFullTextViewerOpen(true);
  };
  
  const handleAnimationComplete = useCallback((messageId: string) => {
    setAnimatedMessages(prev => {
        const newSet = new Set(prev);
        newSet.add(messageId);
        return newSet;
    });
  }, []);

  useEffect(() => {
    const activeSession = getActiveSession();
    if (activeSession) {
      if (user?.onboardingCompleted && (activeSession.people || []).length > 0) {
        const hasSeenPopup = sessionStorage.getItem(`seen-people-popup-${activeSession.id}`);
        if (!hasSeenPopup) {
          setIsDiscoveryDialogOpen(true);
          sessionStorage.setItem(`seen-people-popup-${activeSession.id}`, 'true');
        }
      }
    }
  }, [activeSessionId, user?.onboardingCompleted, getActiveSession]);


  useEffect(() => {
    if (activeSessionId) {
      const activeSession = getActiveSession();
      if(activeSession) {
        const allMessageIds = activeSession.messages.map(m => m.id);
        setAnimatedMessages(new Set(allMessageIds));
      }
    } else {
        setAnimatedMessages(new Set());
    }
  }, [activeSessionId, getActiveSession]);

  const getMeetingByChatSessionId = useCallback(
    (chatSessionId: string) => {
      const matching = meetings.filter(
        (meeting) => meeting.chatSessionId === chatSessionId
      );
      if (matching.length === 0) return undefined;
      const timeValue = (value: any) =>
        value?.toMillis ? value.toMillis() : value ? new Date(value).getTime() : 0;
      return [...matching].sort((a: any, b: any) => {
        const aTime = timeValue(a.lastActivityAt ?? a.createdAt);
        const bTime = timeValue(b.lastActivityAt ?? b.createdAt);
        return bTime - aTime;
      })[0];
    },
    [meetings]
  );

  useEffect(() => {
    const activeSession = getActiveSession();
    if (!activeSession || activeSession.sourceMeetingId) return;
    const mostRecent = getMeetingByChatSessionId(activeSession.id);
    if (!mostRecent) return;
    if (activeSession.sourceMeetingId === mostRecent.id) return;
    updateSession(activeSession.id, { sourceMeetingId: mostRecent.id });
  }, [activeSessionId, getActiveSession, getMeetingByChatSessionId, updateSession]);


  const getInitials = (name: string | null | undefined) => (name ? name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2) : 'U');
  const userAvatar = user?.photoURL || `https://api.dicebear.com/8.x/initials/svg?seed=${user?.displayName || user?.email}`;
  const userName = user?.displayName || 'User';
  const aiName = "TaskWise AI";
  const requestedDetailLevel = user?.taskGranularityPreference ?? 'medium';
  const getMeetingForSession = useCallback(
    (session?: { sourceMeetingId?: string | null; id?: string | null }) => {
      if (session?.sourceMeetingId) {
        const bySource = meetings.find((meeting: any) => meeting.id === session.sourceMeetingId);
        return bySource;
      }
      if (session?.id) {
        const byChatId = getMeetingByChatSessionId(session.id);
        if (byChatId) return byChatId;
      }
      if (activeSessionId) {
        return getMeetingByChatSessionId(activeSessionId);
      }
      return undefined;
    },
    [meetings, activeSessionId, getMeetingByChatSessionId]
  );

  useEffect(() => {
    if (selectedTaskIds.size > 0) {
      setShowCopyHint(true);
      const timer = setTimeout(() => setShowCopyHint(false), 4000);
      return () => clearTimeout(timer);
    } else {
      setShowCopyHint(false);
    }
  }, [selectedTaskIds, setShowCopyHint]);

  useEffect(() => {
    setSelectedTaskIds((prev) => {
      if (prev.size === 0) return prev;
      const validIds = new Set<string>();
      suggestedTasks.forEach((task: any) => {
        getTaskAndAllDescendantIds(task).forEach((id: any) => validIds.add(id));
      });
      let changed = false;
      const next = new Set<string>();
      prev.forEach((id: any) => {
        if (validIds.has(id)) {
          next.add(id);
        } else {
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [suggestedTasks]);

  const applyTaskUpdate = useCallback(
    (
      nextTasks: ExtractedTaskSchema[],
      options: { skipHistory?: boolean; skipPersist?: boolean } = {}
    ) => {
      const sanitized = nextTasks.map((task: any) => normalizeTask(task));
      setSuggestedTasks((prev) => {
        if (!options.skipHistory) {
          setUndoStack((stack) => [...stack, prev]);
          setRedoStack([]);
        }
        return sanitized;
      });
      if (!options.skipPersist && activeSessionId) {
        updateActiveSessionSuggestions(sanitized);
      }
      if (!options.skipPersist) {
        const meetingId = getActiveSession()?.sourceMeetingId;
        if (meetingId) {
          updateMeeting(meetingId, { extractedTasks: sanitized });
        }
      }
    },
    [activeSessionId, updateActiveSessionSuggestions, getActiveSession, updateMeeting]
  );

  const markTaskAddedToBoard = useCallback(
    (
      tasks: ExtractedTaskSchema[],
      taskId: string,
      boardId: string,
      boardName: string
    ): ExtractedTaskSchema[] =>
      tasks.map((task: any) => {
        if (task.id === taskId) {
          return {
            ...task,
            addedToBoardId: boardId,
            addedToBoardName: boardName,
          };
        }
        if (task.subtasks && task.subtasks.length > 0) {
          return {
            ...task,
            subtasks: markTaskAddedToBoard(task.subtasks, taskId, boardId, boardName),
          };
        }
        return task;
      }),
    []
  );

  const handleOpenBoardPicker = useCallback(
    (task: ExtractedTaskSchema) => {
      if (!workspaceId) {
        toast({
          title: "Workspace not ready",
          description: "Reconnect and try again.",
          variant: "destructive",
        });
        return;
      }
      if (!boards.length) {
        toast({
          title: "No boards available",
          description: "Create a board first, then add tasks.",
          variant: "destructive",
        });
        return;
      }
      setBoardPickerTask(task);
      setSelectedBoardId(task.addedToBoardId || boards[0]?.id || "");
      setIsBoardPickerOpen(true);
    },
    [boards, toast, workspaceId]
  );

  const handleConfirmAddToBoard = useCallback(async () => {
    if (!boardPickerTask || !workspaceId || !selectedBoardId) return;
    setIsAddingToBoard(true);
    try {
      await apiFetch(
        `/api/workspaces/${workspaceId}/boards/${selectedBoardId}/items`,
        {
          method: "POST",
          body: JSON.stringify({ taskId: boardPickerTask.id }),
        }
      );

      const boardName =
        boards.find((board: any) => board.id === selectedBoardId)?.name || "Board";
      const updatedTasks = markTaskAddedToBoard(
        suggestedTasks,
        boardPickerTask.id,
        selectedBoardId,
        boardName
      );
      applyTaskUpdate(updatedTasks, { skipHistory: true });
      setIsBoardPickerOpen(false);
      setBoardPickerTask(null);
    } catch (error) {
      console.error("Failed to add task to board:", error);
      toast({
        title: "Could not add task",
        description: error instanceof Error ? error.message : "Try again in a moment.",
        variant: "destructive",
      });
    } finally {
      setIsAddingToBoard(false);
    }
  }, [
    applyTaskUpdate,
    boardPickerTask,
    boards,
    markTaskAddedToBoard,
    selectedBoardId,
    suggestedTasks,
    toast,
    workspaceId,
  ]);

  const handleMoveTaskToBoard = useCallback(
    async (boardId: string) => {
      if (!workspaceId || !taskForDetailView) {
        throw new Error("Workspace not ready.");
      }
      await moveTaskToBoard(workspaceId, taskForDetailView.id, boardId);
      const boardName =
        boards.find((board: any) => board.id === boardId)?.name || "Board";
      const updatedTasks = markTaskAddedToBoard(
        suggestedTasks,
        taskForDetailView.id,
        boardId,
        boardName
      );
      applyTaskUpdate(updatedTasks, { skipHistory: true });
      setTaskForDetailView((prev) =>
        prev ? { ...prev, addedToBoardId: boardId, addedToBoardName: boardName } : prev
      );
    },
    [
      applyTaskUpdate,
      boards,
      markTaskAddedToBoard,
      suggestedTasks,
      taskForDetailView,
      workspaceId,
    ]
  );

  const resetTaskHistory = useCallback((tasks: ExtractedTaskSchema[]) => {
    setUndoStack([]);
    setRedoStack([]);
    setSuggestedTasks(tasks);
  }, []);

  useEffect(() => {
    const currentActiveSession = getActiveSession();
    const currentSessionId = currentActiveSession?.id ?? null;
    if (currentActiveSession) {
      resetTaskHistory(currentActiveSession.suggestedTasks || []);
      setEditableTitle(currentActiveSession.title);
    } else {
      resetTaskHistory([]);
      setEditableTitle("New Chat");
    }
    if (lastSelectionSessionIdRef.current !== currentSessionId) {
      lastSelectionSessionIdRef.current = currentSessionId;
      setSelectedTaskIds(new Set());
      setIsEditingTitle(false);
    }
    const shouldShow = (currentActiveSession?.suggestedTasks?.length ?? 0) > 0;
    setActiveSidePanel((prev) => {
      if (isTabletOrMobile) return null;
      if (shouldShow) return prev ?? 'tasks';
      return prev === 'people' ? 'people' : null;
    });
  }, [activeSessionId, getActiveSession, isTabletOrMobile, resetTaskHistory]);

  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) return;
    const previous = undoStack[undoStack.length - 1];
    setUndoStack((stack) => stack.slice(0, -1));
    setRedoStack((stack) => [suggestedTasks, ...stack]);
    setSuggestedTasks(previous);
    if (activeSessionId) {
      updateActiveSessionSuggestions(previous);
    }
  }, [undoStack, suggestedTasks, activeSessionId, updateActiveSessionSuggestions]);

  const handleRedo = useCallback(() => {
    if (redoStack.length === 0) return;
    const next = redoStack[0];
    setRedoStack((stack) => stack.slice(1));
    setUndoStack((stack) => [...stack, suggestedTasks]);
    setSuggestedTasks(next);
    if (activeSessionId) {
      updateActiveSessionSuggestions(next);
    }
  }, [redoStack, suggestedTasks, activeSessionId, updateActiveSessionSuggestions]);

  const getAncestors = (taskId: string, allTasks: ExtractedTaskSchema[]): string[] => {
    const path: string[] = [];
    const findPath = (currentTask: ExtractedTaskSchema, targetId: string, currentPath: string[]): boolean => {
      currentPath.push(currentTask.id);
      if (currentTask.id === targetId) return true;
      if (currentTask.subtasks) {
        for (const sub of currentTask.subtasks) {
          if (findPath(sub, targetId, currentPath)) return true;
        }
      }
      currentPath.pop();
      return false;
    };
    for (const task of allTasks) {
      if (findPath(task, taskId, path)) break;
      else path.length = 0;
    }
    if (path.length > 0) path.pop();
    return path;
  };
    
  const getCheckboxState = (task: ExtractedTaskSchema, currentSelectedIds: Set<string>, allTasks: ExtractedTaskSchema[]): 'checked' | 'unchecked' | 'indeterminate' => {
    const allDescendantIds = Array.from(getTaskAndAllDescendantIds(task));
    
    const selectedDescendants = allDescendantIds.filter(id => currentSelectedIds.has(id));

    if (selectedDescendants.length === 0) return 'unchecked';
    if (selectedDescendants.length === allDescendantIds.length) return 'checked';
    return 'indeterminate';
  };


  const handleToggleSelection = useCallback((taskId: string, isSelectedNow: boolean) => {
    setSelectedTaskIds(prevSelectedIds => {
      const newSelectedIds = new Set(prevSelectedIds);
      const taskToToggle = findTaskById(suggestedTasks, taskId);
      if (!taskToToggle) return newSelectedIds;
  
      const idsToUpdate = getTaskAndAllDescendantIds(taskToToggle);
  
      idsToUpdate.forEach(id => {
        if (isSelectedNow) {
            newSelectedIds.add(id);
        } else {
            newSelectedIds.delete(id);
        }
      });
  
      const ancestors = getAncestors(taskId, suggestedTasks);
      ancestors.reverse().forEach(ancestorId => {
        const ancestorTask = findTaskById(suggestedTasks, ancestorId);
        if (ancestorTask?.subtasks) {
          const allChildrenSelected = ancestorTask.subtasks.every(
            sub => getCheckboxState(sub, newSelectedIds, suggestedTasks) === 'checked'
          );
          if (allChildrenSelected) {
            newSelectedIds.add(ancestorId);
          } else {
            newSelectedIds.delete(ancestorId);
          }
        }
      });
  
      return newSelectedIds;
    });
  }, [suggestedTasks]);

  const countUnaddedTasksRecursive = (tasks: ExtractedTaskSchema[]): number => {
      let count = 0;
      tasks.forEach(task => {
          if (!task.addedToBoardId) count++;
          if (task.subtasks) count += countUnaddedTasksRecursive(task.subtasks);
      });
      return count;
  };

  const getSelectedTasks = (): ExtractedTaskSchema[] => {
    const buildHierarchy = (tasks: ExtractedTaskSchema[]): ExtractedTaskSchema[] => {
      return tasks.map(task => {
        const isSelected = selectedTaskIds.has(task.id);
        const selectedSubtasks = task.subtasks ? buildHierarchy(task.subtasks) : [];
        if (isSelected || selectedSubtasks.length > 0) {
          return { ...task, subtasks: selectedSubtasks };
        }
        return null;
      }).filter(Boolean) as ExtractedTaskSchema[];
    };
    return buildHierarchy(suggestedTasks);
  };

  const selectedTasks = useMemo(() => getSelectedTasks(), [selectedTaskIds, suggestedTasks]);
  const hasSelection = selectedTaskIds.size > 0;
  
  const handleCopySelected = async () => {
    if (selectedTaskIds.size === 0) {
        toast({ title: "No tasks selected", description: "Please select tasks to copy.", variant: "destructive" });
        return;
    }
    const tasksToCopy = getSelectedTasks();
    const textToCopy = formatTasksToText(tasksToCopy);
    const { success, method } = await copyTextToClipboard(textToCopy);
    if (success) {
        toast({ title: "Copied to clipboard!", description: `${tasksToCopy.length} task branches copied.` });
    } else {
        toast({ title: "Copy Failed", description: "Could not copy tasks to clipboard.", variant: "destructive" });
    }
  };

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'c') {
                if (selectedTaskIds.size > 0) {
                    event.preventDefault();
                    handleCopySelected();
                }
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [selectedTaskIds, suggestedTasks]); // Re-bind if suggestedTasks changes


  const handleShareSelected = async () => {
        if (selectedTaskIds.size === 0) {
            toast({ title: "No tasks selected", description: "Please select tasks to share.", variant: "destructive" });
            return;
        }
        const tasksToShare = getSelectedTasks();
        const { success, method } = await shareTasksNative(tasksToShare, currentSessionTitle);
        
        if (success) {
            if(method === 'native') {
              toast({ title: "Shared!", description: "Your tasks have been sent." });
            } else {
              toast({ title: "Copied to Clipboard", description: "Sharing not available, tasks copied instead." });
            }
        } else if (method === 'native') {
            toast({ title: "Share Cancelled", description: "The share action was cancelled.", variant: "default" });
        } else {
            toast({ title: "Share Failed", description: "Could not share or copy tasks.", variant: "destructive" });
        }
    };

  const handleExportSelected = (format: 'csv' | 'md' | 'pdf') => {
    if (selectedTaskIds.size === 0) {
      toast({ title: "No tasks selected", variant: "destructive" });
      return;
    }
    const filename = `${currentSessionTitle.replace(/\s+/g, '_')}_export`;
    if (format === 'csv') exportTasksToCSV(selectedTasks, `${filename}.csv`);
    if (format === 'md') exportTasksToMarkdown(selectedTasks, `${filename}.md`);
    if (format === 'pdf') exportTasksToPDF(selectedTasks, currentSessionTitle);
    toast({ title: `Exported to ${format.toUpperCase()}` });
  };

  const handleGenerateBriefs = async () => {
    if (isGeneratingBriefs) return;
    if (selectedTaskIds.size === 0) {
      toast({ title: "No tasks selected", description: "Please select tasks to generate briefs for.", variant: "destructive" });
      return;
    }
    setIsGeneratingBriefs(true);
    toast({ title: "Generating Briefs...", description: `AI is preparing briefs for ${selectedTaskIds.size} task(s).` });

    const results: Array<{ taskId: string; brief: string | null }> = [];
    let limitReached = false;
    for (const taskId of selectedTaskIds) {
      const taskToUpdate = findTaskById(suggestedTasks, taskId);
      if (!taskToUpdate) continue;
      try {
        const briefResult = await generateTaskBrief({
          taskTitle: taskToUpdate.title,
          taskDescription: taskToUpdate.description || undefined,
        });
        results.push({ taskId, brief: briefResult.researchBrief });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not generate brief.";
        if (message.toLowerCase().includes("monthly ai brief limit reached")) {
          limitReached = true;
          toast({
            title: "Brief limit reached",
            description: "You have used all 10 AI Brief generations for this month.",
            variant: "destructive",
          });
          break;
        }
        console.error(`Error generating brief for task ${taskToUpdate.title}:`, error);
      }
    }

    const applyBriefToTask = (nodes: ExtractedTaskSchema[], idToUpdate: string, brief: string): ExtractedTaskSchema[] => {
      return nodes.map((node: any) => {
        if (node.id === idToUpdate) {
          return normalizeTask({ ...node, researchBrief: brief });
        }
        if (node.subtasks) {
          return { ...node, subtasks: applyBriefToTask(node.subtasks, idToUpdate, brief) };
        }
        return node;
      });
    };

    let updatedTasks = [...suggestedTasks];
    let briefsApplied = 0;
    results.forEach((result: any) => {
      if (result?.brief) {
        updatedTasks = applyBriefToTask(updatedTasks, result.taskId, result.brief);
        briefsApplied += 1;
      }
    });

    if (briefsApplied > 0) {
      applyTaskUpdate(updatedTasks);
      if (taskForDetailView) {
        const refreshedTask = findTaskById(updatedTasks, taskForDetailView.id);
        if (refreshedTask) {
          setTaskForDetailView(refreshedTask);
        }
      }
      toast({ title: "Briefs Generated", description: `Research briefs generated for ${briefsApplied} task(s).` });
    } else if (!limitReached) {
      toast({ title: "No Briefs Generated", description: "Could not generate briefs for the selected tasks.", variant: "destructive" });
    }
    setIsGeneratingBriefs(false);
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


  const unaddedTasksInPanel = countUnaddedTasksRecursive(suggestedTasks);

  const allTaskIds = useMemo(() => {
    const ids = new Set<string>();
    suggestedTasks.forEach((task: any) => {
      getTaskAndAllDescendantIds(task).forEach((id: any) => ids.add(id));
    });
    return ids;
  }, [suggestedTasks]);
  const isAllTasksSelected =
    allTaskIds.size > 0 && Array.from(allTaskIds).every((id) => selectedTaskIds.has(id));

  const groupedTasks = useMemo(() => {
    const byType = new Map<TaskTypeCategory, ExtractedTaskSchema[]>();
    suggestedTasks.forEach((task: any) => {
      const typeKey = normalizeTaskType(task.taskType);
      const group = byType.get(typeKey) || [];
      group.push(task);
      byType.set(typeKey, group);
    });
    return TASK_TYPE_VALUES
      .map((type: TaskTypeCategory) => ({
        type,
        label: TASK_TYPE_LABELS[type],
        tasks: byType.get(type) || [],
      }))
      .filter((group) => group.tasks.length > 0);
  }, [suggestedTasks]);

  const toggleSelectionByIds = useCallback((ids: Set<string>) => {
    const nextSelected = new Set(selectedTaskIds);
    const allSelected = Array.from(ids).every((id) => nextSelected.has(id));
    if (allSelected) {
      ids.forEach((id: any) => nextSelected.delete(id));
    } else {
      ids.forEach((id: any) => nextSelected.add(id));
    }
    setSelectedTaskIds(nextSelected);
  }, [selectedTaskIds]);

  const handleDiscoveryDialogClose = async (peopleToCreate: any[]) => {
    setIsDiscoveryDialogOpen(false);
    if (!user || !activeSessionId) return;

    if (peopleToCreate.length > 0) {
      toast({
        title: "Adding New People...",
        description: `Saving ${peopleToCreate.length} new people to your directory.`,
      });

      const savedPeople = await Promise.all(
        peopleToCreate.map(async (person) => {
          const personId = await addPerson(user.uid, person, activeSessionId);
          return { ...person, id: personId };
        })
      );

      const unsubscribe = onPeopleSnapshot(user.uid, (loadedPeople) => {
        setPeople(loadedPeople);
        assignTasksToPeople(savedPeople, loadedPeople);
        unsubscribe(); 
      });

    }
  };

  const assignTasksToPeople = (
    newlySavedPeople: Person[],
    allPeople: Person[]
  ) => {
    const peopleMap = new Map<string, Person>();
    allPeople.forEach((p: any) => peopleMap.set(p.name.toLowerCase(), p));
    newlySavedPeople.forEach((p: any) => peopleMap.set(p.name.toLowerCase(), p));

    const assignRecursively = (tasks: ExtractedTaskSchema[]): ExtractedTaskSchema[] => {
      return tasks.map((task: any) => {
        let newAssignee = task.assignee;
        if (task.assigneeName) {
          const person = peopleMap.get(task.assigneeName.toLowerCase());
          if (person) {
            newAssignee = {
              uid: person.id,
              name: person.name,
              email: person.email,
              photoURL: person.avatarUrl || null,
            };
          }
        }
        return {
          ...task,
          assignee: newAssignee,
          subtasks: task.subtasks ? assignRecursively(task.subtasks) : null,
        };
      });
    };

    const tasksWithAssignees = assignRecursively(suggestedTasks);
    applyTaskUpdate(tasksWithAssignees);
  };

  const handleSendMessage = async () => {
    if (inputValue.trim() === '' && selectedTaskIds.size === 0) return;

    const currentInput = inputValue;
    const promptText =
      currentInput.trim().length === 0 && selectedTaskIds.size > 0
        ? "Work with the selected tasks only."
        : currentInput;
    const shouldAttach = currentInput.trim().length > 500;
    const userMessage: ChatMessageType = {
        id: `msg-${Date.now()}`,
        text: shouldAttach
          ? "Pasted text"
          : promptText.trim().length === 0
            ? "Selected tasks"
            : currentInput,
        attachedContent: shouldAttach ? currentInput : null,
        sender: 'user',
        timestamp: Date.now(),
        avatar: userAvatar,
        name: userName
    };

    setInputValue('');
    
    if (!activeSessionId) {
        setIsSendingMessage(true);
        try {
            if (isTranscriptLike(promptText)) {
                const result = await processPastedContent({
                  pastedText: promptText,
                  requestedDetailLevel: "medium",
                });
                if (result.isMeeting && result.meeting) {
                    const newMeeting = await createNewMeeting(result.meeting);
                    if (newMeeting) {
                        const meetingTasks = newMeeting.extractedTasks || result.tasks;
                        const newChat = await createNewSession({
                          title: `Chat about "${newMeeting.title}"`,
                          sourceMeetingId: newMeeting.id,
                          initialTasks: meetingTasks as any,
                          initialPeople: newMeeting.attendees,
                          allTaskLevels: result.allTaskLevels as any,
                        });
                        const newPlan = await createNewPlanningSession(
                          newMeeting.summary,
                          meetingTasks as any,
                          `Plan from "${newMeeting.title}"`,
                          result.allTaskLevels as any,
                          newMeeting.id
                        );
                        if (newChat && newPlan) {
                            await updateMeeting(newMeeting.id, { chatSessionId: newChat.id, planningSessionId: newPlan.id });
                        }
                        if (newChat?.suggestedTasks && newChat.suggestedTasks.length > 0) {
                            applyTaskUpdate(newChat.suggestedTasks, { skipHistory: true, skipPersist: true });
                        }
                        if (newChat?.title) {
                            setEditableTitle(newChat.title);
                        }
                    }
                } else {
                    const newSession = await createNewSession({ initialMessage: userMessage, title: "New Chat", initialTasks: result.tasks, initialPeople: result.people, allTaskLevels: result.allTaskLevels });
                    if (newSession?.suggestedTasks && newSession.suggestedTasks.length > 0) {
                        applyTaskUpdate(newSession.suggestedTasks, { skipHistory: true, skipPersist: true });
                    }
                    if (newSession?.title) {
                        setEditableTitle(newSession.title);
                    }
                    setPendingPrompt(promptText);
                }
            } else {
                const newSession = await createNewSession({ initialMessage: userMessage, title: "New Chat" });
                if (newSession?.suggestedTasks && newSession.suggestedTasks.length > 0) {
                    applyTaskUpdate(newSession.suggestedTasks, { skipHistory: true, skipPersist: true });
                }
                if (newSession?.title) {
                    setEditableTitle(newSession.title);
                }
                setPendingPrompt(promptText);
            }
        } catch (error) {
            console.error("Error processing initial message:", error);
            toast({ title: "AI Error", description: "Could not process initial message.", variant: "destructive" });
        } finally {
            setIsSendingMessage(false);
        }
    } else {
        await addMessageToActiveSession(userMessage);
        await processAIResponse(promptText, false);
      }
    };
  
  
    const processAIResponse = async (promptText: string, isFirstMessage: boolean = false) => {
        if (!user?.uid) {
          toast({ title: "Authentication Error", description: "You must be logged in.", variant: "destructive" });
          return;
        }
      setIsSendingMessage(true);
      
      const tempTypingIndicator: ChatMessageType = {
        id: 'ai-typing-indicator',
        text: '',
        sender: 'ai',
        timestamp: Date.now(),
        name: aiName,
      };
      
      if(activeSessionId) {
        await addMessageToActiveSession(tempTypingIndicator);
      }

      try {
        const currentSession = getActiveSession();
        const currentTasks = currentSession?.suggestedTasks || [];
        const sanitizedCurrentTasks = sanitizeTasksForAI(currentTasks);
        const selectedAITasks = sanitizeTasksForAI(getSelectedTasks());
        const sourceMeeting = getMeetingForSession(currentSession);
        const sourceTranscript = getMeetingTranscript(sourceMeeting);
        const shouldApplyTaskUpdate =
          !sourceMeeting || currentTasks.length === 0 || selectedAITasks.length > 0;

        if (activeSessionId && currentSession && sourceMeeting) {
          if (!currentSession.sourceMeetingId || currentSession.sourceMeetingId !== sourceMeeting.id) {
            await updateSession(activeSessionId, {
              sourceMeetingId: sourceMeeting.id,
              people: currentSession.people?.length ? currentSession.people : sourceMeeting.attendees || [],
            });
          }
        }

            const orchestratorInput: OrchestratorInput = {
              message: promptText,
              existingTasks: sanitizedCurrentTasks.length > 0 ? sanitizedCurrentTasks : undefined,
              selectedTasks: selectedAITasks.length > 0 ? selectedAITasks : undefined,
              sourceMeetingTranscript: sourceTranscript,
              isFirstMessage,
              requestedDetailLevel,
            };

          const result: OrchestratorOutput = await extractTasksFromChat(orchestratorInput);
        
        if (activeSessionId) {
            const messagePayload: Omit<ChatMessageType, 'sender' | 'timestamp' | 'name'> = { id: `ai-msg-${Date.now()}`, text: '' };

            if (result.qaAnswer) {
                messagePayload.text = result.qaAnswer.answerText;
                messagePayload.sources = result.qaAnswer.sources;
                await addMessageToActiveSession({
                  ...messagePayload,
                  sender: 'ai',
                  timestamp: Date.now(),
                  name: aiName
                });
            } else {
                if (result.tasks && shouldApplyTaskUpdate) {
                    const newTasks = result.tasks.map((t: any) =>
                      normalizeTask(t as ExtractedTaskSchema)
                    );
                    applyTaskUpdate(newTasks);
                }
                if (result.sessionTitle) {
                    updateSessionTitle(activeSessionId, result.sessionTitle);
                }
                if (result.people && result.people.length > 0) {
                    const filteredPeople = result.people.filter((person: { name: string; email?: string | null }) => !isPersonBlocked(person));
                    const existingPeopleNames = new Set((currentSession?.people || []).map((person: { name: string }) => person.name));
                    const newPeopleDiscovered = filteredPeople.filter((person: { name: string }) => !existingPeopleNames.has(person.name));
                    if (newPeopleDiscovered.length > 0) {
                        await updateSession(activeSessionId, { people: filteredPeople });
                        const hasSeenPopup = sessionStorage.getItem(`seen-people-popup-${activeSessionId}`);
                        if (!hasSeenPopup) {
                            setIsDiscoveryDialogOpen(true);
                            sessionStorage.setItem(`seen-people-popup-${activeSessionId}`, 'true');
                        }
                    }
                }
                 if(result.chatResponseText) {
                    messagePayload.text = result.chatResponseText;
                    await addMessageToActiveSession({
                      ...messagePayload,
                      sender: 'ai',
                      timestamp: Date.now(),
                      name: aiName
                    });
                }
            }
        }
        
        setSelectedTaskIds(new Set());
        if (result.tasks && result.tasks.length > 0 && activeSidePanel !== 'tasks') {
          setActiveSidePanel('tasks');
        }
      } catch (error) {
        console.error("Error in AI processing orchestrator:", error);
        const aiErrorResponse = "Sorry, I encountered an error processing your request. Please try again.";
        if(activeSessionId) {
            await addMessageToActiveSession({
                id: `ai-msg-${Date.now()}`,
                text: aiErrorResponse,
                sender: 'ai',
                timestamp: Date.now(),
                name: aiName
            });
        }
      }

    setIsSendingMessage(false);
  };
  
  useEffect(() => {
    if (!pendingPrompt || !activeSessionId) return;
    void processAIResponse(pendingPrompt, true);
    setPendingPrompt(null);
  }, [pendingPrompt, activeSessionId]);

  const handleSuggestedQuestion = useCallback(
    async (question: string) => {
      if (!activeSessionId) {
        setInputValue(question);
        return;
      }
      const userMessage: ChatMessageType = {
        id: `msg-${Date.now()}`,
        text: question,
        sender: 'user',
        timestamp: Date.now(),
        avatar: userAvatar,
        name: userName,
      };
      await addMessageToActiveSession(userMessage);
      await processAIResponse(question, false);
    },
    [activeSessionId, addMessageToActiveSession, processAIResponse, userAvatar, userName]
  );

  const handleConfirmDeleteFromChat = useCallback(
    async (taskTitle: string) => {
      const confirmation = `confirm delete ${taskTitle}`;
      if (!activeSessionId) {
        setInputValue(confirmation);
        return;
      }
      const userMessage: ChatMessageType = {
        id: `msg-${Date.now()}`,
        text: confirmation,
        sender: 'user',
        timestamp: Date.now(),
        avatar: userAvatar,
        name: userName,
      };
      await addMessageToActiveSession(userMessage);
      await processAIResponse(confirmation, false);
    },
    [activeSessionId, addMessageToActiveSession, processAIResponse, userAvatar, userName]
  );

  const handleCancelDeleteFromChat = useCallback(async () => {
    if (!activeSessionId) return;
    await addMessageToActiveSession({
      id: `msg-${Date.now()}`,
      text: "Cancel deletion.",
      sender: 'user',
      timestamp: Date.now(),
      avatar: userAvatar,
      name: userName,
    });
    await addMessageToActiveSession({
      id: `ai-msg-${Date.now()}`,
      text: "Okay, I won't delete anything.",
      sender: 'ai',
      timestamp: Date.now(),
      name: aiName,
    });
  }, [activeSessionId, addMessageToActiveSession, userAvatar, userName, aiName]);

  
  const dismissSuggestion = (taskId: string) => {
    removeSuggestionFromActiveSession(taskId);
    applyTaskUpdate(suggestedTasks.filter(task => task.id !== taskId), { skipPersist: true });
    setSelectedTaskIds(prev => {
      const newSet = new Set(prev);
      newSet.delete(taskId);
      return newSet;
    });
  };


  const handleBreakDownTask = async (taskToBreakDown: ExtractedTaskSchema) => {
    setIsProcessingAiAction(true);
    const taskBeingProcessedId = taskToBreakDown.id;
    toast({ title: "AI Breaking Down Task...", description: `Generating sub-tasks for "${taskToBreakDown.title}".` });
    try {
      const input: OrchestratorInput = {
        message: `Break this down`,
        contextTaskTitle: taskToBreakDown.title,
        existingTasks: suggestedTasks as any, // Provide full context
        requestedDetailLevel,
      };
      const activeSession = getActiveSession();
        const meeting = getMeetingForSession(activeSession);
        const transcript = getMeetingTranscript(meeting);
        const result = await extractTasksFromChat({
          ...input,
          sourceMeetingTranscript: transcript,
        });
      
      applyTaskUpdate(
        result.tasks.map((t: any) => normalizeTask(t as ExtractedTaskSchema))
      );
      toast({ title: "Sub-tasks Added", description: `Sub-tasks added under "${taskToBreakDown.title}".` });

    } catch (error) {
      console.error("Error breaking down task:", error);
      toast({ title: "AI Error", description: "Could not break down task.", variant: "destructive" });
    } finally {
      setIsProcessingAiAction(false);
    }
  };


  const handleSimplifyTask = async (taskToSimplify: ExtractedTaskSchema) => {
    setIsProcessingAiAction(true);
    const taskBeingProcessedId = taskToSimplify.id;
    toast({ title: "AI Simplifying Task...", description: `Processing "${taskToSimplify.title}".` });

    try {
      const activeSession = getActiveSession();
        const meeting = getMeetingForSession(activeSession);
        const transcript = getMeetingTranscript(meeting);
        const result = await extractTasksFromChat({
          message: `Simplify this task and its subtasks: ${taskToSimplify.title}`,
          selectedTasks: [taskToSimplify] as any,
          existingTasks: suggestedTasks as any,
          requestedDetailLevel,
          sourceMeetingTranscript: transcript,
        });

        const newTasks = result.tasks.map((t: any) =>
          normalizeTask(t as ExtractedTaskSchema)
        );
        applyTaskUpdate(newTasks);
        
    } catch (error) {
      console.error("Error simplifying task:", error);
      toast({ title: "AI Error", description: "Could not simplify task.", variant: "destructive" });
    } finally {
      setIsProcessingAiAction(false);
      setIsSimplifyConfirmOpen(false);
    }
  };

  const handleViewDetails = (task: ExtractedTaskSchema) => {
    setTaskForDetailView(task);
    setIsTaskDetailDialogVisible(true);
    setRadialMenuState({open: false, x: 0, y: 0});
  };
  
  const handleSaveTaskDetails = (updatedTask: ExtractedTaskSchema, options?: { close?: boolean }) => {
    const newPanelSuggestions = suggestedTasks.map(panelTask => {
      const findAndUpdate = (node: ExtractedTaskSchema): ExtractedTaskSchema => {
        if (node.id === updatedTask.id) {
          return { ...node, ...updatedTask };
        }
        if (node.subtasks) {
          return { ...node, subtasks: node.subtasks.map(findAndUpdate) };
        }
        return node;
      };
      return findAndUpdate(panelTask);
    });

    applyTaskUpdate(newPanelSuggestions);
    if (options?.close !== false) {
      setIsTaskDetailDialogVisible(false);
    }
  };

  const getBriefContext = useCallback(
    (task: ExtractedTaskSchema) => {
      const meeting = getMeetingForSession(getActiveSession());
      return buildBriefContext(task, meetings, people, {
        primaryMeetingId: meeting?.id,
      });
    },
    [getActiveSession, getMeetingForSession, meetings, people]
  );

  const handleDeleteSelected = () => {
    if (selectedTaskIds.size === 0) return;
    setTaskToDelete('multiple');
    setRadialMenuState({ open: false, x: 0, y: 0 });
  };

  if (isLoadingHistory && !user) {
    return (
      <div className="flex flex-col lg:flex-row h-full gap-6">
        <div className="flex-1 flex flex-col overflow-hidden">
           <div className="p-4 flex flex-row justify-between items-center">
             <Skeleton className="h-6 w-48" />
             <Skeleton className="h-8 w-24" />
           </div>
           <div className="flex-1 p-4 space-y-4">
             <Skeleton className="h-10 w-3/4 self-end rounded-lg" />
             <Skeleton className="h-12 w-2/3 self-start rounded-lg" />
             <Skeleton className="h-10 w-3/4 self-end rounded-lg" />
           </div>
        </div>
        <div className="lg:w-1/3 flex flex-col">
            <div className="p-4"><Skeleton className="h-6 w-32" /></div>
            <div className="flex-1 p-4 space-y-3">
                <Skeleton className="h-16 w-full rounded-lg" />
                <Skeleton className="h-16 w-full rounded-lg" />
            </div>
        </div>
      </div>
    );
  }

  const handleNewChat = async () => {
    await createNewSession();
  };

  const handleEditTitleClick = () => {
    if (activeSessionId) {
      setEditableTitle(getActiveSession()?.title || "New Chat");
      setIsEditingTitle(true);
    }
  };

  const handleSaveSessionTitle = async () => {
    if (!activeSessionId || !editableTitle.trim()) {
      toast({ title: "Invalid Title", variant: "destructive" });
      setEditableTitle(getActiveSession()?.title || "New Chat");
      return;
    }
    if (editableTitle.trim() === getActiveSession()?.title) {
      setIsEditingTitle(false);
      return;
    }
    await updateSessionTitle(activeSessionId, editableTitle.trim());
    setIsEditingTitle(false);
  };
  
  const handleCancelEditTitle = () => {
    setEditableTitle(getActiveSession()?.title || "New Chat");
    setIsEditingTitle(false);
  };
  
  const handleMoveToFolder = (folderId: string | null) => {
    if (!activeSessionId) return;
    updateSession(activeSessionId, { folderId });
    toast({ title: 'Chat Moved', description: `Chat has been moved successfully.` });
  };

  const meetingOptions = useMemo(() => {
    const getTime = (value: any) =>
      value?.toMillis ? value.toMillis() : value ? new Date(value).getTime() : 0;
    return [...meetings].sort((a: any, b: any) => getTime(b.lastActivityAt) - getTime(a.lastActivityAt));
  }, [meetings]);

  const clearDuplicateChatLinks = useCallback(
    async (chatSessionId: string, meetingId: string) => {
      const duplicates = meetings.filter(
        (item) => item.chatSessionId === chatSessionId && item.id !== meetingId
      );
      if (duplicates.length === 0) return;
      await Promise.all(
        duplicates.map((duplicate: any) =>
          updateMeeting(duplicate.id, { chatSessionId: null })
        )
      );
    },
    [meetings, updateMeeting]
  );

  const handleOpenMeetingChat = async (meetingId: string) => {
    const meeting = meetings.find((m: any) => m.id === meetingId);
    if (!meeting) return;

    const existingSession =
      sessions.find((session: any) => session.sourceMeetingId === meetingId) ||
      (meeting.chatSessionId ? sessions.find((session: any) => session.id === meeting.chatSessionId) : undefined);

    if (existingSession) {
      await clearDuplicateChatLinks(existingSession.id, meeting.id);
      if (!existingSession.sourceMeetingId) {
        await updateSession(existingSession.id, { sourceMeetingId: meeting.id });
      }
      if (meeting.chatSessionId !== existingSession.id) {
        await updateMeeting(meeting.id, { chatSessionId: existingSession.id });
      }
      setActiveSessionId(existingSession.id);
      return;
    }

    const newSession = await createNewSession({
      title: `Chat about "${meeting.title}"`,
      sourceMeetingId: meeting.id,
      initialTasks: (meeting.extractedTasks || []) as any,
      initialPeople: meeting.attendees || [],
      allTaskLevels: meeting.allTaskLevels as any,
    });

    if (newSession) {
      await clearDuplicateChatLinks(newSession.id, meeting.id);
      await updateMeeting(meeting.id, { chatSessionId: newSession.id });
    }
  };

  const handleShareTasksForPerson = async (
    person: { name: string },
    existingPerson?: Person | null
  ) => {
      const tasksForPerson = filterTasksByAssignee(suggestedTasks, person.name);
      const taskCount = countTasksRecursive(tasksForPerson);
      if (taskCount === 0) {
        toast({ title: "No assigned tasks", description: `${person.name} has no assigned tasks yet.` });
        return;
      }
      if (isSlackConnected && existingPerson?.slackId) {
        try {
          const response = await fetch("/api/slack/share", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              tasks: tasksForPerson,
              userId: existingPerson.slackId,
              sourceTitle: `Tasks for ${person.name}`,
              includeAiContent: true,
            }),
          });
          const data = await response.json();
          if (!response.ok) {
            throw new Error(data.error || "Slack share failed.");
          }
          toast({
            title: "Shared to Slack",
            description: `Tasks sent to ${person.name} via Slack.`,
          });
          return;
        } catch (error: any) {
          toast({
            title: "Slack share failed",
            description: error.message || "Could not share tasks via Slack.",
            variant: "destructive",
          });
        }
      }
      const { success, method } = await shareTasksNative(tasksForPerson, `Tasks for ${person.name}`);
      if (success) {
        const viaClipboard = method === 'clipboard';
        toast({
        title: viaClipboard ? "Copied tasks" : "Shared tasks",
        description: viaClipboard
          ? `Assigned tasks for ${person.name} copied to clipboard.`
          : `Assigned tasks for ${person.name} shared successfully.`,
      });
    } else if (method === 'native') {
      toast({ title: "Share cancelled", description: "The share action was cancelled." });
    } else {
      toast({ title: "Share failed", description: "Could not share tasks for this person.", variant: "destructive" });
    }
  };

  const handleOpenAssignDialog = () => {
    if (selectedTaskIds.size === 0) {
      toast({ title: "No tasks selected", description: "Please select tasks to assign.", variant: "destructive" });
      return;
    }
    setIsAssignPersonDialogOpen(true);
    setRadialMenuState({ open: false, x: 0, y: 0 });
  };
  
  const handleOpenDueDateDialog = () => {
    if (selectedTaskIds.size === 0) {
      toast({ title: "No tasks selected", description: "Please select tasks to set a due date for.", variant: "destructive" });
      return;
    }
    setIsSetDueDateDialogOpen(true);
    setRadialMenuState({ open: false, x: 0, y: 0 });
  };

  const handleConfirmAssignPerson = (person: Person) => {
    const updateAssigneeRecursively = (tasks: ExtractedTaskSchema[]): ExtractedTaskSchema[] => {
      return tasks.map(task => {
        let updatedTask = { ...task };
        if (selectedTaskIds.has(task.id)) {
            updatedTask.assignee = {
                uid: person.id,
                name: person.name,
                email: person.email ?? null, // Use nullish coalescing
                photoURL: person.avatarUrl ?? null,
            };
            updatedTask.assigneeName = person.name;
        }
        if (updatedTask.subtasks) {
          updatedTask.subtasks = updateAssigneeRecursively(updatedTask.subtasks);
        }
        return normalizeTask(updatedTask);
      });
    };
  
    const newExtractedTasks = updateAssigneeRecursively(suggestedTasks);
    applyTaskUpdate(newExtractedTasks);
    
    toast({ title: "Tasks Assigned", description: `${selectedTaskIds.size} task branch(es) assigned to ${person.name}.` });
    setIsAssignPersonDialogOpen(false);
    setSelectedTaskIds(new Set());
  };

  const handleCreatePerson = async (name: string): Promise<string | undefined> => {
    if (!user) return;
    try {
      const newPersonId = await addPerson(user.uid, { name }, activeSessionId || 'chat-manual-add');
      toast({ title: "Person Added", description: `${name} has been added to your people directory.` });
      return newPersonId;
    } catch (e) {
      toast({ title: "Error", description: "Could not create new person.", variant: "destructive" });
    }
    return undefined;
  };

  const handleConfirmSetDueDate = (date: Date | undefined) => {
    const newDueDateISO = date ? date.toISOString() : null;

    const updateDueDatesRecursively = (nodes: ExtractedTaskSchema[]): ExtractedTaskSchema[] => {
      return nodes.map(node => {
        let updatedNode = { ...node };
        if (selectedTaskIds.has(node.id)) {
            updatedNode.dueAt = newDueDateISO;
        }
        if (node.subtasks) {
          updatedNode.subtasks = updateDueDatesRecursively(node.subtasks);
        }
        return updatedNode;
      });
    };
    
    const newExtractedTasks = updateDueDatesRecursively(suggestedTasks);

    applyTaskUpdate(newExtractedTasks);
    toast({ title: "Due Dates Updated", description: `Due dates set for ${selectedTaskIds.size} task(s).`});
    setIsSetDueDateDialogOpen(false);
    setRadialMenuState({ open: false, x: 0, y: 0 });
  };
  


  type FolderNode = Folder & { children: FolderNode[] };

  const renderFolderMenuItems = (
      folderList: FolderNode[],
      currentLevel = 0,
      maxDepth = 2
    ) => {
      return folderList.map(folder => (
          <DropdownMenuSub key={folder.id}>
              <DropdownMenuSubTrigger disabled={currentLevel >= maxDepth}>
                  <FolderIcon className="mr-2 h-4 w-4" /><span>{folder.name}</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                  <DropdownMenuSubContent>
                      <DropdownMenuItem onClick={() => handleMoveToFolder(folder.id)}>
                          <FolderIcon className="mr-2 h-4 w-4" /><span>Move to "{folder.name}"</span>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      {folder.children && folder.children.length > 0 && renderFolderMenuItems(folder.children, currentLevel + 1, maxDepth)}
                      {folder.children.length === 0 && <DropdownMenuItem disabled>No subfolders</DropdownMenuItem>}
                  </DropdownMenuSubContent>
              </DropdownMenuPortal>
          </DropdownMenuSub>
      ));
  };
  
  const folderStructure = useMemo(() => {
    const folderMap: Map<string, FolderNode> = new Map(
      folders.map(f => [f.id, { ...f, children: [] as FolderNode[] }])
    );
    const rootFolders: FolderNode[] = [];
    folders.forEach(f => {
        const folderWithChildren = folderMap.get(f.id)!;
        if (f.parentId && folderMap.has(f.parentId)) {
            folderMap.get(f.parentId)!.children.push(folderWithChildren);
        } else {
            rootFolders.push(folderWithChildren);
        }
    });
    return rootFolders;
  }, [folders]);


  const currentSession = getActiveSession();
  const currentSessionTitle = currentSession?.title || "New Chat";
  const currentFolderId = currentSession?.folderId;

  const peopleByName = useMemo(() => {
    return new Map(people.map((person: any) => [person.name.toLowerCase(), person]));
  }, [people]);

  const peopleByEmail = useMemo(() => {
    return new Map(
      people
        .filter((person: any) => person.email)
        .map((person: any) => [person.email!.toLowerCase(), person])
    );
  }, [people]);

  const blockedPeopleByName = useMemo(() => {
    return new Set(people.filter((person: any) => person.isBlocked).map((person: any) => person.name.toLowerCase()));
  }, [people]);

  const blockedPeopleByEmail = useMemo(() => {
    return new Set(
      people
        .filter((person: any) => person.isBlocked && person.email)
        .map((person: any) => person.email!.toLowerCase())
    );
  }, [people]);

  const isPersonBlocked = useCallback(
    (person: { name: string; email?: string | null }) => {
      const nameKey = person.name?.toLowerCase();
      const emailKey = person.email?.toLowerCase();
      if (nameKey && blockedPeopleByName.has(nameKey)) return true;
      if (emailKey && blockedPeopleByEmail.has(emailKey)) return true;
      return false;
    },
    [blockedPeopleByEmail, blockedPeopleByName]
  );

  const currentSessionPeopleRaw = currentSession?.people || [];
  const currentSessionPeople = currentSessionPeopleRaw.filter(
    (person) => !isPersonBlocked(person)
  );
  const sourceMeeting = getMeetingForSession(currentSession);
  const sourceTranscript = getMeetingTranscript(sourceMeeting);

  const findExistingPerson = useCallback((person: { name: string; email?: string | null }) => {
    if (person.email) {
      const byEmail = peopleByEmail.get(person.email.toLowerCase());
      if (byEmail) return byEmail;
    }
    return peopleByName.get(person.name.toLowerCase()) || null;
  }, [peopleByEmail, peopleByName]);

  const suggestedQuestionItems = useMemo(() => {
    if (!sourceMeeting) return [];
    return [
      { label: "Summary", prompt: "Summarize this meeting in 3 bullets." },
      { label: "Key decisions", prompt: "What were the key decisions made in this meeting?" },
      { label: "Action items", prompt: "List the action items and who owns them." },
      { label: "Productivity", prompt: "How productive was this meeting? Highlight blockers or risks." },
    ];
  }, [sourceMeeting]);

  const handleAddPersonFromPanel = async (person: { name: string; email?: string | null; title?: string | null }) => {
    if (!user || !activeSessionId) return;
    try {
      const existing =
        findExistingPerson(person) ||
        getBestPersonMatch(person, people, 0.9)?.person ||
        null;
      if (existing) {
        toast({
          title: "Already in your directory",
          description: `${existing.name} is already saved.`,
        });
        return;
      }
      await addPerson(user.uid, {
        name: person.name,
        email: person.email ?? null,
        title: person.title ?? null,
      }, activeSessionId);
      toast({ title: "Person Added", description: `${person.name} has been added to your people directory.` });
    } catch (error) {
      toast({ title: "Error", description: "Could not add person.", variant: "destructive" });
    }
  };

  const handleMatchExistingPerson = async ({ person, matchedPerson }: { person: Partial<Person>; matchedPerson: Person }) => {
    if (!user) return;
    const sessionId = activeSessionId || sourceMeeting?.id || "chat";
    const aliases = new Set(matchedPerson.aliases || []);
    if (person.name && person.name.toLowerCase() !== matchedPerson.name.toLowerCase()) {
      aliases.add(person.name);
    }
    const sourceSessionIds = new Set(matchedPerson.sourceSessionIds || []);
    if (sessionId) sourceSessionIds.add(sessionId);
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

  const handleOpenPersonProfile = useCallback(
    (person: Person) => {
      router.push(`/people/${person.id}`);
    },
    [router]
  );
  
  const handleEditSelected = () => {
    if (selectedTaskIds.size === 0) return;
    setInputValue("Summarize the selected tasks and combine them into one."); // Example prompt
    toast({title: "Ready to Edit", description: "Type your instructions for the selected tasks and press send."});
  };

  const headerTitle = (
      <div className="flex items-center gap-2 flex-grow min-w-0">
          {sourceMeeting ? (
              <TooltipProvider>
                  <Tooltip>
                      <TooltipTrigger asChild>
                          <Link href={`/meetings`}>
                              <Button variant="outline" size="xs" className="h-7 gap-1.5 flex-shrink-0">
                                  <span className="font-semibold">From:</span> {truncateTitle(sourceMeeting.title, 20)}
                              </Button>
                          </Link>
                      </TooltipTrigger>
                      <TooltipContent>Go to source meeting</TooltipContent>
                  </Tooltip>
              </TooltipProvider>
          ) : (
             <div className="flex items-center gap-2 min-w-0">
                 {isEditingTitle && activeSessionId ? (
                     <Input
                         type="text"
                         value={editableTitle}
                         onChange={(e) => setEditableTitle(e.target.value)}
                         onBlur={handleSaveSessionTitle}
                         onKeyDown={(e) => {
                           if (e.key === 'Enter') { e.preventDefault(); handleSaveSessionTitle(); }
                           if (e.key === 'Escape') handleCancelEditTitle();
                         }}
                         className="text-xl font-semibold font-headline h-9 flex-grow"
                         autoFocus
                     />
                 ) : (
                     <h2
                         className="text-xl font-semibold font-headline truncate cursor-pointer hover:text-primary/80 flex-grow"
                         onClick={activeSessionId ? handleEditTitleClick : undefined}
                         title={currentSessionTitle}
                     >
                         {truncateTitle(currentSessionTitle)}
                     </h2>
                 )}
                  {!isEditingTitle && activeSessionId && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0">
                              <MoreVertical size={16} />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          <DropdownMenuItem onSelect={handleEditTitleClick}>
                              <Edit size={14} className="mr-2"/> Rename
                          </DropdownMenuItem>
                          <DropdownMenuSub>
                              <DropdownMenuSubTrigger>
                                  <FolderIcon size={14} className="mr-2"/> Move to...
                              </DropdownMenuSubTrigger>
                              <DropdownMenuPortal>
                                  <DropdownMenuSubContent>
                                      {renderFolderMenuItems(folderStructure)}
                                      {folders.length > 0 && <DropdownMenuSeparator />}
                                      <DropdownMenuItem onClick={() => handleMoveToFolder(null)} disabled={!currentFolderId}>
                                          <FolderOpen className="mr-2 h-4 w-4" /> Move to Root
                                      </DropdownMenuItem>
                                  </DropdownMenuSubContent>
                              </DropdownMenuPortal>
                          </DropdownMenuSub>
                        </DropdownMenuContent>
                      </DropdownMenu>
                  )}
             </div>
          )}
      </div>
  );

  const tasksPanelContent = (
    <div className="flex flex-col h-full rounded-3xl bg-gradient-to-b from-background/90 via-background/80 to-background/60 backdrop-blur-xl border border-border/50 shadow-[0_18px_50px_-30px_rgba(0,0,0,0.7)]">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <ListChecks className="h-4 w-4 text-primary" />
            Tasks
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-7"
              onClick={() => toggleSelectionByIds(allTaskIds)}
              disabled={suggestedTasks.length === 0}
            >
              {isAllTasksSelected ? 'Clear all' : 'Select all'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7"
              onClick={() => setIsTasksGrouped((prev) => !prev)}
              disabled={suggestedTasks.length === 0}
            >
              {isTasksGrouped ? 'Grouped' : 'All'}
            </Button>
          </div>
        </div>
        <div className="flex-1 flex min-h-0">
          <ScrollArea className="flex-1" id="suggestion-scroll-area">
              <div className="p-3 space-y-2 rounded-lg">
              {suggestedTasks.length > 0 ? (
                isTasksGrouped ? (
                  groupedTasks.map((group: any) => {
                    const groupCount = countTasksRecursive(group.tasks);
                    const groupIds = new Set<string>();
                    group.tasks.forEach((task: any) => {
                      getTaskAndAllDescendantIds(task).forEach((id: any) => groupIds.add(id));
                    });
                    const isGroupSelected = groupIds.size > 0 &&
                      Array.from(groupIds).every((id) => selectedTaskIds.has(id));
                    return (
                      <div key={group.type} className="space-y-2">
                        <div className="flex items-center justify-between rounded-lg border border-border/60 bg-background/70 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          <span>{group.label}</span>
                          <div className="flex items-center gap-2">
                            <Badge variant="secondary" className="text-[10px]">
                              {groupCount} task{groupCount > 1 ? 's' : ''}
                            </Badge>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-2 text-[10px]"
                              onClick={() => toggleSelectionByIds(groupIds)}
                            >
                              {isGroupSelected ? 'Clear' : 'Select all'}
                            </Button>
                          </div>
                        </div>
                        {group.tasks.map((task: any) => (
                          <TaskItem
                            key={task.id}
                            task={task}
                            level={0}
                            isSelected={selectedTaskIds.has(task.id)}
                            isIndeterminate={getCheckboxState(task, selectedTaskIds, suggestedTasks) === 'indeterminate'}
                            onToggleSelection={handleToggleSelection}
                            currentSelectedIds={selectedTaskIds}
                            allDisplayTasks={suggestedTasks}
                            onBreakDown={handleBreakDownTask}
                            onViewDetails={handleViewDetails}
                            onDeleteTask={() => dismissSuggestion(task.id)}
                            onSimplifyTask={() => setIsSimplifyConfirmOpen(true)}
                            onAssignPerson={() => {}}
                            onAddToBoard={handleOpenBoardPicker}
                            getCheckboxState={getCheckboxState}
                            isProcessing={isProcessingAiAction}
                            taskBeingProcessedId={null}
                          />
                        ))}
                      </div>
                    );
                  })
                ) : (
                  suggestedTasks.map((task: any) => (
                    <TaskItem
                      key={task.id}
                      task={task}
                      level={0}
                      isSelected={selectedTaskIds.has(task.id)}
                      isIndeterminate={getCheckboxState(task, selectedTaskIds, suggestedTasks) === 'indeterminate'}
                      onToggleSelection={handleToggleSelection}
                      currentSelectedIds={selectedTaskIds}
                      allDisplayTasks={suggestedTasks}
                      onBreakDown={handleBreakDownTask}
                      onViewDetails={handleViewDetails}
                      onDeleteTask={() => dismissSuggestion(task.id)}
                      onSimplifyTask={() => setIsSimplifyConfirmOpen(true)}
                      onAssignPerson={() => {}}
                      onAddToBoard={handleOpenBoardPicker}
                      getCheckboxState={getCheckboxState}
                      isProcessing={isProcessingAiAction}
                      taskBeingProcessedId={null}
                    />
                  ))
                )
              ) : (
              <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground py-12">
                  <Network size={40} className="mb-3 opacity-50" />
                  <p className="text-sm font-semibold">No active AI suggestions.</p>
                  <p className="text-xs">Tasks suggested by AI will appear here.</p>
              </div>
              )}
            </div>
          </ScrollArea>
        </div>
    </div>
  );

  const peoplePanelContent = (
    <div className="flex flex-col h-full rounded-3xl bg-gradient-to-b from-background/90 via-background/80 to-background/60 backdrop-blur-xl border border-border/50 shadow-[0_18px_50px_-30px_rgba(0,0,0,0.7)]">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Users className="h-4 w-4 text-primary" />
          People
        </div>
        <Button variant="ghost" size="sm" className="h-7" onClick={() => setIsDiscoveryDialogOpen(true)} disabled={currentSessionPeople.length === 0}>
          Review
        </Button>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-3 space-y-2">
          {currentSessionPeople.length > 0 ? (
            currentSessionPeople.map((person, index) => {
              const existingPerson = findExistingPerson(person);
              const assignedTasks = filterTasksByAssignee(suggestedTasks, person.name);
              const assignedCount = countTasksRecursive(assignedTasks);
              return (
                <div key={`${person.name}-${index}`} className="flex items-center justify-between gap-3 rounded-xl border bg-background/60 px-3 py-2">
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={`https://api.dicebear.com/8.x/initials/svg?seed=${person.name}`} />
                      <AvatarFallback>{getInitials(person.name)}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{person.name}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {person.title || "No title"}
                        {person.email ? ` | ${person.email}` : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {assignedCount > 0 && (
                      <Badge variant="secondary" className="text-[10px]">
                        {assignedCount} task{assignedCount > 1 ? 's' : ''}
                      </Badge>
                    )}
                    <Badge variant={existingPerson ? "secondary" : "outline"} className="text-[10px]">
                      {existingPerson ? "Saved" : "New"}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                        onClick={() => handleShareTasksForPerson(person, existingPerson)}
                      disabled={assignedCount === 0}
                    >
                      <Share2 className="h-4 w-4" />
                    </Button>
                    {!existingPerson && (
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleAddPersonFromPanel(person)}>
                        <UserPlus className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })
          ) : (
            <div className="flex flex-col items-center justify-center text-center text-muted-foreground py-12">
              <Users className="h-8 w-8 mb-3 opacity-50" />
              <p className="text-sm font-semibold">No people detected yet.</p>
              <p className="text-xs">Ask the AI to identify participants or paste a transcript.</p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );

  const isSidePanelOpen = activeSidePanel !== null;
  const sidePanelContent = activeSidePanel === 'people' ? peoplePanelContent : tasksPanelContent;
  const sidePanelTitle = activeSidePanel === 'people' ? 'People' : 'Tasks';

  return (
    <>
      <div className="relative flex flex-col h-full overflow-hidden bg-transparent">
         <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.12),_transparent_55%),radial-gradient(circle_at_bottom,_rgba(16,185,129,0.10),_transparent_45%)] opacity-70" />
         <motion.div
            className="relative flex flex-col h-full overflow-hidden"
            onPanEnd={(_event: MouseEvent | TouchEvent | PointerEvent, info: { offset: { x: number; y: number } }) => {
              if (info.offset.x < -100 && Math.abs(info.offset.y) < 50) { // Swipe Left
                if (suggestedTasks.length > 0) setActiveSidePanel('tasks');
              }
            }}
        >
          <DashboardHeader pageIcon={MessageSquareHeart} pageTitle={headerTitle}>
              <div className="flex items-center gap-2">
                {meetingOptions.length > 0 && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" className="gem-button bg-background h-9 px-3">
                        <Video className="mr-2 h-4 w-4" /> Meetings
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="max-h-72 overflow-auto">
                      {meetingOptions.map((meeting: any) => (
                        <DropdownMenuItem key={meeting.id} onSelect={() => handleOpenMeetingChat(meeting.id)}>
                          <Video className="mr-2 h-4 w-4" />
                          <span className="truncate">{meeting.title}</span>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" disabled={!activeSessionId} className="gem-button bg-background h-9 px-3">
                      <FolderIcon className="mr-2 h-4 w-4" /> Move to...
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    {renderFolderMenuItems(folderStructure)}
                    {folders.length > 0 && <DropdownMenuSeparator />}
                    <DropdownMenuItem onClick={() => handleMoveToFolder(null)} disabled={!currentFolderId}>
                      <FolderOpen className="mr-2 h-4 w-4" /> Move to Root
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                {sourceMeeting && (
                  <Button onClick={() => setIsTranscriptDialogOpen(true)} variant="outline" size="sm" className="gem-button bg-background h-9 px-3">
                    <FileText className="mr-2 h-4 w-4" /> Transcript
                  </Button>
                )}
                <Button onClick={() => setActiveSidePanel(activeSidePanel === 'people' ? null : 'people')} variant="outline" size="sm" className="gem-button bg-background h-9 px-3 relative">
                   <Users className="mr-2 h-4 w-4"/> People
                   {currentSessionPeople.length > 0 && (
                     <span className="absolute -top-1 -right-1 flex h-3 w-3 items-center justify-center rounded-full bg-primary text-primary-foreground text-[8px] font-bold">
                        {currentSessionPeople.length}
                     </span>
                   )}
                </Button>
                {suggestedTasks.length > 0 && (
                    <Button onClick={() => setActiveSidePanel(activeSidePanel === 'tasks' ? null : 'tasks')} variant="outline" size="sm" className="gem-button bg-background h-9 px-3 relative">
                      <ListChecks className="mr-2 h-4 w-4"/>
                       Tasks
                       {unaddedTasksInPanel > 0 &&
                         <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">
                            {unaddedTasksInPanel}
                         </span>
                       }
                    </Button>
                )}
                <Button onClick={handleNewChat} variant="outline" size="sm" disabled={isSendingMessage || isProcessingAiAction} className="gem-button bg-background h-9 px-3">
                    <PlusCircle className="mr-2 h-4 w-4"/> New Chat
                </Button>
              </div>
          </DashboardHeader>

          <div className="flex-1 flex min-h-0 relative gap-4 px-4 pb-4 pt-4" ref={layoutRef}>
            <div className="flex-1 flex flex-col bg-gradient-to-br from-background/90 via-background/70 to-background/40 border border-border/50 rounded-3xl shadow-[0_20px_60px_-40px_rgba(0,0,0,0.7)] backdrop-blur-xl overflow-hidden">
              <ScrollArea className={cn("flex-1", hasSelection && "pb-24")} ref={scrollAreaRef}>
                  <div className="p-6 md:p-8 space-y-8 max-w-3xl mx-auto w-full">
                    {currentMessages.length === 0 && (
                      <Alert className="max-w-2xl mx-auto my-10 border-dashed bg-background/60 backdrop-blur-md rounded-2xl shadow-[0_16px_40px_-30px_rgba(0,0,0,0.6)]">
                        <Info className="h-4 w-4" />
                        <AlertTitle>What's on your mind?</AlertTitle>
                        <AlertDescription>
                          Describe your project, paste meeting notes, or just say hello!
                          <br />
                          <strong className="text-primary">Pro Tip:</strong> You can paste content from anywhere in the app using <kbd className="px-1.5 py-0.5 border rounded bg-muted font-mono text-xs">Ctrl+V</kbd> to get started.
                        </AlertDescription>
                      </Alert>
                    )}
                    {sourceMeeting && currentSessionPeople.length > 0 && (
                      <div className="rounded-2xl border border-border/60 bg-background/70 p-4 shadow-[0_16px_40px_-32px_rgba(0,0,0,0.6)]">
                        <div className="mb-3 flex items-center justify-between">
                          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            People in this meeting
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7"
                            onClick={() => setIsDiscoveryDialogOpen(true)}
                          >
                            Manage
                          </Button>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {currentSessionPeople.map((person, index) => {
                            const existingPerson = findExistingPerson(person);
                            const assignedCount = countTasksRecursive(
                              filterTasksByAssignee(suggestedTasks, person.name)
                            );
                            return (
                              <DropdownMenu key={`${person.name}-${index}`}>
                                <DropdownMenuTrigger asChild>
                                  <button
                                    className="flex items-center gap-2 rounded-full border border-border/50 bg-background/80 px-3 py-1.5 text-xs font-medium text-foreground shadow-sm transition hover:border-primary/40 hover:bg-background"
                                    type="button"
                                  >
                                    <Avatar className="h-6 w-6">
                                      <AvatarImage src={`https://api.dicebear.com/8.x/initials/svg?seed=${person.name}`} />
                                      <AvatarFallback>{getInitials(person.name)}</AvatarFallback>
                                    </Avatar>
                                    <span className="max-w-[120px] truncate">{person.name}</span>
                                    <Badge variant={existingPerson ? "secondary" : "outline"} className="text-[10px]">
                                      {existingPerson ? "Saved" : "New"}
                                    </Badge>
                                    {assignedCount > 0 && (
                                      <Badge variant="secondary" className="text-[10px]">
                                        {assignedCount}
                                      </Badge>
                                    )}
                                  </button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="start">
                                  {existingPerson ? (
                                    <DropdownMenuItem onSelect={() => handleOpenPersonProfile(existingPerson)}>
                                      <Users className="mr-2 h-4 w-4" />
                                      Open profile
                                    </DropdownMenuItem>
                                  ) : (
                                    <DropdownMenuItem onSelect={() => handleAddPersonFromPanel(person)}>
                                      <UserPlus className="mr-2 h-4 w-4" />
                                      Add to People
                                    </DropdownMenuItem>
                                  )}
                                  <DropdownMenuItem onSelect={() => handleShareTasksForPerson(person, existingPerson)}>
                                    <Share2 className="mr-2 h-4 w-4" />
                                    Send assigned tasks
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {sourceMeeting && suggestedQuestionItems.length > 0 && (
                      <div className="rounded-2xl border border-border/60 bg-muted/30 p-4">
                        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Suggested questions
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {suggestedQuestionItems.map((item: any) => (
                            <Button
                              key={item.label}
                              variant="outline"
                              size="sm"
                              className="h-8 rounded-full bg-background"
                              onClick={() => handleSuggestedQuestion(item.prompt)}
                              disabled={isSendingMessage || isProcessingAiAction}
                            >
                              {item.label}
                            </Button>
                          ))}
                        </div>
                      </div>
                    )}
                    {currentMessages.map((msg: any) => (
                      <div key={msg.id} className="flex flex-col gap-2">
                          <div className={`flex items-start gap-3 ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                              {msg.sender === 'ai' && (
                                  <div className="h-9 w-9 border rounded-full flex items-center justify-center bg-background shrink-0">
                                      <Logo size="sm" isIconOnly={true} />
                                  </div>
                              )}
                              <MessageDisplay
                                message={msg}
                                onShowFullText={handleShowFullText}
                                onAnimationComplete={handleAnimationComplete}
                                hasAnimated={animatedMessages.has(msg.id)}
                                onConfirmDelete={handleConfirmDeleteFromChat}
                                onCancelDelete={handleCancelDeleteFromChat}
                              />
                              {msg.sender === 'user' && (
                                  <Avatar className="h-9 w-9 border shrink-0">
                                      <AvatarImage src={msg.avatar} alt={msg.name || 'User'} data-ai-hint="profile user"/>
                                      <AvatarFallback>{getInitials(msg.name)}</AvatarFallback>
                                  </Avatar>
                              )}
                          </div>
                          <span className={`text-xs text-muted-foreground ${msg.sender === 'user' ? 'text-right' : 'ml-12'}`}>{msg.name}, {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                    ))}
                    <div ref={messagesEndRef} />
                  </div>
              </ScrollArea>
              <div className={cn("p-4 md:p-5 bg-background/70 border-t border-border/50 backdrop-blur-xl space-y-2", hasSelection && "mb-28")}>
                  <div className="flex items-center justify-end gap-2">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={handleUndo}
                      disabled={undoStack.length === 0 || isSendingMessage || isProcessingAiAction}
                    >
                      <Undo2 className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={handleRedo}
                      disabled={redoStack.length === 0 || isSendingMessage || isProcessingAiAction}
                    >
                      <Redo2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="flex w-full items-center gap-2">
                      <div className="border-beam flex-1 rounded-full">
                          <Input
                              type="text"
                              placeholder="Type your message or task..."
                              value={inputValue}
                              onChange={(e) => setInputValue(e.target.value)}
                              onKeyPress={(e) => e.key === 'Enter' && !isSendingMessage && handleSendMessage()}
                              className="w-full h-12 rounded-full bg-background/80 border border-border/60 px-4"
                              disabled={isSendingMessage || isProcessingAiAction}
                          />
                      </div>
                      <Button onClick={handleSendMessage} disabled={isSendingMessage || (!inputValue.trim() && selectedTaskIds.size === 0) || isProcessingAiAction} className="h-12 rounded-full px-4 bg-primary hover:bg-primary/90 text-primary-foreground"><Send className="h-5 w-5 mr-0 sm:mr-2" /><span className="hidden sm:inline">Send</span></Button>
                  </div>
              </div>
            </div>
            
            {isTabletOrMobile ? (
                <Sheet open={isSidePanelOpen} onOpenChange={(open) => !open && setActiveSidePanel(null)}>
                    <SheetContent side="right" className="w-[88vw] max-w-md p-0">
                        <SheetHeader className="sr-only">
                          <SheetTitle>{sidePanelTitle}</SheetTitle>
                          <SheetDescription>
                            {sidePanelTitle === 'People'
                              ? 'People discovered in this chat.'
                              : 'A list of tasks and items suggested by the AI based on the conversation.'}
                          </SheetDescription>
                        </SheetHeader>
                        {sidePanelContent}
                    </SheetContent>
                </Sheet>
            ) : (
                isSidePanelOpen && (
                  <>
                    <div
                      className={cn(
                        "w-2 flex items-center justify-center cursor-col-resize",
                        isPanelResizing ? "bg-primary/20" : "bg-transparent"
                      )}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        setIsPanelResizing(true);
                      }}
                      role="separator"
                      aria-orientation="vertical"
                    >
                      <GripVertical className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <aside style={{ width: panelWidth }} className="shrink-0">
                      {sidePanelContent}
                    </aside>
                  </>
                )
            )}
          </div>
        </motion.div>
    </div>

      <SelectionToolbar
        selectedCount={selectedTaskIds.size}
        onClear={() => setSelectedTaskIds(new Set())}
        onView={() => setIsSelectionViewVisible(true)}
        onEdit={handleEditSelected}
        onAssign={handleOpenAssignDialog}
        onSetDueDate={handleOpenDueDateDialog}
        onDelete={handleDeleteSelected}
        onSend={handleExportSelected}
        onCopy={handleCopySelected}
        onGenerateBriefs={handleGenerateBriefs}
        onShareToSlack={handleShareToSlack}
        isSlackConnected={isSlackConnected}
        onPushToGoogleTasks={handlePushToGoogleTasks}
        isGoogleTasksConnected={isGoogleTasksConnected}
        onPushToTrello={handlePushToTrello}
        isTrelloConnected={isTrelloConnected}
        containerStyle={{
          right: isSidePanelOpen ? panelWidth + 24 : 0,
        }}
      />

      <SelectionViewDialog 
        isOpen={isSelectionViewVisible}
        onClose={() => setIsSelectionViewVisible(false)}
        tasks={selectedTasks}
      />

      <Dialog
        open={isBoardPickerOpen}
        onOpenChange={(open) => {
          setIsBoardPickerOpen(open);
          if (!open) {
            setBoardPickerTask(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Add task to a board</DialogTitle>
            <DialogDescription>
              Choose where to promote this task.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {boardPickerTask?.title || "Task"}
            </p>
            <Select
              value={selectedBoardId}
              onValueChange={(value) => setSelectedBoardId(value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a board" />
              </SelectTrigger>
              <SelectContent>
                {boards.map((board: any) => (
                  <SelectItem key={board.id} value={board.id}>
                    {board.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsBoardPickerOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleConfirmAddToBoard}
              disabled={isAddingToBoard || !selectedBoardId}
            >
              {isAddingToBoard ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Adding
                </>
              ) : (
                "Add to board"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
          shareTitle={editableTitle || "Chat"}
        />
      <Dialog open={isFullTextViewerOpen} onOpenChange={setIsFullTextViewerOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>View Attached Content</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Textarea
              value={textForViewer}
              readOnly
              className="h-[60vh] max-h-[70vh] min-h-[300px]"
            />
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={isTranscriptDialogOpen} onOpenChange={setIsTranscriptDialogOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Meeting Transcript</DialogTitle>
            <DialogDescription>{sourceMeeting?.title || "Transcript reference"}</DialogDescription>
          </DialogHeader>
          <ScrollArea className="h-[60vh] rounded-lg border bg-muted/30 p-4">
            <pre className="text-xs whitespace-pre-wrap font-mono text-muted-foreground">
              {sourceTranscript || "No transcript available for this meeting."}
            </pre>
          </ScrollArea>
        </DialogContent>
      </Dialog>
      <AssignPersonDialog
        isOpen={isAssignPersonDialogOpen}
        onClose={() => setIsAssignPersonDialogOpen(false)}
        people={people}
        isLoadingPeople={isLoadingPeople}
        onAssign={handleConfirmAssignPerson}
        onCreatePerson={handleCreatePerson}
        task={null}
        selectedTaskIds={selectedTaskIds}
      />
       <PeopleDiscoveryDialog
        isOpen={isDiscoveryDialogOpen}
        onClose={handleDiscoveryDialogClose}
        onMatch={handleMatchExistingPerson}
        discoveredPeople={currentSessionPeople}
        existingPeople={people}
      />
       <SetDueDateDialog
        isOpen={isSetDueDateDialogOpen}
        onClose={() => setIsSetDueDateDialogOpen(false)}
        onConfirm={handleConfirmSetDueDate}
      />
      <AlertDialog open={isSimplifyConfirmOpen} onOpenChange={setIsSimplifyConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center">
              <SimplifyIcon className="mr-2 h-5 w-5 text-yellow-500"/>Confirm AI Simplification
            </AlertDialogTitle>
            <AlertDialogDescription>
                This will use AI to analyze the selected task and its subtasks, then replace it with a more concise version. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
                const tasksToSimplify = getSelectedTasks();
                tasksToSimplify.forEach(handleSimplifyTask);
              }} 
              disabled={isProcessingAiAction}>
              {isProcessingAiAction ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : null}
              Proceed
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <RadialMenu
          state={radialMenuState}
          onClose={() => setRadialMenuState({ ...radialMenuState, open: false })}
          onAssign={handleOpenAssignDialog}
          onSetDueDate={handleOpenDueDateDialog}
          onDelete={handleDeleteSelected}
          onShare={handleShareSelected}
          onBreakDown={() => {
            const tasksToProcess = Array.from(selectedTaskIds).map(id => findTaskById(suggestedTasks, id)).filter(Boolean) as ExtractedTaskSchema[];
            tasksToProcess.forEach(handleBreakDownTask);
            setRadialMenuState({ open: false, x: 0, y: 0 });
          }}
          onSimplify={() => {
            setIsSimplifyConfirmOpen(true);
            setRadialMenuState({ open: false, x: 0, y: 0 });
          }}
      />
      <AlertDialog open={!!taskToDelete} onOpenChange={(open) => !open && setTaskToDelete(null)}>
          <AlertDialogContent>
              <AlertDialogHeader>
                  <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                  <AlertDialogDescription>
                      This action will permanently delete {selectedTaskIds.size} tasks and all of their subtasks. This cannot be undone.
                  </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                      className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
                      onClick={() => {
                          const ids = Array.from(selectedTaskIds);
                          ids.forEach(dismissSuggestion);
                          setTaskToDelete(null);
                      }}
                  >
                      Delete
                  </AlertDialogAction>
              </AlertDialogFooter>
          </AlertDialogContent>
      </AlertDialog>
      {activeSessionId && (
        <ShareToSlackDialog
          isOpen={isShareToSlackOpen}
          onClose={() => setIsShareToSlackOpen(false)}
          tasks={selectedTasks}
          sessionTitle={currentSessionTitle}
        />
      )}
      {activeSessionId && (
        <PushToGoogleTasksDialog
          isOpen={isPushToGoogleOpen}
          onClose={() => setIsPushToGoogleOpen(false)}
          tasks={selectedTasks}
        />
      )}
      {activeSessionId && (
        <PushToTrelloDialog
          isOpen={isPushToTrelloOpen}
          onClose={() => setIsPushToTrelloOpen(false)}
          tasks={selectedTasks}
        />
      )}
    </>
  );
}



