// src/components/dashboard/explore/ExplorePageContent.tsx
"use client";

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { startOfWeek, endOfWeek, eachDayOfInterval, format, isSameDay, addWeeks, subWeeks, isToday, getDay } from 'date-fns';
import { useMeetingHistory } from '@/contexts/MeetingHistoryContext';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2, Calendar, ChevronLeft, ChevronRight, ListFilter, Users, Video } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem } from '@/components/ui/dropdown-menu';
import DashboardHeader from '../DashboardHeader';
import DayColumn from './DayColumn';
import type { ExtractedTaskSchema } from '@/types/chat';
import type { Meeting } from '@/types/meeting';
import SelectionToolbar from '../common/SelectionToolbar';
import { cn } from '@/lib/utils';
import type { DayData, CalendarEvent } from './types';
import { useToast } from "@/hooks/use-toast";
import TaskDetailDialog from '@/components/dashboard/planning/TaskDetailDialog';
import { useIsMobile } from '@/hooks/use-mobile';
import SelectionViewDialog from './SelectionViewDialog';
import { useUIState } from '@/contexts/UIStateContext';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import ShareToSlackDialog from '../common/ShareToSlackDialog';
import PushToGoogleTasksDialog from '../common/PushToGoogleTasksDialog';
import PushToTrelloDialog from '../common/PushToTrelloDialog';
import { useIntegrations } from '@/contexts/IntegrationsContext';
import { exportTasksToCSV, exportTasksToMarkdown, exportTasksToPDF, copyTextToClipboard, formatTasksToText } from '@/lib/exportUtils';
import AssignPersonDialog from '../planning/AssignPersonDialog';
import { onPeopleSnapshot, addPerson } from '@/lib/data';
import type { Person } from '@/types/person';
import SetDueDateDialog from '../planning/SetDueDateDialog';
import { useWorkspaceBoards } from "@/hooks/use-workspace-boards";
import { moveTaskToBoard } from "@/lib/board-actions";
import { buildBriefContext } from "@/lib/brief-context";


const getTaskAndAllDescendantIds = (task: ExtractedTaskSchema): string[] => {
  const ids = [task.id];
  if (task.subtasks) {
    task.subtasks.forEach(sub => ids.push(...getTaskAndAllDescendantIds(sub)));
  }
  return ids;
};

type ContentFilter = 'all' | 'with_tasks' | 'with_people';

export default function ExplorePageContent() {
  const { user } = useAuth();
  const workspaceId = user?.workspace?.id;
  const { boards } = useWorkspaceBoards(workspaceId);
  const { meetings: allMeetings, isLoadingMeetingHistory, updateMeeting } = useMeetingHistory();
  const { isSlackConnected, isGoogleTasksConnected, isTrelloConnected } = useIntegrations();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [contentFilter, setContentFilter] = useState<ContentFilter>('all');
  const [activeDayIndex, setActiveDayIndex] = useState<number | null>(null);

  const [isTaskDetailDialogVisible, setIsTaskDetailDialogVisible] = useState(false);
  const [isSelectionViewVisible, setIsSelectionViewVisible] = useState(false);
  const [taskForDetailView, setTaskForDetailView] = useState<ExtractedTaskSchema | null>(null);
  const [isShareToSlackOpen, setIsShareToSlackOpen] = useState(false);
  const [isPushToGoogleOpen, setIsPushToGoogleOpen] = useState(false);
  const [isPushToTrelloOpen, setIsPushToTrelloOpen] = useState(false);
  const [people, setPeople] = useState<Person[]>([]);
  const [isLoadingPeople, setIsLoadingPeople] = useState(true);
  const [isAssignDialogOpen, setIsAssignDialogOpen] = useState(false);
  const [isSetDueDateDialogOpen, setIsSetDueDateDialogOpen] = useState(false);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [isLoadingCalendarEvents, setIsLoadingCalendarEvents] = useState(false);


  const { toast } = useToast();
  const isMobile = useIsMobile();
  const { showWeekends, setShowWeekends } = useUIState();

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
    const fetchCalendarEvents = async () => {
      if (!isGoogleTasksConnected) {
        setCalendarEvents([]);
        return;
      }
      setIsLoadingCalendarEvents(true);
      try {
        const start = startOfWeek(currentDate, { weekStartsOn: 1 });
        const end = endOfWeek(currentDate, { weekStartsOn: 1 });
        const response = await fetch(
          `/api/google/calendar/upcoming?start=${start.toISOString()}&end=${end.toISOString()}`
        );
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload.error || "Failed to fetch calendar events.");
        }
        const data = await response.json();
        setCalendarEvents(data.events || []);
      } catch (error: any) {
        console.error("Failed to load Google Calendar events:", error);
        toast({
          title: "Google Calendar Sync Failed",
          description: error.message || "Could not load upcoming meetings.",
          variant: "destructive",
        });
        setCalendarEvents([]);
      } finally {
        setIsLoadingCalendarEvents(false);
      }
    };

    fetchCalendarEvents();
  }, [currentDate, isGoogleTasksConnected, toast]);

  const weekData: DayData[] = useMemo(() => {
    if (!allMeetings) return [];
    
    const start = startOfWeek(currentDate, { weekStartsOn: 1 }); // Monday start
    const end = endOfWeek(currentDate, { weekStartsOn: 1 });
    let weekDays = eachDayOfInterval({ start, end });

    if (!showWeekends) {
        weekDays = weekDays.filter(day => {
            const dayOfWeek = getDay(day);
            return dayOfWeek !== 0 && dayOfWeek !== 6; // 0 = Sunday, 6 = Saturday
        });
    }

    return weekDays.map(day => {
      const meetingsForDay = allMeetings.filter(meeting => {
        const toDateValue = (value: any) =>
          value?.toDate ? value.toDate() : value ? new Date(value) : null;
        const meetingDate = meeting.startTime ? toDateValue(meeting.startTime) : toDateValue(meeting.createdAt);
        
        if (!meetingDate || !isSameDay(meetingDate, day)) {
            return false;
        }

        if (contentFilter === 'with_tasks') {
            return meeting.extractedTasks && meeting.extractedTasks.length > 0;
        }
        if (contentFilter === 'with_people') {
            return meeting.attendees && meeting.attendees.length > 0;
        }
        
        return true;
      });

      const eventsForDay = calendarEvents.filter((event: any) => {
        const eventDate = event.startTime ? new Date(event.startTime) : null;
        return eventDate ? isSameDay(eventDate, day) : false;
      });

      return {
        date: day,
        meetings: meetingsForDay.sort((a: any, b: any) => {
          const timeValue = (value: any) =>
            value?.toMillis ? value.toMillis() : value ? new Date(value).getTime() : 0;
          return timeValue(b.lastActivityAt) - timeValue(a.lastActivityAt);
        }),
        calendarEvents: eventsForDay,
        meetingCount: meetingsForDay.length + eventsForDay.length,
        isEmpty: meetingsForDay.length === 0 && eventsForDay.length === 0,
      };
    });

  }, [allMeetings, currentDate, contentFilter, showWeekends, calendarEvents]);

  const handleWeekChange = (direction: 'next' | 'prev') => {
      setCurrentDate(prev => direction === 'next' ? addWeeks(prev, 1) : subWeeks(prev, 1));
  }

  const handleToggleTaskSelection = useCallback((taskId: string, isSelected: boolean) => {
    // This logic might need adjustment if tasks are to be selected across different meetings
    setSelectedTaskIds(prev => {
      const newSet = new Set(prev);
      if (isSelected) {
        newSet.add(taskId);
      } else {
        newSet.delete(taskId);
      }
      return newSet;
    });
  }, []);

  const handleToggleSessionSelection = useCallback((meeting: Meeting, isSelected: boolean) => {
    setSelectedTaskIds(prev => {
      const newSet = new Set(prev);
      const allTaskIdsInMeeting = ((meeting.extractedTasks || []) as any[]).flatMap(
        (task: any) => getTaskAndAllDescendantIds(task as ExtractedTaskSchema)
      );
      if (isSelected) {
        allTaskIdsInMeeting.forEach(id => newSet.add(id));
      } else {
        allTaskIdsInMeeting.forEach(id => newSet.delete(id));
      }
      return newSet;
    });
  }, []);

  const handleToggleDaySelection = useCallback((day: DayData, isSelected: boolean) => {
    setSelectedTaskIds(prev => {
        const newSet = new Set(prev);
        const allTaskIdsInDay = day.meetings.flatMap((meeting) =>
          ((meeting.extractedTasks || []) as any[]).flatMap((task: any) =>
            getTaskAndAllDescendantIds(task as ExtractedTaskSchema)
          )
        );
        if (isSelected) {
            allTaskIdsInDay.forEach(id => newSet.add(id));
        } else {
            allTaskIdsInDay.forEach(id => newSet.delete(id));
        }
        return newSet;
    });
  }, []);

  const handleViewDetails = (task: ExtractedTaskSchema, meeting: Meeting) => {
    setTaskForDetailView({ ...task, sourceSessionId: meeting.id });
    setIsTaskDetailDialogVisible(true);
  };
  
  const handleSaveTaskDetails = (updatedTask: ExtractedTaskSchema, options?: { close?: boolean }) => {
        const { sourceSessionId, ...taskToSave } = updatedTask;
        if (!sourceSessionId) {
          toast({ title: "Save Error", description: "Cannot save task without a meeting reference.", variant: "destructive" });
          return;
      }
  
      const meetingToUpdate = allMeetings.find(m => m.id === sourceSessionId);
      if (!meetingToUpdate) return;
  
      const updateRecursively = (tasks: ExtractedTaskSchema[]): ExtractedTaskSchema[] => {
        return tasks.map(t => {
          if (t.id === taskToSave.id) return taskToSave;
          if (t.subtasks) return { ...t, subtasks: updateRecursively(t.subtasks) };
          return t;
        });
      };
        
        const updatedTasks = updateRecursively(
          (meetingToUpdate.extractedTasks || []) as ExtractedTaskSchema[]
        );
        updateMeeting(sourceSessionId, { extractedTasks: updatedTasks });
          if (options?.close !== false) {
            setIsTaskDetailDialogVisible(false);
            setTaskForDetailView(null);
          }
      toast({ title: "Task Updated", description: "Your changes have been saved." });
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
      buildBriefContext(task, allMeetings, people),
    [allMeetings, people]
  );
  
  const selectedTasks = useMemo(() => {
    const tasks: ExtractedTaskSchema[] = [];
    const addedIds = new Set<string>();

    allMeetings.forEach(meeting => {
        const findSelected = (task: ExtractedTaskSchema) => {
            if(selectedTaskIds.has(task.id) && !addedIds.has(task.id)) {
                tasks.push({ ...task, sourceSessionId: meeting.id, sourceSessionName: meeting.title }); 
                addedIds.add(task.id);
            }
            if (task.subtasks) {
                task.subtasks.forEach(findSelected);
            }
        };
        ((meeting.extractedTasks || []) as any[]).forEach((task: any) =>
          findSelected(task as ExtractedTaskSchema)
        );
    });
    
    return tasks;
  }, [selectedTaskIds, allMeetings]);

  const handleExport = (exportFormat: 'csv' | 'md' | 'pdf') => {
    if (selectedTasks.length === 0) return toast({ title: "No tasks selected", variant: "destructive" });
    const filename = `Taskwise_Export_${format(new Date(), 'yyyy-MM-dd')}`;
    if (exportFormat === 'csv') exportTasksToCSV(selectedTasks, `${filename}.csv`);
    if (exportFormat === 'md') exportTasksToMarkdown(selectedTasks, `${filename}.md`);
    if (exportFormat === 'pdf') exportTasksToPDF(selectedTasks, "Selected Tasks Export");
    toast({ title: `Exported to ${exportFormat.toUpperCase()}` });
  };

  const handleCopySelected = async () => {
    if (selectedTasks.length === 0) return toast({ title: "No tasks selected", variant: "destructive" });
    const text = formatTasksToText(selectedTasks);
    await copyTextToClipboard(text);
    toast({ title: "Copied tasks to clipboard!" });
  };

  const handleConfirmAssignPerson = (person: Person) => {
    // Logic to update tasks in their respective meetings
    toast({ title: 'Assigning Tasks...', description: `Assigning ${selectedTaskIds.size} tasks to ${person.name}` });
    const tasksToUpdateByMeeting: { [meetingId: string]: ExtractedTaskSchema[] } = {};

    selectedTasks.forEach(task => {
        const meetingId = task.sourceSessionId;
        if (meetingId) {
            if (!tasksToUpdateByMeeting[meetingId]) {
                const meeting = allMeetings.find(m => m.id === meetingId);
                tasksToUpdateByMeeting[meetingId] = [
                  ...((meeting?.extractedTasks || []) as ExtractedTaskSchema[]),
                ];
            }
        }
    });

    Object.keys(tasksToUpdateByMeeting).forEach(meetingId => {
        const updateRecursively = (tasks: ExtractedTaskSchema[]): ExtractedTaskSchema[] => {
            return tasks.map(t => {
                if (selectedTaskIds.has(t.id)) {
                    return { ...t, assignee: person, assigneeName: person.name };
                }
                if (t.subtasks) {
                    return { ...t, subtasks: updateRecursively(t.subtasks) };
                }
                return t;
            });
        };
        const updatedTasks = updateRecursively(tasksToUpdateByMeeting[meetingId]);
        updateMeeting(meetingId, { extractedTasks: updatedTasks });
    });
    
    toast({ title: 'Tasks Assigned', description: `${selectedTaskIds.size} tasks assigned to ${person.name}` });
    setIsAssignDialogOpen(false);
    setSelectedTaskIds(new Set());
  };
  
    const handleCreatePerson = async (name: string): Promise<string | undefined> => {
        if (!user) return;
        try {
            const newPersonId = await addPerson(user.uid, { name }, 'explore-manual-add');
            toast({ title: "Person Added", description: `${name} has been added to your people directory.` });
            return newPersonId;
        } catch (e) {
            toast({ title: "Error", description: "Could not create new person.", variant: "destructive" });
        }
        return undefined;
    };
    
    const handleConfirmSetDueDate = (date: Date | undefined) => {
        const newDueDateISO = date ? date.toISOString() : null;
        toast({ title: 'Updating Due Dates...', description: `Setting due date for ${selectedTaskIds.size} tasks` });

        const tasksToUpdateByMeeting: { [meetingId: string]: ExtractedTaskSchema[] } = {};

        selectedTasks.forEach(task => {
            const meetingId = task.sourceSessionId;
            if (meetingId) {
                if (!tasksToUpdateByMeeting[meetingId]) {
                    const meeting = allMeetings.find(m => m.id === meetingId);
                    tasksToUpdateByMeeting[meetingId] = [
                      ...((meeting?.extractedTasks || []) as ExtractedTaskSchema[]),
                    ];
                }
            }
        });

        Object.keys(tasksToUpdateByMeeting).forEach(meetingId => {
            const updateRecursively = (tasks: ExtractedTaskSchema[]): ExtractedTaskSchema[] => {
                return tasks.map(t => {
                    if (selectedTaskIds.has(t.id)) {
                        return { ...t, dueAt: newDueDateISO };
                    }
                    if (t.subtasks) {
                        return { ...t, subtasks: updateRecursively(t.subtasks) };
                    }
                    return t;
                });
            };
            const updatedTasks = updateRecursively(tasksToUpdateByMeeting[meetingId]);
            updateMeeting(meetingId, { extractedTasks: updatedTasks });
        });
        
        toast({ title: 'Due Dates Updated' });
        setIsSetDueDateDialogOpen(false);
        setSelectedTaskIds(new Set());
    };


  if (isLoadingMeetingHistory) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
        <p className="ml-3 text-muted-foreground">Loading your calendar...</p>
      </div>
    );
  }

  const weekRangeText = `${format(startOfWeek(currentDate, { weekStartsOn: 1 }), 'MMM d')} - ${format(endOfWeek(currentDate, { weekStartsOn: 1 }), 'MMM d, yyyy')}`;
  
  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">
        <DashboardHeader
          pageIcon={Calendar}
          pageTitle={<h1 className="text-2xl font-bold font-headline">Calendar</h1>}
        >
            {isGoogleTasksConnected && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {isLoadingCalendarEvents ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Video className="h-3 w-3" />
                )}
                Google Calendar
              </div>
            )}
            <div className="flex items-center gap-1">
                 <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="h-8">
                      <ListFilter className="mr-2 h-4 w-4" />
                       <span className="capitalize">{contentFilter.replace('_', ' ')}</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuRadioGroup value={contentFilter} onValueChange={(v) => setContentFilter(v as ContentFilter)}>
                      <DropdownMenuRadioItem value="all">All Meetings</DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="with_tasks">With Tasks</DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="with_people">With People</DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>

                <div className="flex items-center gap-2 border-l pl-2 ml-2">
                    <Label htmlFor="show-weekends" className="text-sm">Weekends</Label>
                    <Switch
                        id="show-weekends"
                        checked={showWeekends}
                        onCheckedChange={setShowWeekends}
                    />
                </div>


                <Button variant="outline" size="icon" className="h-8 w-8 ml-2" onClick={() => handleWeekChange('prev')}>
                    <ChevronLeft size={16} />
                </Button>
                <Button variant="outline" className="h-8 px-3 text-xs" onClick={() => setCurrentDate(new Date())}>Today</Button>
                 <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => handleWeekChange('next')}>
                    <ChevronRight size={16} />
                </Button>
                 <span className="text-sm font-medium text-muted-foreground hidden lg:inline-block ml-4">{weekRangeText}</span>
            </div>
        </DashboardHeader>
      
      <div className="flex-grow w-full overflow-hidden p-0 flex">
        {weekData.map((day, i) => {
            const isActive = activeDayIndex === i;
            return (
                <DayColumn
                    key={day.date.toString()}
                    day={day}
                    isActive={isActive}
                    onHoverStart={() => !day.isEmpty && setActiveDayIndex(i)}
                    onHoverEnd={() => setActiveDayIndex(null)}
                    people={people}
                    selectedTaskIds={selectedTaskIds}
                    onToggleTask={handleToggleTaskSelection}
                    onToggleSession={handleToggleSessionSelection}
                    onToggleDay={handleToggleDaySelection}
                    onViewDetails={handleViewDetails}
                />
            );
        })}
      </div>
       <SelectionToolbar
        selectedCount={selectedTaskIds.size}
        onClear={() => setSelectedTaskIds(new Set())}
        onView={() => setIsSelectionViewVisible(true)}
        onAssign={() => setIsAssignDialogOpen(true)}
        onSetDueDate={() => setIsSetDueDateDialogOpen(true)}
        onDelete={() => toast({ title: 'Delete Clicked' })}
        onCopy={handleCopySelected}
        onSend={handleExport}
        onShareToSlack={() => setIsShareToSlackOpen(true)}
        isSlackConnected={isSlackConnected}
        onPushToGoogleTasks={() => setIsPushToGoogleOpen(true)}
        isGoogleTasksConnected={isGoogleTasksConnected}
        onPushToTrello={() => setIsPushToTrelloOpen(true)}
        isTrelloConnected={isTrelloConnected}
      />
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
          shareTitle="Explore"
        />
      <SelectionViewDialog
        isOpen={isSelectionViewVisible}
        onClose={() => setIsSelectionViewVisible(false)}
        tasks={selectedTasks}
      />
      <ShareToSlackDialog 
        isOpen={isShareToSlackOpen}
        onClose={() => setIsShareToSlackOpen(false)}
        tasks={selectedTasks}
        sessionTitle="Selected from Explore"
      />
      <PushToGoogleTasksDialog
        isOpen={isPushToGoogleOpen}
        onClose={() => setIsPushToGoogleOpen(false)}
        tasks={selectedTasks}
      />
      <PushToTrelloDialog
        isOpen={isPushToTrelloOpen}
        onClose={() => setIsPushToTrelloOpen(false)}
        tasks={selectedTasks}
      />
       <AssignPersonDialog
        isOpen={isAssignDialogOpen}
        onClose={() => setIsAssignDialogOpen(false)}
        people={people}
        isLoadingPeople={isLoadingPeople}
        onAssign={handleConfirmAssignPerson}
        onCreatePerson={handleCreatePerson}
        task={null}
        selectedTaskIds={selectedTaskIds}
      />
       <SetDueDateDialog
        isOpen={isSetDueDateDialogOpen}
        onClose={() => setIsSetDueDateDialogOpen(false)}
        onConfirm={handleConfirmSetDueDate}
      />
    </div>
  );
}


