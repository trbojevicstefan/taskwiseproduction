// src/components/dashboard/planning/PlanningPageContent.tsx
"use client";

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input'; // Added for title editing
import { Loader2, Sparkles, Brain, ListTree, PlusCircle, Edit2, AlertTriangle, X, Folder as FolderIcon, FolderOpen, ClipboardPaste, Trash2 as ClearIcon, ListFilter } from 'lucide-react';
import { useToast } from "@/hooks/use-toast";
import { extractTasksFromChat } from '@/ai/flows/extract-tasks';
import type { OrchestratorInput, OrchestratorOutput } from '@/ai/flows/schemas';
import { simplifyTaskBranch, type SimplifyTaskBranchInput } from '@/ai/flows/simplify-task-branch-flow';
import type { ExtractedTaskSchema as DisplayTask } from '@/types/chat';
import { usePlanningHistory } from '@/contexts/PlanningHistoryContext';
import { useFolders } from '@/contexts/FolderContext';
import { useUIState } from '@/contexts/UIStateContext';
import type { Folder } from '@/types/folder';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import MindMapDisplay from './MindMapDisplay';
import { useAuth } from '@/contexts/AuthContext';
import { normalizeTask as normalizeTaskUtil, onPeopleSnapshot, addPerson } from '@/lib/data';
import HierarchicalTaskItem from './HierarchicalTaskItem';
import TaskDetailDialog from './TaskDetailDialog';
import SetDueDateDialog from './SetDueDateDialog';
import AssignPersonDialog from './AssignPersonDialog';
import type { Person } from '@/types/person';
import { formatTasksToText, exportTasksToCSV, exportTasksToMarkdown, exportTasksToPDF, copyTextToClipboard } from '@/lib/exportUtils';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
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
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';

import { Badge } from '@/components/ui/badge';

import DashboardHeader from '../DashboardHeader';
import SelectionToolbar from '../common/SelectionToolbar';
import { v4 as uuidv4 } from 'uuid';
import ShareToSlackDialog from '../common/ShareToSlackDialog';
import { useIntegrations } from '@/contexts/IntegrationsContext';
import PushToGoogleTasksDialog from '../common/PushToGoogleTasksDialog';
import PushToTrelloDialog from '../common/PushToTrelloDialog';
import { generateTaskBrief } from "@/lib/task-insights-client";

type DetailLevel = 'light' | 'medium' | 'detailed';

// Helper to normalize a single task for storage compatibility
// Helper to normalize a single task for storage compatibility
const sanitizeTaskForInternalState = (task: any): DisplayTask => {
  const rawId = task?.id ?? (task?._id?.toString?.() || task?._id);
  const newId = rawId || uuidv4();
  return {
    id: newId,
    title: task.title || "Untitled Task",
    description: task.description || undefined,
    priority: task.priority || 'medium',
    taskType: task.taskType || undefined,
    dueAt: task.dueAt || undefined,
    researchBrief: task.researchBrief || undefined,
    aiAssistanceText: task.aiAssistanceText || undefined,
    assignee: task.assignee || undefined,
    subtasks: task.subtasks ? task.subtasks.map((st: any) => sanitizeTaskForInternalState(st)) : undefined,
    addedToProjectId: task.addedToProjectId || undefined,
    addedToProjectName: task.addedToProjectName || undefined,
  };
};


const findTaskByIdRecursive = (tasks: DisplayTask[], taskId: string): DisplayTask | null => {
  for (const task of tasks) {
    if (task.id === taskId) return task;
    if (task.subtasks) {
      const foundInSubtask = findTaskByIdRecursive(task.subtasks, taskId);
      if (foundInSubtask) return foundInSubtask;
    }
  }
  return null;
};

const getTaskAndAllDescendantIds = (task: DisplayTask): Set<string> => {
  const ids = new Set<string>();
  const queue: DisplayTask[] = [task];
  while (queue.length > 0) {
    const current = queue.shift()!;
    ids.add(current.id);
    current.subtasks?.forEach(subTask => queue.push(subTask));
  }
  return ids;
};

const getAncestors = (taskId: string, allTasks: DisplayTask[]): string[] => {
  const path: string[] = [];
  const findPath = (currentTask: DisplayTask, targetId: string, currentPath: string[]): boolean => {
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

const getTaskCheckboxState = (task: DisplayTask, currentSelectedIds: Set<string>, allTasks: DisplayTask[]): 'checked' | 'unchecked' | 'indeterminate' => {
  if (!task.subtasks || task.subtasks.length === 0) {
    return currentSelectedIds.has(task.id) ? 'checked' : 'unchecked';
  }
  let allChildrenSelected = true;
  let someChildrenSelected = false;
  for (const subtask of task.subtasks) {
    const subtaskState = getTaskCheckboxState(subtask, currentSelectedIds, allTasks);
    if (subtaskState === 'checked') {
      someChildrenSelected = true;
    } else if (subtaskState === 'indeterminate') {
      someChildrenSelected = true;
      allChildrenSelected = false;
    } else {
      allChildrenSelected = false;
    }
  }
  if (currentSelectedIds.has(task.id)) {
    if (allChildrenSelected && task.subtasks.every(st => currentSelectedIds.has(st.id))) return 'checked';
    return 'indeterminate';
  } else {
    if (someChildrenSelected) return 'indeterminate';
    return 'unchecked';
  }
};

const truncateTitle = (title: string | undefined, maxLength: number = 30): string => {
  if (!title) return "Untitled Plan";
  if (title.length <= maxLength) {
    return title;
  }
  return title.substring(0, maxLength - 3) + "...";
};




export default function PlanningPageContent() {
  const { user, updateUserProfile } = useAuth();
  const { isSlackConnected, isGoogleTasksConnected, isTrelloConnected } = useIntegrations();
  const [pastedContent, setPastedContent] = useState('');
  const [typedInput, setTypedInput] = useState('');
  const [isGeneratingInitialPlan, setIsGeneratingInitialPlan] = useState(false);
  const [extractedTasks, setExtractedTasks] = useState<DisplayTask[]>([]);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const lastPlanningSessionIdRef = useRef<string | null>(null);
  const { toast } = useToast();
  const {
    activePlanningSessionId,
    createNewPlanningSession,
    getActivePlanningSession,
    updateActivePlanningSession,
    updatePlanningSessionTitle, // Added for direct title update
    updatePlanningSession,
  } = usePlanningHistory();
  const { folders } = useFolders();
  const { setShowCopyHint } = useUIState();

  const [isInputAreaVisible, setIsInputAreaVisible] = useState(true);

  const [isTaskDetailDialogVisible, setIsTaskDetailDialogVisible] = useState(false);
  const [taskForDetailView, setTaskForDetailView] = useState<DisplayTask | null>(null);

  const [isProcessingSubtasks, setIsProcessingSubtasks] = useState(false);
  const [taskForSubtaskGenerationId, setTaskForSubtaskGenerationId] = useState<string | null>(null);
  const [isProcessingBatchBriefs, setIsProcessingBatchBriefs] = useState(false);
  const [isProcessingSimplify, setIsProcessingSimplify] = useState(false);
  const [taskToSimplify, setTaskToSimplify] = useState<DisplayTask | null>(null);
  const [isSimplifyConfirmOpen, setIsSimplifyConfirmOpen] = useState(false);

  const [isSetDueDateDialogOpen, setIsSetDueDateDialogOpen] = useState(false);

  const [taskToDelete, setTaskToDelete] = useState<DisplayTask | null>(null);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);

  const [isEditingTitle, setIsEditingTitle] = useState(false); // For title editing
  const [editableTitle, setEditableTitle] = useState(""); // For title editing input

  const [isFullTextViewerOpen, setIsFullTextViewerOpen] = useState(false);
  const [editedPastedContent, setEditedPastedContent] = useState("");
  const [isEditingPastedContent, setIsEditingPastedContent] = useState(false);

  const [isAssignPersonDialogOpen, setIsAssignPersonDialogOpen] = useState(false);
  const [taskToAssign, setTaskToAssign] = useState<DisplayTask | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [isLoadingPeople, setIsLoadingPeople] = useState(true);
  const [currentDetailLevel, setCurrentDetailLevel] = useState<DetailLevel>('medium');
  const [isShareToSlackOpen, setIsShareToSlackOpen] = useState(false);
  const [isPushToGoogleOpen, setIsPushToGoogleOpen] = useState(false);
  const [isPushToTrelloOpen, setIsPushToTrelloOpen] = useState(false);


  const stableGetActivePlanningSession = useCallback(getActivePlanningSession, [getActivePlanningSession]);

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

  useEffect(() => {
    if (user?.taskGranularityPreference) {
      setCurrentDetailLevel(user.taskGranularityPreference);
    }
  }, [user?.taskGranularityPreference]);

  useEffect(() => {
    const activeSession = stableGetActivePlanningSession();
    const sessionId = activeSession?.id ?? null;
    if (activeSession) {
      setPastedContent(activeSession.inputText);
      setTypedInput(''); // Typed input is transient
      setExtractedTasks(activeSession.extractedTasks || []);
      setEditableTitle(activeSession.title); // Initialize editable title
      if (activeSession.extractedTasks && activeSession.extractedTasks.length > 0) {
        setIsInputAreaVisible(false);
      } else {
        setIsInputAreaVisible(true);
      }
    } else {
      setPastedContent('');
      setTypedInput('');
      setExtractedTasks([]);
      setIsInputAreaVisible(true);
      setEditableTitle("New Plan"); // Default for new plan
    }
    if (lastPlanningSessionIdRef.current !== sessionId) {
      lastPlanningSessionIdRef.current = sessionId;
      setSelectedTaskIds(new Set());
      setIsEditingTitle(false); // Ensure editing mode is off when session changes
    }
  }, [activePlanningSessionId, stableGetActivePlanningSession]);

  useEffect(() => {
    const activeSession = getActivePlanningSession();
    if (!activeSession?.allTaskLevels) {
      setExtractedTasks(activeSession?.extractedTasks || []);
      return;
    }
    const newTasks = activeSession.allTaskLevels[currentDetailLevel] || activeSession.extractedTasks || [];
    setExtractedTasks(newTasks);
  }, [currentDetailLevel, activePlanningSessionId, getActivePlanningSession]);

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
      extractedTasks.forEach((task: any) => {
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
  }, [extractedTasks]);

  const getSelectedTasks = (): DisplayTask[] => {
    const buildHierarchy = (tasks: DisplayTask[]): DisplayTask[] => {
      return tasks.map(task => {
        const isSelected = selectedTaskIds.has(task.id);
        const selectedSubtasks = task.subtasks ? buildHierarchy(task.subtasks) : [];
        if (isSelected || selectedSubtasks.length > 0) {
          return { ...task, subtasks: selectedSubtasks };
        }
        return null;
      }).filter(Boolean) as DisplayTask[];
    };
    return buildHierarchy(extractedTasks);
  };

  const handleCopySelected = async () => {
    if (selectedTaskIds.size === 0) {
      toast({ title: "No tasks selected", description: "Please select tasks to copy.", variant: "destructive" });
      return;
    }

    const tasksToCopy = getSelectedTasks();
    const textToCopy = formatTasksToText(tasksToCopy);
    const { success, method } = await copyTextToClipboard(textToCopy);

    if (success) {
      toast({
        title: "Copied!",
        description: `Tasks copied to clipboard${method === 'fallback' ? ' (using fallback)' : ''}.`
      });
    } else {
      toast({
        title: "Copy Failed",
        description: "Could not automatically copy tasks. Please try again.",
        variant: "destructive"
      });
    }
  };

  // Keyboard shortcut for copying selected tasks
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'c') {
        if (selectedTaskIds.size > 0) {
          event.preventDefault();
          handleCopySelected();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [selectedTaskIds, extractedTasks, toast]);


  const handleGeneratePlan = async () => {
    if (pastedContent.trim() === '' && typedInput.trim() === '') {
      toast({ title: "Input Empty", description: "Please enter some text to generate a plan.", variant: "destructive" });
      return;
    }
    setIsGeneratingInitialPlan(true);
    setSelectedTaskIds(new Set());

    // Combine pasted content with typed instructions
    const fullPrompt = pastedContent
      ? `${typedInput}\n\n--- Attached Content ---\n${pastedContent}`
      : typedInput;

    try {
      const extractInput: OrchestratorInput = {
        message: fullPrompt,
        requestedDetailLevel: currentDetailLevel,
      };
      const result: OrchestratorOutput = await extractTasksFromChat(extractInput);

      let newDisplayTasks: DisplayTask[] = [];

      if (result.tasks && result.tasks.length > 0) {
        newDisplayTasks = result.tasks.map((t: any) =>
          sanitizeTaskForInternalState(t as DisplayTask)
        );
        setExtractedTasks(newDisplayTasks);
        toast({ title: "Plan Generated!", description: `${newDisplayTasks.length} macro task(s) identified.` });
        setIsInputAreaVisible(false);
      } else {
        setExtractedTasks([]);
        toast({ title: "No Tasks Found", description: "The AI didn't identify any actionable tasks from your input." });
        setIsInputAreaVisible(true);
      }

      if (activePlanningSessionId) {
        updateActivePlanningSession({
          inputText: pastedContent,
          extractedTasks: newDisplayTasks.map(normalizeTaskUtil),
          allTaskLevels: result.allTaskLevels as any, // Save all levels
        });
        setEditableTitle(getActivePlanningSession()?.title || typedInput.substring(0, 40) || "Updated Plan");
      } else {
        const newSession = await createNewPlanningSession(
          pastedContent,
          newDisplayTasks.map(normalizeTaskUtil),
          typedInput,
          result.allTaskLevels as any // Pass all levels to new session
        );
        if (newSession) setEditableTitle(newSession.title);
      }
      setTypedInput(''); // Clear typed input after generation

    } catch (error) {
      console.error("Error generating plan:", error);
      toast({ title: "AI Error", description: "Could not generate plan.", variant: "destructive" });
      setIsInputAreaVisible(true);
    } finally {
      setIsGeneratingInitialPlan(false);
    }
  };

  const handleNewPlan = async () => {
    setIsGeneratingInitialPlan(true);
    await createNewPlanningSession("", []);
    setPastedContent('');
    toast({ title: "New Plan Started" });
    setIsGeneratingInitialPlan(false);
  };

  const handleToggleSelection = useCallback((taskId: string, isSelectedNow: boolean) => {
    setSelectedTaskIds(prevSelectedIds => {
      const newSelectedIds = new Set(prevSelectedIds);
      const taskToToggle = findTaskByIdRecursive(extractedTasks, taskId);
      if (!taskToToggle) return newSelectedIds;

      const idsToUpdate = getTaskAndAllDescendantIds(taskToToggle);
      if (isSelectedNow) {
        idsToUpdate.forEach(id => newSelectedIds.add(id));
      } else {
        idsToUpdate.forEach(id => newSelectedIds.delete(id));
      }

      const ancestors = getAncestors(taskId, extractedTasks);
      ancestors.reverse().forEach(ancestorId => {
        const ancestorTask = findTaskByIdRecursive(extractedTasks, ancestorId);
        if (ancestorTask && ancestorTask.subtasks) {
          const allChildrenOfAncestorSelected = ancestorTask.subtasks.every(sub =>
            getTaskCheckboxState(sub, newSelectedIds, extractedTasks) === 'checked'
          );
          if (allChildrenOfAncestorSelected) {
            newSelectedIds.add(ancestorId);
          } else {
            newSelectedIds.delete(ancestorId);
          }
        }
      });
      return newSelectedIds;
    });
  }, [extractedTasks]);

  const countAllTasksRecursive = (tasks: DisplayTask[]): number => {
    let count = 0;
    tasks.forEach(task => {
      count++;
      if (task.subtasks) count += countAllTasksRecursive(task.subtasks);
    });
    return count;
  };

  const handleSelectAllTasks = (checked: boolean) => {
    const allTaskIdsSet = new Set<string>();
    if (checked) {
      const getAllIdsRecursive = (tasks: DisplayTask[]) => {
        tasks.forEach(task => {
          allTaskIdsSet.add(task.id);
          if (task.subtasks) getAllIdsRecursive(task.subtasks);
        });
      };
      getAllIdsRecursive(extractedTasks);
    }
    setSelectedTaskIds(allTaskIdsSet);
  };

  const areAllTasksSelected = extractedTasks.length > 0 && selectedTaskIds.size === countAllTasksRecursive(extractedTasks);


  const currentSessionTitle = getActivePlanningSession()?.title || "New Plan";
  const currentFolderId = getActivePlanningSession()?.folderId;


  const handleViewDetails = (task: DisplayTask) => {
    setTaskForDetailView(task);
    setIsTaskDetailDialogVisible(true);
  };

  const handleSaveTaskDetails = (updatedTaskFromDialog: DisplayTask, options?: { close?: boolean }) => {
    const sanitizedUpdatedTask = sanitizeTaskForInternalState(updatedTaskFromDialog);
    const updateRecursively = (nodes: DisplayTask[]): DisplayTask[] => {
      return nodes.map(node => {
        if (node.id === sanitizedUpdatedTask.id) {
          return sanitizedUpdatedTask;
        }
        if (node.subtasks) {
          const newSubtasks = updateRecursively(node.subtasks);
          if (newSubtasks !== node.subtasks) {
            return { ...node, subtasks: newSubtasks };
          }
        }
        return node;
      });
    };
    const newExtractedTasks = updateRecursively(extractedTasks);
    setExtractedTasks(newExtractedTasks);
    if (activePlanningSessionId) {
      updateActivePlanningSession({ inputText: pastedContent, extractedTasks: newExtractedTasks.map(normalizeTaskUtil) });
    }
    if (options?.close !== false) {
      setIsTaskDetailDialogVisible(false);
    }
    toast({ title: "Task Updated", description: `Details for "${sanitizedUpdatedTask.title}" saved.` });
  };

  const handleBreakDownTask = async (taskToBreakDown: DisplayTask) => {
    setIsProcessingSubtasks(true);
    setTaskForSubtaskGenerationId(taskToBreakDown.id);
    toast({ title: "AI Breaking Down Task...", description: `Generating sub-tasks for "${taskToBreakDown.title}".` });
    try {
      const input: OrchestratorInput = {
        message: `Break down the task: ${taskToBreakDown.title}. Description: ${taskToBreakDown.description || ''}`,
        requestedDetailLevel: 'detailed',
        contextTaskTitle: taskToBreakDown.title,
        contextTaskDescription: taskToBreakDown.description || undefined,
        existingTasks: extractedTasks as any,
      };
      const result = await extractTasksFromChat(input);

      let finalUpdatedTasks: DisplayTask[] = extractedTasks;

      if (result.tasks) {
        const newTasks = result.tasks.map((t: any) =>
          sanitizeTaskForInternalState(t as DisplayTask)
        );
        setExtractedTasks(newTasks);
        if (activePlanningSessionId) {
          updateActivePlanningSession({ inputText: pastedContent, extractedTasks: newTasks.map(normalizeTaskUtil) });
        }
        toast({ title: "Sub-tasks Added", description: `Sub-tasks added under "${taskToBreakDown.title}".` });
      } else {
        toast({ title: "No Sub-tasks Generated", description: `AI didn't find specific sub-tasks for "${taskToBreakDown.title}".` });
      }

    } catch (error) {
      console.error("Error breaking down task:", error);
      toast({ title: "AI Error", description: "Could not break down task.", variant: "destructive" });
    } finally {
      setIsProcessingSubtasks(false);
      setTaskForSubtaskGenerationId(null);
    }
  };

  const handleGenerateBriefsForSelectedTasks = async () => {
    if (selectedTaskIds.size === 0) {
      toast({ title: "No Tasks Selected", description: "Please select tasks to generate briefs for.", variant: "destructive" });
      return;
    }

    setIsProcessingBatchBriefs(true);
    toast({ title: "Generating Briefs...", description: `AI is preparing research briefs for ${selectedTaskIds.size} task(s).` });

    let tempExtractedTasks = JSON.parse(JSON.stringify(extractedTasks)) as DisplayTask[];

    const results: Array<{ taskId: string; brief: string | null } | null> = [];
    let limitReached = false;
    for (const taskId of selectedTaskIds) {
      const taskToUpdate = findTaskByIdRecursive(tempExtractedTasks, taskId);
      if (!taskToUpdate) {
        results.push(null);
        continue;
      }
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
        toast({ title: "Brief Generation Error", description: `Could not generate brief for "${taskToUpdate.title}".`, variant: "destructive" });
        results.push({ taskId, brief: null });
      }
    }
    let updatedTasksCount = 0;

    results.forEach(result => {
      if (result && result.brief) {
        const applyBriefToTaskInArray = (nodes: DisplayTask[], idToUpdate: string, brief: string): DisplayTask[] => {
          return nodes.map(node => {
            if (node.id === idToUpdate) {
              return sanitizeTaskForInternalState({ ...node, researchBrief: brief });
            }
            if (node.subtasks) {
              return { ...node, subtasks: applyBriefToTaskInArray(node.subtasks, idToUpdate, brief) };
            }
            return node;
          });
        };
        tempExtractedTasks = applyBriefToTaskInArray(tempExtractedTasks, result.taskId, result.brief);
        updatedTasksCount++;
      }
    });

    setExtractedTasks(tempExtractedTasks);
    if (taskForDetailView) {
      const refreshedTask = findTaskByIdRecursive(tempExtractedTasks, taskForDetailView.id);
      if (refreshedTask) {
        setTaskForDetailView(refreshedTask);
      }
    }
    if (activePlanningSessionId) {
      updateActivePlanningSession({ inputText: pastedContent, extractedTasks: tempExtractedTasks.map(normalizeTaskUtil) });
    }

    setIsProcessingBatchBriefs(false);
    if (updatedTasksCount > 0) {
      toast({ title: "Briefs Generated", description: `Research briefs generated for ${updatedTasksCount} task(s).` });
    } else if (selectedTaskIds.size > 0 && !limitReached) {
      toast({ title: "No Briefs Generated", description: "Could not generate briefs for the selected tasks.", variant: "destructive" });
    }
  };


  const openDeleteConfirmDialog = (task: DisplayTask) => {
    setTaskToDelete(task);
    setIsDeleteConfirmOpen(true);
  };

  const confirmDeleteTask = () => {
    if (!taskToDelete) return;

    let newExtractedTasks = [...extractedTasks];
    const idsToRemove = new Set<string>();

    function collectIdsToRemove(task: DisplayTask | null) {
      if (!task) return;
      idsToRemove.add(task.id);
      task.subtasks?.forEach(sub => collectIdsToRemove(sub));
    }

    const actualTaskObjectToDelete = findTaskByIdRecursive(newExtractedTasks, taskToDelete.id);
    collectIdsToRemove(actualTaskObjectToDelete);


    function filterOutRemovedTasks(nodes: DisplayTask[]): DisplayTask[] {
      return nodes.filter(node => !idsToRemove.has(node.id)).map(node => {
        if (node.subtasks) {
          const newSubtasks = filterOutRemovedTasks(node.subtasks);
          if (newSubtasks.length !== node.subtasks.length || !newSubtasks.every((sub, i) => sub.id === node.subtasks![i].id)) {
            return sanitizeTaskForInternalState({ ...node, subtasks: newSubtasks });
          }
        }
        return node;
      });
    }

    newExtractedTasks = filterOutRemovedTasks(newExtractedTasks);

    setExtractedTasks(newExtractedTasks);

    setSelectedTaskIds(prev => {
      const newSelected = new Set(prev);
      idsToRemove.forEach(id => newSelected.delete(id));
      return newSelected;
    });

    if (activePlanningSessionId) {
      updateActivePlanningSession({ inputText: pastedContent, extractedTasks: newExtractedTasks.map(normalizeTaskUtil) });
    }

    toast({ title: "Task Deleted", description: `"${taskToDelete.title}" and its subtasks have been removed.` });
    setIsDeleteConfirmOpen(false);
    setTaskToDelete(null);
  };

  const openSimplifyConfirmDialog = (task: DisplayTask) => {
    setTaskToSimplify(task);
    setIsSimplifyConfirmOpen(true);
  };

  const confirmSimplifyTask = async () => {
    if (!taskToSimplify) return;

    setIsProcessingSimplify(true);
    setTaskForSubtaskGenerationId(taskToSimplify.id);
    toast({ title: "AI Simplifying Task...", description: `Processing "${taskToSimplify.title}".` });

    const mapToAISchema = (displayTask: DisplayTask): any => {
      const { id, addedToProjectId, addedToProjectName, researchBrief, ...aiTask } = displayTask;
      return {
        ...aiTask,
        title: displayTask.title || "Untitled",
        description: displayTask.description || undefined,
        priority: displayTask.priority || 'medium',
        dueAt: displayTask.dueAt || undefined,
        subtasks: displayTask.subtasks?.map(mapToAISchema) || undefined
      };
    };

    try {
      const input: SimplifyTaskBranchInput = {
        taskToSimplify: mapToAISchema(taskToSimplify),
        requestedComplexity: 'low',
      };
      const result = await simplifyTaskBranch(input);

      let finalUpdatedTasks: DisplayTask[] = extractedTasks;

      if (result.simplifiedTask) {
        const assignUniqueIdsToSimplifiedBranch = (aiTask: any): DisplayTask =>
          sanitizeTaskForInternalState({
            ...aiTask,
            id: uuidv4(),
            researchBrief: taskToSimplify.researchBrief,
            subtasks: aiTask.subtasks?.map((sub: any) => assignUniqueIdsToSimplifiedBranch(sub)) || null
          });

        const newSimplifiedBranchRoot = assignUniqueIdsToSimplifiedBranch(result.simplifiedTask);

        const replaceTaskInTree = (nodes: DisplayTask[], taskToReplaceId: string, replacementNode: DisplayTask): DisplayTask[] => {
          return nodes.map(node => {
            if (node.id === taskToReplaceId) {
              return replacementNode;
            }
            if (node.subtasks) {
              const updatedSubtasks = replaceTaskInTree(node.subtasks, taskToReplaceId, replacementNode);
              if (updatedSubtasks !== node.subtasks) {
                return sanitizeTaskForInternalState({ ...node, subtasks: updatedSubtasks });
              }
            }
            return node;
          }).filter(node => node !== null) as DisplayTask[];
        };

        finalUpdatedTasks = replaceTaskInTree(extractedTasks, taskToSimplify.id, newSimplifiedBranchRoot);
        toast({ title: "Task Simplified", description: result.aiSummaryMessage || `"${taskToSimplify.title}" has been simplified.` });
      } else {
        toast({ title: "Simplification Failed", description: "AI did not return a simplified task.", variant: "destructive" });
      }

      setExtractedTasks(finalUpdatedTasks);
      if (activePlanningSessionId) {
        updateActivePlanningSession({ inputText: pastedContent, extractedTasks: finalUpdatedTasks.map(normalizeTaskUtil) });
      }

      setSelectedTaskIds(prev => {
        const newSet = new Set(prev);
        if (prev.has(taskToSimplify.id)) {
          newSet.delete(taskToSimplify.id);
        }
        return newSet;
      });

    } catch (error) {
      console.error("Error simplifying task:", error);
      toast({ title: "AI Error", description: "Could not simplify task.", variant: "destructive" });
    } finally {
      setIsProcessingSimplify(false);
      setTaskForSubtaskGenerationId(null);
      setIsSimplifyConfirmOpen(false);
      setTaskToSimplify(null);
    }
  };

  const handleOpenSetDueDateDialog = () => {
    if (selectedTaskIds.size === 0) {
      toast({ title: "No Tasks Selected", description: "Please select tasks to set a due date.", variant: "destructive" });
      return;
    }
    setIsSetDueDateDialogOpen(true);
  };

  const confirmBulkDelete = () => {
    let newExtractedTasks = [...extractedTasks];
    const idsToRemove = new Set(selectedTaskIds);

    function filterOutRemovedTasks(nodes: DisplayTask[]): DisplayTask[] {
      return nodes
        .filter(node => !idsToRemove.has(node.id))
        .map(node => {
          if (node.subtasks) {
            return { ...node, subtasks: filterOutRemovedTasks(node.subtasks) };
          }
          return node;
        });
    }

    newExtractedTasks = filterOutRemovedTasks(newExtractedTasks);

    setExtractedTasks(newExtractedTasks);
    if (activePlanningSessionId) {
      updateActivePlanningSession({ extractedTasks: newExtractedTasks.map(normalizeTaskUtil) });
    }

    toast({ title: `${selectedTaskIds.size} Tasks Deleted` });
    setSelectedTaskIds(new Set());
    setIsDeleteConfirmOpen(false);
  };


  const handleConfirmSetDueDate = (date: Date | undefined) => {
    const newDueDateISO = date ? date.toISOString() : null;

    const updateDueDatesRecursively = (nodes: DisplayTask[], idsToUpdate: Set<string>): DisplayTask[] => {
      return nodes.map(node => {
        let updatedNode = { ...node };
        let shouldUpdateChildren = false;

        if (idsToUpdate.has(node.id)) {
          updatedNode.dueAt = newDueDateISO;
          shouldUpdateChildren = true;
        }

        if (node.subtasks) {

          if (shouldUpdateChildren) {
            const updateAllDescendants = (childNodes: DisplayTask[]): DisplayTask[] =>
              childNodes.map(child => sanitizeTaskForInternalState({
                ...child,
                dueAt: newDueDateISO,
                subtasks: child.subtasks ? updateAllDescendants(child.subtasks) : null
              }));
            updatedNode.subtasks = updateAllDescendants(node.subtasks);
          } else {

            updatedNode.subtasks = updateDueDatesRecursively(node.subtasks, idsToUpdate);
          }
        }
        return sanitizeTaskForInternalState(updatedNode);
      });
    };

    const newExtractedTasks = updateDueDatesRecursively(extractedTasks, selectedTaskIds);
    setExtractedTasks(newExtractedTasks);
    if (activePlanningSessionId) {
      updateActivePlanningSession({ inputText: pastedContent, extractedTasks: newExtractedTasks.map(normalizeTaskUtil) });
    }
    toast({ title: "Due Dates Updated", description: `Due dates set for selected task(s) and their subtasks.` });
    setIsSetDueDateDialogOpen(false);
  };

  // Title Editing Handlers
  const handleEditTitleClick = () => {
    if (activePlanningSessionId) {
      setEditableTitle(getActivePlanningSession()?.title || "New Plan");
      setIsEditingTitle(true);
    }
  };

  const handleSavePlanTitle = async () => {
    if (!activePlanningSessionId || !editableTitle.trim()) {
      toast({ title: "Invalid Title", description: "Plan title cannot be empty.", variant: "destructive" });
      // Optionally revert editableTitle to currentSessionTitle or keep it for further editing
      setEditableTitle(getActivePlanningSession()?.title || "New Plan"); // Revert
      return;
    }
    if (editableTitle.trim() === getActivePlanningSession()?.title) {
      setIsEditingTitle(false); // No change, just exit editing mode
      return;
    }
    try {
      await updatePlanningSessionTitle(activePlanningSessionId, editableTitle.trim());
      toast({ title: "Plan Renamed", description: `Plan successfully renamed to "${editableTitle.trim()}".` });
      setIsEditingTitle(false);
    } catch (error) {
      console.error("Error renaming plan:", error);
      toast({ title: "Error", description: "Could not rename the plan.", variant: "destructive" });
    }
  };

  const handleCancelEditTitle = () => {
    setEditableTitle(getActivePlanningSession()?.title || "New Plan");
    setIsEditingTitle(false);
  };

  const handleMoveToFolder = (folderId: string | null) => {
    if (!activePlanningSessionId) return;
    updatePlanningSession(activePlanningSessionId, { folderId });
    toast({ title: 'Plan Moved', description: `Plan has been moved successfully.` });
  };

  const handleSavePastedContent = () => {
    setPastedContent(editedPastedContent);
    if (activePlanningSessionId) {
      updateActivePlanningSession({ inputText: editedPastedContent });
    }
    setIsFullTextViewerOpen(false);
    toast({ title: "Content Updated", description: "The attached content has been saved." });
  };

  const handleClearPastedContent = () => {
    setPastedContent('');
    if (activePlanningSessionId) {
      updateActivePlanningSession({ inputText: '' });
    }
    toast({ title: "Content Cleared" });
  };

  const handleOpenAssignPersonDialog = (task: DisplayTask | null = null) => {
    if (task) {
      setTaskToAssign(task);
    } else if (selectedTaskIds.size > 0) {
      setTaskToAssign(null);
    } else {
      toast({ title: "No task selected", description: "Select a task or use the dropdown to assign.", variant: "destructive" });
      return;
    }
    setIsAssignPersonDialogOpen(true);
  };

  const handleConfirmAssignPerson = (person: Person) => {
    if (!user) return;
    const assigneeInfo = { uid: person.id, name: person.name, email: person.email, photoURL: person.avatarUrl };

    let idsToUpdate: Set<string>;
    let toastTitle: string;
    let toastDescription: string;

    if (taskToAssign) {
      idsToUpdate = getTaskAndAllDescendantIds(taskToAssign);
      toastTitle = "Task Assigned";
      toastDescription = `"${taskToAssign.title}" and its subtasks assigned to ${person.name}.`;
    } else {
      idsToUpdate = new Set();
      selectedTaskIds.forEach(id => {
        const task = findTaskByIdRecursive(extractedTasks, id);
        if (task) {
          getTaskAndAllDescendantIds(task).forEach(descId => idsToUpdate.add(descId));
        }
      });
      toastTitle = "Tasks Assigned";
      toastDescription = `${selectedTaskIds.size} task branch(es) assigned to ${person.name}.`;
    }

    const updateAssigneeRecursively = (nodes: DisplayTask[]): DisplayTask[] => {
      return nodes.map(node => {
        let newNode = { ...node };
        if (idsToUpdate.has(node.id)) {
          newNode.assignee = assigneeInfo;
        }
        if (node.subtasks) {
          newNode.subtasks = updateAssigneeRecursively(node.subtasks);
        }
        return sanitizeTaskForInternalState(newNode);
      });
    };

    const newExtractedTasks = updateAssigneeRecursively(extractedTasks);

    setExtractedTasks(newExtractedTasks);
    if (activePlanningSessionId) {
      updateActivePlanningSession({ extractedTasks: newExtractedTasks.map(normalizeTaskUtil) });
    }
    toast({ title: toastTitle, description: toastDescription });
    setIsAssignPersonDialogOpen(false);
    setTaskToAssign(null);
    setSelectedTaskIds(new Set());
  };

  const handleCreatePerson = async (name: string): Promise<string | undefined> => {
    if (!user) return;
    try {
      const newPersonId = await addPerson(user.uid, { name }, activePlanningSessionId || 'planning-manual-add');
      toast({ title: "Person Added", description: `${name} has been added to your people directory.` });
      return newPersonId;
    } catch (e) {
      toast({ title: "Error", description: "Could not create new person.", variant: "destructive" });
    }
    return undefined;
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

  const handleExport = (format: 'csv' | 'md' | 'pdf') => {
    if (selectedTaskIds.size === 0) {
      toast({ title: "No tasks selected", description: "Please select tasks to export.", variant: "destructive" });
      return;
    }
    const tasksToExport = getSelectedTasks();
    const filename = `${currentSessionTitle.replace(/\s+/g, '_')}_export`;

    if (format === 'csv') {
      exportTasksToCSV(tasksToExport, `${filename}.csv`);
    } else if (format === 'md') {
      exportTasksToMarkdown(tasksToExport, `${filename}.md`);
    } else if (format === 'pdf') {
      exportTasksToPDF(tasksToExport, currentSessionTitle);
    }
  };

  const getSelectedTasksForIntegrations = (): DisplayTask[] => {
    const getSelected = (tasks: DisplayTask[]): DisplayTask[] => {
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
      }, [] as DisplayTask[]);
    };
    return getSelected(extractedTasks);
  };

  const handleShareToSlack = () => {
    if (selectedTaskIds.size === 0) {
      toast({ title: "No tasks selected", description: "Please select one or more tasks to share.", variant: "destructive" });
      return;
    }
    setIsShareToSlackOpen(true);
  }

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

  const anyProcessing = isGeneratingInitialPlan || isProcessingSubtasks || isProcessingBatchBriefs || isProcessingSimplify;

  const handleDetailLevelChange = (level: DetailLevel) => {
    setCurrentDetailLevel(level);
    if (user?.taskGranularityPreference !== level) {
      updateUserProfile({ taskGranularityPreference: level }, true).catch((error) => {
        console.error("Failed to save task granularity preference:", error);
      });
    }
  };

  const headerTitle = (
    <div className="flex items-center gap-2 flex-grow min-w-0">
      {isEditingTitle && activePlanningSessionId ? (
        <Input type="text" value={editableTitle} onChange={(e) => setEditableTitle(e.target.value)} onBlur={handleSavePlanTitle} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleSavePlanTitle(); } if (e.key === 'Escape') handleCancelEditTitle(); }} className="text-xl font-semibold font-headline h-9 flex-grow" autoFocus />
      ) : (
        <h2 className="text-xl font-semibold font-headline truncate cursor-pointer hover:text-primary/80 flex-grow" onClick={activePlanningSessionId ? handleEditTitleClick : undefined} title={currentSessionTitle}>
          {truncateTitle(currentSessionTitle, 40)}
        </h2>
      )}
      {!isEditingTitle && activePlanningSessionId && (<Button variant="ghost" size="icon" onClick={handleEditTitleClick} className="h-8 w-8 flex-shrink-0"><Edit2 size={16} /></Button>)}
    </div>
  );

  return (
    <>
      <div className="flex flex-col h-full bg-background">
        <DashboardHeader pageIcon={Brain} pageTitle={headerTitle}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" disabled={!activePlanningSessionId} className="gem-button bg-background">
                <ListFilter className="mr-2 h-4 w-4" /> <span>{currentDetailLevel.charAt(0).toUpperCase() + currentDetailLevel.slice(1)}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuRadioGroup value={currentDetailLevel} onValueChange={(v) => handleDetailLevelChange(v as DetailLevel)}>
                <DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="medium">Medium</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="detailed">Detailed</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" disabled={!activePlanningSessionId} className="gem-button bg-background">
                <FolderIcon className="mr-2 h-4 w-4" /> Move to...
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {renderFolderMenuItems(folderStructure)}
              {folders.length > 0 && <DropdownMenuSeparator />}
              <DropdownMenuItem onClick={() => handleMoveToFolder(null)} disabled={!currentFolderId}><FolderOpen className="mr-2 h-4 w-4" /> Move to Root</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button onClick={handleNewPlan} variant="outline" size="sm" disabled={anyProcessing} className="gem-button bg-background">
            <PlusCircle className="mr-2 h-4 w-4" /> New Plan
          </Button>
          {(activePlanningSessionId && extractedTasks.length > 0 && !isInputAreaVisible) && (
            <Button onClick={() => setIsInputAreaVisible(true)} variant="outline" size="sm" disabled={anyProcessing} className="gem-button bg-background">
              <Edit2 className="mr-2 h-4 w-4" /> Edit Input
            </Button>
          )}
        </DashboardHeader>

        <div className="flex-grow flex flex-col p-4 space-y-4 overflow-hidden">
          {isInputAreaVisible && (
            <div className="space-y-3">
              <Alert className="border-primary/30 bg-primary/5">
                <Sparkles className="h-4 w-4" />
                <AlertTitle>Turn Ideas into Action Plans</AlertTitle>
                <AlertDescription>
                  Paste rough notes, meeting transcripts, or project briefs below. AI will structure them into a prioritize plan. Pro tip: Press <kbd className="px-1.5 py-0.5 border rounded bg-muted font-mono text-xs">Ctrl+V</kbd> anywhere to start.
                </AlertDescription>
              </Alert>

              {pastedContent && (
                <div className="relative rounded-md border bg-muted/50 p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2"><ClipboardPaste className="h-5 w-5 text-muted-foreground" /><div className="font-semibold">Pasted Content</div><Badge variant="secondary">{pastedContent.length.toLocaleString()} chars</Badge></div>
                    <div className="flex items-center gap-1">
                      <Button size="xs" variant="ghost" className="h-7" onClick={() => { setEditedPastedContent(pastedContent); setIsFullTextViewerOpen(true); setIsEditingPastedContent(true); }}>Edit</Button>
                      <Button size="xs" variant="ghost" className="h-7" onClick={() => { setEditedPastedContent(pastedContent); setIsFullTextViewerOpen(true); setIsEditingPastedContent(false); }}>View</Button>
                      <Button size="xs" variant="ghost" className="h-7 text-destructive hover:text-destructive" onClick={handleClearPastedContent}><ClearIcon className="mr-1.5 h-3 w-3" />Clear</Button>
                    </div>
                  </div>
                </div>
              )}

              <div className="animated-gradient-border-wrapper">
                <Textarea
                  placeholder={pastedContent ? "Now, add instructions for the AI..." : "Paste content here, or type a request..."}
                  value={typedInput}
                  onChange={(e) => setTypedInput(e.target.value)}
                  onPaste={(e) => {
                    const paste = e.clipboardData.getData('text');
                    setPastedContent(prev => prev ? `${prev}\n\n${paste}` : paste);
                    e.preventDefault();
                  }}
                  rows={4}
                  className="resize-none bg-background"
                  disabled={anyProcessing}
                />
              </div>
              <div className="flex gap-2 items-center">
                <Button onClick={handleGeneratePlan} disabled={anyProcessing || (!pastedContent.trim() && !typedInput.trim())} className="bg-primary hover:bg-primary/90 text-primary-foreground">
                  {isGeneratingInitialPlan ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                  {activePlanningSessionId && extractedTasks.length > 0 ? "Update Plan" : "Generate Plan"}
                </Button>
                {(activePlanningSessionId && extractedTasks.length > 0 && !isGeneratingInitialPlan && isInputAreaVisible) && (
                  <Button variant="outline" onClick={() => setIsInputAreaVisible(false)} disabled={anyProcessing}>
                    <X className="mr-2 h-4 w-4" /> Cancel Edit
                  </Button>
                )}
              </div>
            </div >
          )}

          <div className={cn("flex-grow flex flex-col min-h-0", isInputAreaVisible ? 'hidden' : 'flex')}>
            {isGeneratingInitialPlan ? (
              <div className="flex flex-col items-center justify-center text-muted-foreground p-10 flex-1">
                <Loader2 size={48} className="animate-spin mb-4 text-primary" />
                <p className="text-lg font-medium">AI is crafting your plan...</p>
              </div>
            ) : extractedTasks.length > 0 ? (
              <ResizablePanelGroup
                direction="horizontal"
                className="flex-1 flex min-h-0"
              >
                <ResizablePanel defaultSize={50} minSize={30} className="flex flex-col min-h-0">
                  <div className="p-4 border-b border-border">
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="select-all-plan-tasks"
                        checked={areAllTasksSelected}
                        onCheckedChange={(checked) => handleSelectAllTasks(Boolean(checked))}
                        aria-label="Select all tasks in the plan"
                        disabled={anyProcessing}
                      />
                      <Label htmlFor="select-all-plan-tasks" className="text-sm font-medium">
                        {areAllTasksSelected ? "Deselect All" : "Select All"} ({countAllTasksRecursive(extractedTasks)})
                      </Label>
                    </div>
                  </div>
                  <ScrollArea className="flex-1">
                    <div className="p-4">
                      {extractedTasks.map(task => (
                        <HierarchicalTaskItem
                          key={task.id}
                          task={task}
                          isSelected={selectedTaskIds.has(task.id)}
                          isIndeterminate={getTaskCheckboxState(task, selectedTaskIds, extractedTasks) === 'indeterminate'}
                          onToggleSelection={handleToggleSelection}
                          currentSelectedIds={selectedTaskIds}
                          allDisplayTasks={extractedTasks}
                          onBreakDown={handleBreakDownTask}
                          onViewDetails={handleViewDetails}
                          onDeleteTask={openDeleteConfirmDialog}
                          onSimplifyTask={openSimplifyConfirmDialog}
                          onAssignPerson={handleOpenAssignPersonDialog}
                          getCheckboxState={getTaskCheckboxState}
                          isProcessingSubtasksGlobal={isProcessingSubtasks || isProcessingSimplify}
                          taskForSubtaskGenerationId={taskForSubtaskGenerationId}
                        />
                      ))}
                    </div>
                  </ScrollArea>
                </ResizablePanel>
                <ResizableHandle withHandle />
                <ResizablePanel defaultSize={50} minSize={30} className="flex flex-col min-h-0">
                  <div className="p-4 border-b border-border">
                    <h3 className="text-md font-semibold flex items-center"><Brain className="mr-2 h-5 w-5 text-muted-foreground" /> Mind Map View</h3>
                  </div>
                  <ScrollArea className="flex-1">
                    <div className="p-4">
                      <MindMapDisplay
                        tasks={extractedTasks}
                        onBreakDown={handleBreakDownTask}
                        onViewDetails={handleViewDetails}
                        onDeleteTask={openDeleteConfirmDialog}
                        onSimplifyTask={openSimplifyConfirmDialog}
                        isProcessingSubtasksGlobal={isProcessingSubtasks || isProcessingSimplify}
                        taskForSubtaskGenerationId={taskForSubtaskGenerationId}
                      />
                    </div>
                  </ScrollArea>
                </ResizablePanel>
              </ResizablePanelGroup>
            ) : (
              <div className="flex flex-col items-center justify-center text-muted-foreground p-10 flex-1">
                <ListTree size={48} className="opacity-50 mb-4" />
                <p className="text-lg font-medium">No tasks extracted for this plan.</p>
                <p className="text-sm">Try generating or updating the plan with more specific input, or edit the input above.</p>
              </div>
            )}
          </div>
        </div >
      </div >

      <SelectionToolbar
        selectedCount={selectedTaskIds.size}
        onClear={() => setSelectedTaskIds(new Set())}
        onAssign={() => handleOpenAssignPersonDialog(null)}
        onSetDueDate={handleOpenSetDueDateDialog}
        onDelete={() => {
          setTaskToDelete(null); // Indicate bulk delete
          setIsDeleteConfirmOpen(true);
        }}
        onCopy={handleCopySelected}
        onSend={handleExport}
        onGenerateBriefs={handleGenerateBriefsForSelectedTasks}
        onShareToSlack={handleShareToSlack}
        isSlackConnected={isSlackConnected}
        onPushToGoogleTasks={handlePushToGoogleTasks}
        isGoogleTasksConnected={isGoogleTasksConnected}
        onPushToTrello={handlePushToTrello}
        isTrelloConnected={isTrelloConnected}
      />

      <TaskDetailDialog
        isOpen={isTaskDetailDialogVisible}
        onClose={() => setIsTaskDetailDialogVisible(false)}
        task={taskForDetailView}
        onSave={handleSaveTaskDetails}
        people={people}
        shareTitle={editableTitle || "Planning"}
      />

      <AlertDialog open={isDeleteConfirmOpen} onOpenChange={setIsDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Deletion</AlertDialogTitle>
            <AlertDialogDescription>
              {taskToDelete
                ? `Are you sure you want to delete the task "${taskToDelete.title}" and all its subtasks?`
                : `Are you sure you want to delete the ${selectedTaskIds.size} selected tasks and all their subtasks?`
              } This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setTaskToDelete(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={taskToDelete ? confirmDeleteTask : confirmBulkDelete} className="bg-destructive hover:bg-destructive/90 text-destructive-foreground">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={isSimplifyConfirmOpen} onOpenChange={setIsSimplifyConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center"><AlertTriangle className="mr-2 h-5 w-5 text-yellow-500" />Confirm AI Simplification</AlertDialogTitle>
            <AlertDialogDescription>
              Simplifying the task "{taskToSimplify?.title}" will use AI to restructure it and its subtasks. This may consume AI credits. Proceed?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setTaskToSimplify(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmSimplifyTask} disabled={isProcessingSimplify} className="bg-primary hover:bg-primary/80">
              {isProcessingSimplify ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Proceed with Simplification
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <SetDueDateDialog
        isOpen={isSetDueDateDialogOpen}
        onClose={() => setIsSetDueDateDialogOpen(false)}
        onConfirm={handleConfirmSetDueDate}
      />

      <Dialog open={isFullTextViewerOpen} onOpenChange={setIsFullTextViewerOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>
              {isEditingPastedContent ? "Edit Attached Content" : "View Attached Content"}
            </DialogTitle>
            <DialogDescription>
              {isEditingPastedContent ? "Modify the pasted content below. This will update the attached content for your plan." : "Review the attached content for your plan."}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={editedPastedContent}
            onChange={(e) => setEditedPastedContent(e.target.value)}
            rows={12}
            className="resize-none bg-background"
            readOnly={!isEditingPastedContent}
          />
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setIsFullTextViewerOpen(false)}>
              Cancel
            </Button>
            {isEditingPastedContent && (
              <Button type="button" onClick={handleSavePastedContent}>
                Save Changes
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AssignPersonDialog
        isOpen={isAssignPersonDialogOpen}
        onClose={() => setIsAssignPersonDialogOpen(false)}
        people={people}
        isLoadingPeople={isLoadingPeople}
        onAssign={handleConfirmAssignPerson}
        onCreatePerson={handleCreatePerson}
        task={taskToAssign}
        selectedTaskIds={selectedTaskIds}
      />
      <ShareToSlackDialog
        isOpen={isShareToSlackOpen}
        onClose={() => setIsShareToSlackOpen(false)}
        tasks={getSelectedTasksForIntegrations()}
        sessionTitle={currentSessionTitle}
      />
      <PushToGoogleTasksDialog
        isOpen={isPushToGoogleOpen}
        onClose={() => setIsPushToGoogleOpen(false)}
        tasks={getSelectedTasksForIntegrations()}
      />
      <PushToTrelloDialog
        isOpen={isPushToTrelloOpen}
        onClose={() => setIsPushToTrelloOpen(false)}
        tasks={getSelectedTasksForIntegrations()}
      />
    </>
  );
}


