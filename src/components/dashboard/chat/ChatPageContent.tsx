// src/components/dashboard/chat/ChatPageContent.tsx
"use client";

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Send, Loader2, PlusCircle, MoreVertical, Edit, Zap as SimplifyIcon, Share2, Info, Folder as FolderIcon, FolderOpen, ClipboardPaste, Users, UserPlus, ListChecks, Network, Video, MessageSquareHeart, GripVertical, FileText } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { extractTasksFromChat, type OrchestratorInput, type OrchestratorOutput } from '@/ai/flows/extract-tasks';
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
import { sanitizeTaskForFirestore, addPerson, onPeopleSnapshot } from '@/lib/data';
import type { Person } from '@/types/person';
import { shareTasksNative, formatTasksToText, copyTextToClipboard, exportTasksToCSV, exportTasksToMarkdown, exportTasksToPDF } from '@/lib/exportUtils';
import AssignPersonDialog from '../planning/AssignPersonDialog';
import DashboardHeader from '../DashboardHeader';
import { RadialMenu } from './RadialMenu';
import TaskItem from '../tasks/TaskItem'; 
import { useMeetingHistory } from '@/contexts/MeetingHistoryContext';
import { usePlanningHistory } from '@/contexts/PlanningHistoryContext';
import { processPastedContent } from '@/ai/flows/process-pasted-content';
import Link from 'next/link';
import SetDueDateDialog from '../planning/SetDueDateDialog';
import SelectionToolbar from '../common/SelectionToolbar';
import SelectionViewDialog from '../explore/SelectionViewDialog';
import { generateResearchBrief, type GenerateResearchBriefInput } from '@/ai/flows/generate-research-brief-flow';
import ShareToSlackDialog from '../common/ShareToSlackDialog';
import PushToGoogleTasksDialog from '../common/PushToGoogleTasksDialog';
import PushToTrelloDialog from '../common/PushToTrelloDialog';
import { TASK_TYPE_LABELS, TASK_TYPE_VALUES, type TaskTypeCategory } from '@/lib/task-types';
import type { Meeting } from '@/types/meeting';


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
      .map((node) => {
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
  TRANSCRIPT_TIMESTAMP_REGEX.test(text);


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

const MessageSources: React.FC<{ sources?: ChatMessageType['sources'] }> = ({ sources }) => {
  if (!sources || sources.length === 0) {
    return null;
  }
  return (
    <div className="mt-2 ml-12 border-l-2 border-primary/20 pl-4 space-y-2">
      {sources.map((source: MessageSource, index: number) => (
        <blockquote key={index} className="p-2 rounded-md bg-muted/50 border border-border/50 text-xs text-muted-foreground">
          <span className="font-mono text-primary mr-2">[{source.timestamp}]</span>
          "{source.snippet}"
        </blockquote>
      ))}
    </div>
  );
};


const MessageDisplay: React.FC<{ message: ChatMessageType; onShowFullText: (text: string) => void; onAnimationComplete: (id: string) => void; hasAnimated: boolean; }> = ({ message, onShowFullText, onAnimationComplete, hasAnimated }) => {
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
          </div>
        )}
      </div>
      {message.sender === 'ai' && <MessageSources sources={message.sources} />}
    </>
  );
};


export default function ChatPageContent() {
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

  const [inputValue, setInputValue] = useState('');
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [suggestedTasks, setSuggestedTasks] = useState<ExtractedTaskSchema[]>([]);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  
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
  }, [user]);

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

  useEffect(() => {
    const activeSession = getActiveSession();
    if (!activeSession || activeSession.sourceMeetingId) return;
    const meeting = meetings.find((item) => item.chatSessionId === activeSession.id);
    if (meeting) {
      updateSession(activeSession.id, { sourceMeetingId: meeting.id });
    }
  }, [activeSessionId, getActiveSession, meetings, updateSession]);


  const getInitials = (name: string | null | undefined) => (name ? name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2) : 'U');
  const userAvatar = user?.photoURL || `https://api.dicebear.com/8.x/initials/svg?seed=${user?.displayName || user?.email}`;
  const userName = user?.displayName || 'User';
  const aiName = "TaskWise AI";
  const requestedDetailLevel = user?.taskGranularityPreference ?? 'medium';
  const getMeetingForSession = useCallback(
    (session?: { sourceMeetingId?: string | null; id?: string | null }) => {
      if (!session) return undefined;
      return (
        meetings.find((meeting) => meeting.id === session.sourceMeetingId) ||
        meetings.find((meeting) => meeting.chatSessionId === session.id)
      );
    },
    [meetings]
  );

  useEffect(() => {
    const currentActiveSession = getActiveSession();
    if (currentActiveSession) {
      setSuggestedTasks(currentActiveSession.suggestedTasks || []);
       setEditableTitle(currentActiveSession.title);
    } else {
      setSuggestedTasks([]);
      setEditableTitle("New Chat");
    }
    setSelectedTaskIds(new Set());
    setIsEditingTitle(false);
    const shouldShow = (currentActiveSession?.suggestedTasks?.length ?? 0) > 0;
    setActiveSidePanel((prev) => {
      if (isTabletOrMobile) return null;
      if (shouldShow) return prev ?? 'tasks';
      return prev === 'people' ? 'people' : null;
    });
  }, [activeSessionId, getActiveSession, isTabletOrMobile]);


  useEffect(() => {
    if (selectedTaskIds.size > 0) {
      setShowCopyHint(true);
      const timer = setTimeout(() => setShowCopyHint(false), 4000);
      return () => clearTimeout(timer);
    } else {
      setShowCopyHint(false);
    }
  }, [selectedTaskIds, setShowCopyHint]);

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
          if (!task.addedToProjectId) count++;
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

    const briefPromises = Array.from(selectedTaskIds).map(async (taskId) => {
      const taskToUpdate = findTaskById(suggestedTasks, taskId);
      if (!taskToUpdate) return null;
      const input: GenerateResearchBriefInput = {
        taskTitle: taskToUpdate.title,
        taskDescription: taskToUpdate.description || undefined,
      };
      try {
        const briefResult = await generateResearchBrief(input);
        return { taskId, brief: briefResult.researchBrief };
      } catch (error) {
        console.error(`Error generating brief for task ${taskToUpdate.title}:`, error);
        return null;
      }
    });

    const results = await Promise.all(briefPromises);

    const applyBriefToTask = (nodes: ExtractedTaskSchema[], idToUpdate: string, brief: string): ExtractedTaskSchema[] => {
      return nodes.map((node) => {
        if (node.id === idToUpdate) {
          return sanitizeTaskForFirestore({ ...node, researchBrief: brief });
        }
        if (node.subtasks) {
          return { ...node, subtasks: applyBriefToTask(node.subtasks, idToUpdate, brief) };
        }
        return node;
      });
    };

    let updatedTasks = [...suggestedTasks];
    let briefsApplied = 0;
    results.forEach((result) => {
      if (result?.brief) {
        updatedTasks = applyBriefToTask(updatedTasks, result.taskId, result.brief);
        briefsApplied += 1;
      }
    });

    if (briefsApplied > 0) {
      setSuggestedTasks(updatedTasks);
      updateActiveSessionSuggestions(updatedTasks);
      if (taskForDetailView) {
        const refreshedTask = findTaskById(updatedTasks, taskForDetailView.id);
        if (refreshedTask) {
          setTaskForDetailView(refreshedTask);
        }
      }
      toast({ title: "Briefs Generated", description: `Research briefs generated for ${briefsApplied} task(s).` });
    } else {
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
    suggestedTasks.forEach((task) => {
      getTaskAndAllDescendantIds(task).forEach((id) => ids.add(id));
    });
    return ids;
  }, [suggestedTasks]);
  const isAllTasksSelected =
    allTaskIds.size > 0 && Array.from(allTaskIds).every((id) => selectedTaskIds.has(id));

  const groupedTasks = useMemo(() => {
    const byType = new Map<TaskTypeCategory, ExtractedTaskSchema[]>();
    suggestedTasks.forEach((task) => {
      const typeKey = normalizeTaskType(task.taskType);
      const group = byType.get(typeKey) || [];
      group.push(task);
      byType.set(typeKey, group);
    });
    return TASK_TYPE_VALUES
      .map((type) => ({
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
      ids.forEach((id) => nextSelected.delete(id));
    } else {
      ids.forEach((id) => nextSelected.add(id));
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
    allPeople.forEach((p) => peopleMap.set(p.name.toLowerCase(), p));
    newlySavedPeople.forEach((p) => peopleMap.set(p.name.toLowerCase(), p));

    const assignRecursively = (tasks: ExtractedTaskSchema[]): ExtractedTaskSchema[] => {
      return tasks.map((task) => {
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
    setSuggestedTasks(tasksWithAssignees);
    updateActiveSessionSuggestions(tasksWithAssignees);
  };

  const handleSendMessage = async () => {
    if (inputValue.trim() === '' && selectedTaskIds.size === 0) return;

    const currentInput = inputValue;
    const shouldAttach = currentInput.trim().length > 500;
    const userMessage: ChatMessageType = {
        id: `msg-${Date.now()}`,
        text: shouldAttach ? "Pasted text" : currentInput,
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
            if (isTranscriptLike(currentInput)) {
                const result = await processPastedContent({ pastedText: currentInput });
                if (result.isMeeting && result.meeting) {
                    const newMeeting = await createNewMeeting(result.meeting);
                    if (newMeeting) {
                        const newChat = await createNewSession({
                          title: `Chat about "${newMeeting.title}"`,
                          sourceMeetingId: newMeeting.id,
                          initialTasks: result.tasks,
                          initialPeople: result.people,
                        });
                        const newPlan = await createNewPlanningSession(newMeeting.summary, result.tasks, `Plan from "${newMeeting.title}"`, result.allTaskLevels, newMeeting.id);
                        if (newChat && newPlan) {
                            await updateMeeting(newMeeting.id, { chatSessionId: newChat.id, planningSessionId: newPlan.id });
                        }
                        if (newChat?.suggestedTasks && newChat.suggestedTasks.length > 0) {
                            setSuggestedTasks(newChat.suggestedTasks);
                        }
                        if (newChat?.title) {
                            setEditableTitle(newChat.title);
                        }
                    }
                } else {
                    const newSession = await createNewSession({ initialMessage: userMessage, title: "New Chat", initialTasks: result.tasks, initialPeople: result.people, allTaskLevels: result.allTaskLevels });
                    if (newSession?.suggestedTasks && newSession.suggestedTasks.length > 0) {
                        setSuggestedTasks(newSession.suggestedTasks);
                    }
                    if (newSession?.title) {
                        setEditableTitle(newSession.title);
                    }
                    setPendingPrompt(currentInput);
                }
            } else {
                const newSession = await createNewSession({ initialMessage: userMessage, title: "New Chat" });
                if (newSession?.suggestedTasks && newSession.suggestedTasks.length > 0) {
                    setSuggestedTasks(newSession.suggestedTasks);
                }
                if (newSession?.title) {
                    setEditableTitle(newSession.title);
                }
                setPendingPrompt(currentInput);
            }
        } catch (error) {
            console.error("Error processing initial message:", error);
            toast({ title: "AI Error", description: "Could not process initial message.", variant: "destructive" });
        } finally {
            setIsSendingMessage(false);
        }
    } else {
        await addMessageToActiveSession(userMessage);
        await processAIResponse(currentInput, false);
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
                if (result.tasks) {
                    const newTasks = result.tasks.map((t: ExtractedTaskSchema) => sanitizeTaskForFirestore(t as ExtractedTaskSchema));
                    setSuggestedTasks(newTasks);
                    updateActiveSessionSuggestions(newTasks);
                }
                if (result.sessionTitle) {
                    updateSessionTitle(activeSessionId, result.sessionTitle);
                }
                if (result.people && result.people.length > 0) {
                    const existingPeopleNames = new Set((currentSession?.people || []).map((person: { name: string }) => person.name));
                    const newPeopleDiscovered = result.people.filter((person: { name: string }) => !existingPeopleNames.has(person.name));
                    if (newPeopleDiscovered.length > 0) {
                        await updateSession(activeSessionId, { people: result.people });
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

  
  const dismissSuggestion = (taskId: string) => {
    removeSuggestionFromActiveSession(taskId);
    setSuggestedTasks(prev => prev.filter(task => task.id !== taskId));
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
        existingTasks: suggestedTasks, // Provide full context
        requestedDetailLevel,
      };
      const activeSession = getActiveSession();
        const meeting = getMeetingForSession(activeSession);
        const transcript = getMeetingTranscript(meeting);
        const result = await extractTasksFromChat({
          ...input,
          sourceMeetingTranscript: transcript,
        });
      
      setSuggestedTasks(result.tasks.map((t: ExtractedTaskSchema) => sanitizeTaskForFirestore(t as ExtractedTaskSchema)));
      updateActiveSessionSuggestions(result.tasks as ExtractedTaskSchema[]);
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
          selectedTasks: [taskToSimplify],
          existingTasks: suggestedTasks,
          requestedDetailLevel,
          sourceMeetingTranscript: transcript,
        });

        const newTasks = result.tasks.map((t: ExtractedTaskSchema) => sanitizeTaskForFirestore(t as ExtractedTaskSchema));
        setSuggestedTasks(newTasks);
        updateActiveSessionSuggestions(newTasks);
        
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

    setSuggestedTasks(newPanelSuggestions);
    updateActiveSessionSuggestions(newPanelSuggestions);
    if (options?.close !== false) {
      setIsTaskDetailDialogVisible(false);
    }
  };

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
    return [...meetings].sort((a, b) => getTime(b.lastActivityAt) - getTime(a.lastActivityAt));
  }, [meetings]);

  const handleOpenMeetingChat = async (meetingId: string) => {
    const meeting = meetings.find((m) => m.id === meetingId);
    if (!meeting) return;

    const existingSession =
      sessions.find((session) => session.sourceMeetingId === meetingId) ||
      (meeting.chatSessionId ? sessions.find((session) => session.id === meeting.chatSessionId) : undefined);

    if (existingSession) {
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
      initialTasks: meeting.extractedTasks || [],
      initialPeople: meeting.attendees || [],
      allTaskLevels: meeting.allTaskLevels,
    });

    if (newSession) {
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
        return sanitizeTaskForFirestore(updatedTask);
      });
    };
  
    const newExtractedTasks = updateAssigneeRecursively(suggestedTasks);
    setSuggestedTasks(newExtractedTasks);
    updateActiveSessionSuggestions(newExtractedTasks);
    
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

    setSuggestedTasks(newExtractedTasks);
    if (activeSessionId) {
        updateActiveSessionSuggestions(newExtractedTasks);
    }
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
  const currentSessionPeople = currentSession?.people || [];
  const sourceMeeting = getMeetingForSession(currentSession);
  const sourceTranscript = getMeetingTranscript(sourceMeeting);

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

  const findExistingPerson = useCallback((person: { name: string; email?: string | null }) => {
    if (person.email) {
      const byEmail = peopleByEmail.get(person.email.toLowerCase());
      if (byEmail) return byEmail;
    }
    return peopleByName.get(person.name.toLowerCase()) || null;
  }, [peopleByEmail, peopleByName]);

  const handleAddPersonFromPanel = async (person: { name: string; email?: string | null; title?: string | null }) => {
    if (!user || !activeSessionId) return;
    try {
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
                  groupedTasks.map((group) => {
                    const groupCount = countTasksRecursive(group.tasks);
                    const groupIds = new Set<string>();
                    group.tasks.forEach((task) => {
                      getTaskAndAllDescendantIds(task).forEach((id) => groupIds.add(id));
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
                        {group.tasks.map((task) => (
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
                            getCheckboxState={getCheckboxState}
                            isProcessing={isProcessingAiAction}
                            taskBeingProcessedId={null}
                          />
                        ))}
                      </div>
                    );
                  })
                ) : (
                  suggestedTasks.map((task) => (
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
                      {meetingOptions.map((meeting) => (
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

          <div className="flex-1 flex min-h-0 relative gap-4 px-4 pb-4" ref={layoutRef}>
            <div className="flex-1 flex flex-col bg-gradient-to-br from-background/90 via-background/70 to-background/40 border border-border/50 rounded-3xl shadow-[0_20px_60px_-40px_rgba(0,0,0,0.7)] backdrop-blur-xl overflow-hidden">
              <ScrollArea className="flex-1" ref={scrollAreaRef}>
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
                    {currentMessages.map((msg) => (
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
              <div className="p-4 md:p-5 bg-background/70 border-t border-border/50 backdrop-blur-xl space-y-2">
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
      />

      <SelectionViewDialog 
        isOpen={isSelectionViewVisible}
        onClose={() => setIsSelectionViewVisible(false)}
        tasks={selectedTasks}
      />

      <TaskDetailDialog
        isOpen={isTaskDetailDialogVisible}
        onClose={() => setIsTaskDetailDialogVisible(false)}
        task={taskForDetailView}
        onSave={handleSaveTaskDetails}
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
