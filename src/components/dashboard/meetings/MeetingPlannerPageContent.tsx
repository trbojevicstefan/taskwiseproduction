"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Calendar, Clipboard, Loader2, Users, Video, Wand2, Plus } from "lucide-react";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useIntegrations } from "@/contexts/IntegrationsContext";
import { useMeetingHistory } from "@/contexts/MeetingHistoryContext";
import { useAuth } from "@/contexts/AuthContext";
import { addPerson, onPeopleSnapshot } from "@/lib/data";
import { getBestPersonMatch } from "@/lib/people-matching";
import { format } from "date-fns";
import { copyTextToClipboard } from "@/lib/exportUtils";
import type { Person } from "@/types/person";
import type { Task } from "@/types/project";
import type { ExtractedTaskSchema } from "@/types/chat";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import TaskDetailDialog from "@/components/dashboard/planning/TaskDetailDialog";
import { useWorkspaceBoards } from "@/hooks/use-workspace-boards";
import { moveTaskToBoard } from "@/lib/board-actions";
import { buildBriefContext } from "@/lib/brief-context";

type CalendarEvent = {
  id: string;
  title: string;
  startTime: string;
  endTime?: string | null;
  hangoutLink?: string | null;
  location?: string | null;
  organizer?: string | null;
  description?: string | null;
  attendees?: Array<{
    email: string;
    name?: string | null;
    responseStatus?: string | null;
  }>;
};

const priorityRank: Record<string, number> = { high: 0, medium: 1, low: 2 };
const priorityIcons: Record<string, string> = {
  high: "🔴",
  medium: "🟠",
  low: "🟡",
};
const MEETING_GUIDE_TEXT =
  "Meeting Guide: We'll review Taskwise open items and go around the room for status updates.";
const MEETING_GUIDE_TRIGGER = 'Say "Taskwise open items" to trigger the live check.';

const getAttendeeKey = (attendee: { email?: string | null; name?: string | null }) =>
  attendee.email || attendee.name || "";

const isValidEmail = (value?: string | null) =>
  Boolean(value && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));

const getEmailOptionsForPerson = (person: Person) => {
  const options = new Set<string>();
  if (isValidEmail(person.email)) options.add(person.email as string);
  if (Array.isArray(person.aliases)) {
    person.aliases.forEach((alias) => {
      if (isValidEmail(alias)) options.add(alias);
    });
  }
  return Array.from(options);
};

const dedupePeopleById = (items: Person[]) => {
  const map = new Map<string, Person>();
  items.forEach((person) => {
    if (!map.has(person.id)) {
      map.set(person.id, person);
    }
  });
  return Array.from(map.values());
};

const getPriorityIcon = (priority?: string | null) =>
  priorityIcons[priority || ""] || priorityIcons.medium;

const formatDueDate = (value?: string | Date | null) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return format(date, "MMM d");
};

const sortTasks = (tasks: Task[]) => {
  return [...tasks].sort((a, b) => {
    const dueA = a.dueAt ? new Date(a.dueAt as string).getTime() : null;
    const dueB = b.dueAt ? new Date(b.dueAt as string).getTime() : null;
    if (dueA && dueB && dueA !== dueB) return dueA - dueB;
    if (dueA && !dueB) return -1;
    if (!dueA && dueB) return 1;
    const priorityA = priorityRank[a.priority] ?? 3;
    const priorityB = priorityRank[b.priority] ?? 3;
    return priorityA - priorityB;
  });
};

export default function MeetingPlannerPageContent() {
  const { toast } = useToast();
  const { isGoogleTasksConnected, connectGoogleTasks } = useIntegrations();
  const { meetings } = useMeetingHistory();
  const { user } = useAuth();
  const workspaceId = user?.workspace?.id;
  const { boards } = useWorkspaceBoards(workspaceId);

  const [people, setPeople] = useState<Person[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [isLoadingEvents, setIsLoadingEvents] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [selectedAttendees, setSelectedAttendees] = useState<Set<string>>(new Set());
  const [personTasks, setPersonTasks] = useState<Record<string, Task[]>>({});
  const [isUpdatingDescription, setIsUpdatingDescription] = useState(false);
  const [addingAttendees, setAddingAttendees] = useState<Set<string>>(new Set());
  const [isSchedulingNew, setIsSchedulingNew] = useState(false);
  const [scheduleTitle, setScheduleTitle] = useState("");
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleStartTime, setScheduleStartTime] = useState("");
  const [scheduleDuration, setScheduleDuration] = useState("30");
  const [scheduleDescription, setScheduleDescription] = useState("");
  const [scheduleSelectedPeople, setScheduleSelectedPeople] = useState<Set<string>>(new Set());
  const [schedulePersonEmails, setSchedulePersonEmails] = useState<Record<string, string>>({});
  const [manualAttendeeInput, setManualAttendeeInput] = useState("");
  const [manualAttendees, setManualAttendees] = useState<string[]>([]);
  const [schedulePeopleSearch, setSchedulePeopleSearch] = useState("");
  const [isSchedulingMeeting, setIsSchedulingMeeting] = useState(false);
  const [isTaskDetailDialogOpen, setIsTaskDetailDialogOpen] = useState(false);
  const [taskForDetailView, setTaskForDetailView] = useState<ExtractedTaskSchema | null>(null);
  const [taskDetailContext, setTaskDetailContext] = useState<{
    personId: string;
    taskId: string;
  } | null>(null);

  useEffect(() => {
    if (!user?.uid) {
      setPeople([]);
      return;
    }
    const unsubscribe = onPeopleSnapshot(user.uid, (loadedPeople) => {
      setPeople(loadedPeople);
    });
    return () => unsubscribe();
  }, [user?.uid]);

  useEffect(() => {
    const fetchCalendarEvents = async () => {
      if (!isGoogleTasksConnected) {
        setCalendarEvents([]);
        return;
      }
      setIsLoadingEvents(true);
      try {
        const now = new Date();
        const end = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
        const response = await fetch(
          `/api/google/calendar/upcoming?start=${now.toISOString()}&end=${end.toISOString()}`
        );
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload.error || "Failed to load calendar events.");
        }
        const data = await response.json();
        const events = data.events || [];
        setCalendarEvents(events);
        if (events.length > 0 && !selectedEventId) {
          setSelectedEventId(events[0].id);
        }
      } catch (error: any) {
        console.error("Calendar fetch failed:", error);
        toast({
          title: "Google Calendar Sync Failed",
          description: error.message || "Could not load upcoming meetings.",
          variant: "destructive",
        });
      } finally {
        setIsLoadingEvents(false);
      }
    };

    fetchCalendarEvents();
  }, [isGoogleTasksConnected, selectedEventId, toast]);

  const selectedEvent = useMemo(
    () => calendarEvents.find((event) => event.id === selectedEventId) || null,
    [calendarEvents, selectedEventId]
  );

  useEffect(() => {
    if (!selectedEvent) {
      setSelectedAttendees(new Set());
      return;
    }
    const defaultSelection = new Set<string>();
    (selectedEvent.attendees || []).forEach((attendee) => {
      const key = getAttendeeKey(attendee);
      if (key) defaultSelection.add(key);
    });
    setSelectedAttendees(defaultSelection);
  }, [selectedEvent]);

  useEffect(() => {
    if (!isSchedulingNew) return;
    setScheduleSelectedPeople(new Set());
    setSchedulePersonEmails({});
    setManualAttendees([]);
    setManualAttendeeInput("");
  }, [isSchedulingNew]);

  const attendeeMatches = useMemo(() => {
    if (!selectedEvent) return [];
    return (selectedEvent.attendees || []).map((attendee) => {
      const match = getBestPersonMatch(
        { name: attendee.name, email: attendee.email },
        people,
        0.85
      );
      return { attendee, match };
    });
  }, [selectedEvent, people]);

  useEffect(() => {
    const loadTasks = async () => {
      const selected = isSchedulingNew
        ? people.filter((person) => scheduleSelectedPeople.has(person.id))
        : dedupePeopleById(
            attendeeMatches
              .filter(({ attendee, match }) => {
                const key = getAttendeeKey(attendee);
                return key && selectedAttendees.has(key) && match?.person?.id;
              })
              .map(({ match }) => match!.person)
          );

      if (selected.length === 0) {
        setPersonTasks({});
        return;
      }

      const nextTasks: Record<string, Task[]> = {};
      await Promise.all(
        selected.map(async (person) => {
          try {
            const response = await fetch(`/api/people/${person.id}/tasks`);
            if (!response.ok) return;
            const tasks = (await response.json()) as Task[];
            nextTasks[person.id] = tasks.filter((task) => task.status !== "done");
          } catch (error) {
            console.error("Failed to load tasks for", person.name, error);
          }
        })
      );
      setPersonTasks(nextTasks);
    };

    loadTasks();
  }, [attendeeMatches, selectedAttendees, isSchedulingNew, people, scheduleSelectedPeople]);

  const agendaMeetingTitle = useMemo(() => {
    if (!selectedEvent && !isSchedulingNew) return "";
    return isSchedulingNew
      ? scheduleTitle || "New Meeting"
      : selectedEvent?.title || "Meeting";
  }, [selectedEvent, isSchedulingNew, scheduleTitle]);

  const scheduleSelectedPeopleList = useMemo(
    () => people.filter((person) => scheduleSelectedPeople.has(person.id)),
    [people, scheduleSelectedPeople]
  );

  const scheduleManualAttendees = useMemo(
    () => manualAttendees.map((email) => ({ email })),
    [manualAttendees]
  );

  const agendaSections = useMemo(() => {
    if (isSchedulingNew) {
      const peopleSections = scheduleSelectedPeopleList.map((person) => ({
        label: person.name || "Attendee",
        person,
        tasks: sortTasks(personTasks[person.id] || []),
      }));
      const manualSections = scheduleManualAttendees.map((attendee) => ({
        label: attendee.email || "Guest",
        person: { id: attendee.email || "manual", name: attendee.email || "Guest" } as Person,
        tasks: [] as Task[],
      }));
      return [...peopleSections, ...manualSections];
    }
    const sections = new Map<string, { label: string; person: Person; tasks: Task[] }>();
    attendeeMatches.forEach(({ attendee, match }) => {
      const key = getAttendeeKey(attendee);
      if (!key || !selectedAttendees.has(key) || !match?.person) return;
      const person = match.person;
      if (!sections.has(person.id)) {
        sections.set(person.id, {
          label: person.name || attendee.name || attendee.email || "Attendee",
          person,
          tasks: sortTasks(personTasks[person.id] || []),
        });
      }
    });
    return Array.from(sections.values());
  }, [attendeeMatches, selectedAttendees, personTasks, isSchedulingNew, scheduleSelectedPeopleList, scheduleManualAttendees]);

  const agendaText = useMemo(() => {
    if (!agendaMeetingTitle) return "";
    const lines: string[] = [];
    lines.push(`Taskwise Agenda: ${agendaMeetingTitle}`);
    lines.push("");
    lines.push(MEETING_GUIDE_TEXT);
    lines.push(MEETING_GUIDE_TRIGGER);
    lines.push("");
    agendaSections.forEach((section) => {
      lines.push(section.label);
      if (section.tasks.length === 0) {
        lines.push("- No open tasks found.");
      } else {
        section.tasks.forEach((task) => {
          const due = formatDueDate(task.dueAt);
          const priorityIcon = getPriorityIcon(task.priority);
          const parts = [`${task.title} ${priorityIcon}`];
          if (due) parts.push(due);
          lines.push(`- ${parts.join(" - ")}`);
        });
      }
      lines.push("");
    });
    return lines.join("\n");
  }, [agendaMeetingTitle, agendaSections]);

  const recentMeetings = useMemo(() => {
    if (!selectedEvent && !isSchedulingNew) return [];
    const attendeeEmails = new Set<string>();
    if (isSchedulingNew) {
      scheduleSelectedPeopleList.forEach((person) => {
        if (person.email) attendeeEmails.add(person.email.toLowerCase());
      });
      manualAttendees.forEach((email) => attendeeEmails.add(email.toLowerCase()));
    } else {
      (selectedEvent?.attendees || [])
        .map((attendee) => attendee.email?.toLowerCase())
        .filter(Boolean)
        .forEach((email) => attendeeEmails.add(email as string));
    }
    return meetings
      .filter((meeting) =>
        (meeting.attendees || []).some((attendee) =>
          attendee.email ? attendeeEmails.has(attendee.email.toLowerCase()) : false
        )
      )
      .slice(0, 3);
  }, [meetings, selectedEvent, isSchedulingNew, scheduleSelectedPeopleList, manualAttendees]);

  const handleToggleAttendee = (attendee: { email?: string | null; name?: string | null }) => {
    const key = getAttendeeKey(attendee);
    if (!key) return;
    setSelectedAttendees((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const handleAddAttendee = async (attendee: { email?: string | null; name?: string | null }) => {
    if (!user?.uid) return;
    const key = getAttendeeKey(attendee);
    const name = attendee.name || attendee.email;
    if (!key || !name) {
      toast({
        title: "Cannot add attendee",
        description: "Attendee must have a name or email.",
        variant: "destructive",
      });
      return;
    }

    setAddingAttendees((prev) => new Set(prev).add(key));
    try {
      await addPerson(
        user.uid,
        { name, email: attendee.email || null },
        selectedEvent?.id ? `planner:${selectedEvent.id}` : "planner:manual"
      );
      toast({ title: "Person added", description: `${name} was added to People.` });
    } catch (error) {
      console.error("Failed to add person:", error);
      toast({
        title: "Add failed",
        description: "Could not add this attendee to People.",
        variant: "destructive",
      });
    } finally {
      setAddingAttendees((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  const handleCopyAgenda = async () => {
    if (!agendaText) return;
    const { success } = await copyTextToClipboard(agendaText);
    toast({
      title: success ? "Agenda copied to clipboard." : "Copy failed.",
      variant: success ? "default" : "destructive",
    });
  };

  const mapTaskToExtracted = (task: Task): ExtractedTaskSchema => ({
    id: task.id,
    title: task.title,
    description: task.description ?? null,
    priority: task.priority,
    status: task.status,
    dueAt: task.dueAt ?? null,
    assignee: task.assignee ?? null,
    assigneeName: task.assigneeName ?? null,
    subtasks: (task as any).subtasks ?? undefined,
    comments: task.comments ?? null,
    researchBrief: task.researchBrief ?? null,
    aiAssistanceText: task.aiAssistanceText ?? null,
    sourceSessionId: task.sourceSessionId ?? undefined,
    sourceSessionName: task.sourceSessionName ?? null,
  });

  const handleOpenTaskDetails = (person: Person, task: Task) => {
    setTaskForDetailView(mapTaskToExtracted(task));
    setTaskDetailContext({ personId: person.id, taskId: task.id });
    setIsTaskDetailDialogOpen(true);
  };

  const handleSaveTaskDetails = async (
    updatedTask: ExtractedTaskSchema,
    options?: { close?: boolean }
  ) => {
    if (!taskDetailContext) return;
    try {
      const response = await fetch(`/api/tasks/${taskDetailContext.taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: updatedTask.title,
          description: updatedTask.description ?? null,
          priority: updatedTask.priority,
          dueAt: updatedTask.dueAt ?? null,
          status: updatedTask.status || "todo",
          comments: updatedTask.comments ?? null,
          researchBrief: updatedTask.researchBrief ?? null,
          aiAssistanceText: updatedTask.aiAssistanceText ?? null,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || "Failed to update task.");
      }
      setPersonTasks((prev) => {
        const next = { ...prev };
        const tasksForPerson = next[taskDetailContext.personId] || [];
        next[taskDetailContext.personId] = tasksForPerson.map((task) =>
          task.id === taskDetailContext.taskId
            ? {
                ...task,
                title: updatedTask.title,
                description: updatedTask.description ?? "",
                priority: updatedTask.priority,
                dueAt: updatedTask.dueAt ?? null,
                status: updatedTask.status || "todo",
                comments: updatedTask.comments ?? null,
                researchBrief: updatedTask.researchBrief ?? null,
                aiAssistanceText: updatedTask.aiAssistanceText ?? null,
              }
            : task
        );
        return next;
      });
      setTaskForDetailView(updatedTask);
      if (options?.close !== false) {
        setIsTaskDetailDialogOpen(false);
        setTaskForDetailView(null);
        setTaskDetailContext(null);
      }
      toast({ title: "Task updated" });
    } catch (error) {
      console.error("Failed to update task:", error);
      toast({
        title: "Update failed",
        description: error instanceof Error ? error.message : "Try again in a moment.",
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
      buildBriefContext(task, meetings, people),
    [meetings, people]
  );

  const handleToggleSchedulePerson = (person: Person) => {
    setScheduleSelectedPeople((prev) => {
      const next = new Set(prev);
      if (next.has(person.id)) {
        next.delete(person.id);
      } else {
        next.add(person.id);
      }
      return next;
    });
    setSchedulePersonEmails((prev) => {
      const next = { ...prev };
      if (next[person.id]) {
        delete next[person.id];
      } else {
        const options = getEmailOptionsForPerson(person);
        if (options.length > 0) {
          next[person.id] = options[0];
        }
      }
      return next;
    });
  };

  const schedulePeopleOptions = useMemo(() => {
    const term = schedulePeopleSearch.trim().toLowerCase();
    if (!term) return people;
    return people.filter((person) =>
      [person.name, person.email, ...(person.aliases || [])]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term))
    );
  }, [people, schedulePeopleSearch]);

  const handleScheduleMeeting = async () => {
    if (!scheduleTitle.trim() || !scheduleDate || !scheduleStartTime) {
      toast({
        title: "Missing details",
        description: "Please add a title, date, and start time.",
        variant: "destructive",
      });
      return;
    }

    const attendees = [
      ...scheduleSelectedPeopleList
        .map((person) => schedulePersonEmails[person.id] || person.email || "")
        .filter((email) => isValidEmail(email)),
      ...manualAttendees,
    ];

    if (attendees.length === 0) {
      toast({
        title: "Add attendees",
        description: "Select at least one attendee email.",
        variant: "destructive",
      });
      return;
    }

    const start = new Date(`${scheduleDate}T${scheduleStartTime}`);
    if (Number.isNaN(start.getTime())) {
      toast({
        title: "Invalid start time",
        description: "Please select a valid meeting time.",
        variant: "destructive",
      });
      return;
    }
    const durationMinutes = Number(scheduleDuration) || 30;
    const end = new Date(start.getTime() + durationMinutes * 60 * 1000);

    setIsSchedulingMeeting(true);
    try {
      const response = await fetch("/api/google/calendar/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: scheduleTitle.trim(),
          description: scheduleDescription.trim() || agendaText,
          startTime: start.toISOString(),
          endTime: end.toISOString(),
          attendees,
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || "Failed to create meeting.");
      }

      toast({ title: "Meeting scheduled", description: "Google Calendar event created." });

      if (payload.event) {
        const extractUrl = (value?: string | null) => {
          if (!value) return null;
          const match = value.match(/https?:\/\/\S+/i);
          return match ? match[0].replace(/[),.]+$/, "") : null;
        };
        const event = payload.event;
        const conferenceLink = event.conferenceData?.entryPoints?.find(
          (entry: { uri?: string | null }) => entry.uri
        )?.uri;
        const locationLink = extractUrl(event.location);
        const descriptionLink = extractUrl(event.description);
        const hangoutLink =
          event.hangoutLink || conferenceLink || locationLink || descriptionLink || null;

        const newEvent: CalendarEvent = {
          id: event.id,
          title: event.summary || scheduleTitle.trim() || "Untitled Meeting",
          startTime: event.start?.dateTime || event.start?.date,
          endTime: event.end?.dateTime || event.end?.date || null,
          hangoutLink,
          location: event.location || null,
          organizer: event.organizer?.email || null,
          description: event.description || null,
          attendees: Array.isArray(event.attendees)
            ? event.attendees.map((attendee: any) => ({
                email: attendee.email,
                name: attendee.displayName || null,
                responseStatus: attendee.responseStatus || null,
              }))
            : [],
        };

        setCalendarEvents((prev) => [newEvent, ...prev.filter((item) => item.id !== newEvent.id)]);
      }
      setIsSchedulingNew(false);
      setScheduleTitle("");
      setScheduleDate("");
      setScheduleStartTime("");
      setScheduleDuration("30");
      setScheduleDescription("");
      setScheduleSelectedPeople(new Set());
      setManualAttendees([]);
      setManualAttendeeInput("");

      if (payload.event?.id) {
        setSelectedEventId(payload.event.id);
      }
    } catch (error: any) {
      console.error("Failed to schedule meeting:", error);
      toast({
        title: "Scheduling failed",
        description: error.message || "Could not create meeting.",
        variant: "destructive",
      });
    } finally {
      setIsSchedulingMeeting(false);
    }
  };

  const handleUpdateDescription = async () => {
    if (!selectedEvent) return;
    setIsUpdatingDescription(true);
    try {
      const base = selectedEvent.description || "";
      const marker = "Taskwise Agenda";
      const descriptionParts = base.split(marker);
      const newDescription =
        (descriptionParts[0] || "").trim() +
        `\n\n${agendaText}`;

      const response = await fetch("/api/google/calendar/update", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId: selectedEvent.id,
          description: newDescription.trim(),
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "Failed to update meeting description.");
      }
      toast({ title: "Meeting description updated." });
    } catch (error: any) {
      console.error("Update description failed:", error);
      toast({
        title: "Update Failed",
        description: error.message || "Could not update meeting description.",
        variant: "destructive",
      });
    } finally {
      setIsUpdatingDescription(false);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <DashboardHeader
        pageIcon={Wand2}
        pageTitle={<h1 className="text-2xl font-bold font-headline">Meeting Planner</h1>}
      >
        {!isGoogleTasksConnected && (
          <Button variant="outline" onClick={connectGoogleTasks}>
            Connect Google Workspace
          </Button>
        )}
      </DashboardHeader>
      <div className="flex flex-1 gap-6 p-4 sm:p-6 lg:p-8 overflow-auto">
        <Card className="w-full max-w-xs flex flex-col">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Calendar className="h-4 w-4" />
              Upcoming Meetings
            </CardTitle>
            <CardDescription>Pick a meeting to prepare the agenda.</CardDescription>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => setIsSchedulingNew(true)}
              disabled={!isGoogleTasksConnected}
            >
              <Plus className="mr-2 h-4 w-4" />
              Schedule Google Meeting
            </Button>
          </CardHeader>
          <CardContent className="flex-1 min-h-0">
            {isLoadingEvents ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading meetings...
              </div>
            ) : (
              <ScrollArea className="h-full">
                <div className="space-y-2 pr-2">
                  {calendarEvents.map((event) => {
                    const isSelected = event.id === selectedEventId;
                    return (
                      <button
                        key={event.id}
                        className={`w-full rounded-lg border p-3 text-left transition overflow-hidden ${
                          isSelected ? "border-primary bg-primary/10" : "border-border"
                        }`}
                        onClick={() => {
                          setSelectedEventId(event.id);
                          setIsSchedulingNew(false);
                        }}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold leading-snug break-words">
                              {event.title}
                            </p>
                            <p className="text-xs text-muted-foreground break-words">
                              {event.startTime
                                ? format(new Date(event.startTime), "MMM d, h:mm a")
                                : "No time"}
                            </p>
                          </div>
                          <Video className="h-4 w-4 text-muted-foreground" />
                        </div>
                      </button>
                    );
                  })}
                  {calendarEvents.length === 0 && (
                    <p className="text-sm text-muted-foreground">No upcoming meetings with video links.</p>
                  )}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>

        <div className="flex-1 grid grid-cols-1 xl:grid-cols-2 gap-6">
          <Card className="flex flex-col">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Users className="h-4 w-4" />
                Attendees & Open Items
              </CardTitle>
              <CardDescription>
                Match attendees to your People directory and pull unfinished tasks.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex-1 overflow-auto space-y-4">
              {!selectedEvent && <p className="text-sm text-muted-foreground">Select a meeting to begin.</p>}
              {isSchedulingNew && (
                <div className="space-y-4 rounded-lg border p-4 bg-muted/20">
                  <h4 className="text-sm font-semibold">Schedule a Google Meeting</h4>
                  <div className="grid grid-cols-1 gap-3">
                    <div className="space-y-1">
                      <Label>Meeting title</Label>
                      <Input
                        value={scheduleTitle}
                        onChange={(event) => setScheduleTitle(event.target.value)}
                        placeholder="Weekly Sync"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label>Date</Label>
                        <Input
                          type="date"
                          value={scheduleDate}
                          onChange={(event) => setScheduleDate(event.target.value)}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label>Start time</Label>
                        <Input
                          type="time"
                          value={scheduleStartTime}
                          onChange={(event) => setScheduleStartTime(event.target.value)}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label>Duration</Label>
                        <Select
                          value={scheduleDuration}
                          onValueChange={(value) => setScheduleDuration(value)}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="30">30 minutes</SelectItem>
                            <SelectItem value="45">45 minutes</SelectItem>
                            <SelectItem value="60">60 minutes</SelectItem>
                            <SelectItem value="90">90 minutes</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label>Attendees (manual)</Label>
                        <div className="flex gap-2">
                          <Input
                            value={manualAttendeeInput}
                            onChange={(event) => setManualAttendeeInput(event.target.value)}
                            placeholder="name@email.com"
                          />
                          <Button
                            variant="outline"
                            onClick={() => {
                              if (!isValidEmail(manualAttendeeInput)) {
                                toast({
                                  title: "Invalid email",
                                  description: "Enter a valid email address.",
                                  variant: "destructive",
                                });
                                return;
                              }
                              setManualAttendees((prev) => {
                                const next = new Set(prev);
                                next.add(manualAttendeeInput.trim().toLowerCase());
                                return Array.from(next);
                              });
                              setManualAttendeeInput("");
                            }}
                          >
                            Add
                          </Button>
                        </div>
                        {manualAttendees.length > 0 && (
                          <div className="flex flex-wrap gap-2 pt-2 text-xs">
                            {manualAttendees.map((email) => (
                              <Badge
                                key={email}
                                variant="secondary"
                                className="cursor-pointer"
                                onClick={() =>
                                  setManualAttendees((prev) =>
                                    prev.filter((item) => item !== email)
                                  )
                                }
                              >
                                {email}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label>Notes</Label>
                      <Textarea
                        value={scheduleDescription}
                        onChange={(event) => setScheduleDescription(event.target.value)}
                        placeholder="Optional agenda notes..."
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>People directory</Label>
                      <Input
                        value={schedulePeopleSearch}
                        onChange={(event) => setSchedulePeopleSearch(event.target.value)}
                        placeholder="Search people..."
                      />
                      <div className="space-y-2 max-h-64 overflow-auto pr-2">
                        {schedulePeopleOptions.map((person) => {
                          const emailOptions = getEmailOptionsForPerson(person);
                          const isSelected = scheduleSelectedPeople.has(person.id);
                          return (
                            <div key={person.id} className="flex items-center justify-between gap-3 rounded-md border p-2">
                              <div>
                                <p className="text-sm font-medium">{person.name}</p>
                                <p className="text-xs text-muted-foreground">
                                  {person.email || "No email on file"}
                                </p>
                              </div>
                              <div className="flex items-center gap-2">
                                {isSelected && (
                                  <Select
                                    value={schedulePersonEmails[person.id] || emailOptions[0] || ""}
                                    onValueChange={(value) =>
                                      setSchedulePersonEmails((prev) => ({
                                        ...prev,
                                        [person.id]: value,
                                      }))
                                    }
                                  >
                                    <SelectTrigger className="h-8 w-[180px] text-xs">
                                      <SelectValue placeholder="Select email" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {emailOptions.length === 0 && (
                                        <SelectItem value="none" disabled>
                                          No emails found
                                        </SelectItem>
                                      )}
                                      {emailOptions.map((email) => (
                                        <SelectItem key={email} value={email}>
                                          {email}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                )}
                                <Checkbox
                                  checked={isSelected}
                                  onCheckedChange={() => handleToggleSchedulePerson(person)}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                  <Button onClick={handleScheduleMeeting} disabled={isSchedulingMeeting}>
                    {isSchedulingMeeting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Schedule Meeting
                  </Button>
                </div>
              )}
              {selectedEvent && !isSchedulingNew && (
                <>
                  <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/20 p-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold leading-snug break-words">
                        {selectedEvent.title}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {selectedEvent.startTime
                          ? format(new Date(selectedEvent.startTime), "MMM d, h:mm a")
                          : "No time"}
                      </p>
                    </div>
                    {selectedEvent.hangoutLink && (
                      <Button asChild size="sm" className="shrink-0">
                        <a href={selectedEvent.hangoutLink} target="_blank" rel="noreferrer">
                          <Video className="mr-2 h-4 w-4" />
                          Join
                        </a>
                      </Button>
                    )}
                  </div>
                  <div className="space-y-3">
                    <h4 className="text-sm font-semibold">Attendees</h4>
                    {(selectedEvent.attendees || []).map((attendee) => {
                      const key = getAttendeeKey(attendee);
                      const match = getBestPersonMatch(
                        { name: attendee.name, email: attendee.email },
                        people,
                        0.85
                      );
                      const isSelected = key && selectedAttendees.has(key);
                      const isAdding = key ? addingAttendees.has(key) : false;
                      return (
                        <div key={key} className="flex items-center justify-between gap-3 rounded-md border p-2">
                          <div>
                            <p className="text-sm font-medium">
                              {attendee.name || attendee.email || "Guest"}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {attendee.email || "No email"}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            {match?.person && (
                              <Badge variant="secondary">{match.person.name}</Badge>
                            )}
                            {!match?.person && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleAddAttendee(attendee)}
                                disabled={isAdding || !key}
                              >
                                {isAdding ? <Loader2 className="h-3 w-3 animate-spin" /> : "Add to People"}
                              </Button>
                            )}
                            <Checkbox
                              checked={Boolean(isSelected)}
                              onCheckedChange={() => handleToggleAttendee(attendee)}
                              aria-label="Include attendee"
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="space-y-3">
                    <h4 className="text-sm font-semibold">Open Tasks by Attendee</h4>
                    {agendaSections.length === 0 && (
                      <p className="text-sm text-muted-foreground">No matched attendees selected.</p>
                    )}
                    {agendaSections.map((section) => (
                      <div key={section.person.id} className="rounded-md border p-3">
                        <div className="flex items-center justify-between">
                          <p className="font-semibold text-sm">{section.label}</p>
                          <Badge variant="outline">{section.tasks.length}</Badge>
                        </div>
                        <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                          {section.tasks.length === 0 && <li>No open tasks.</li>}
                          {section.tasks.map((task) => {
                            const due = formatDueDate(task.dueAt);
                            return (
                              <li key={task.id}>
                                <button
                                  type="button"
                                  onClick={() => handleOpenTaskDetails(section.person, task)}
                                  className="w-full text-left rounded-md px-2 py-1 transition hover:bg-muted/40"
                                >
                                  {task.title} {getPriorityIcon(task.priority)}
                                  {due ? ` - ${due}` : ""}
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card className="flex flex-col">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Wand2 className="h-4 w-4" />
                Agenda Preview
              </CardTitle>
              <CardDescription>Share this with the organizer or update the meeting description.</CardDescription>
            </CardHeader>
            <CardContent className="flex-1 flex flex-col gap-4">
              <ScrollArea className="flex-1 rounded-lg border bg-muted/20">
                <div className="p-4 text-sm">
                  {!agendaMeetingTitle ? (
                    <p className="text-sm text-muted-foreground">
                      Select a meeting to preview the agenda.
                    </p>
                  ) : (
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <p className="text-lg font-semibold break-words">{`Taskwise Agenda: ${agendaMeetingTitle}`}</p>
                        <p className="text-sm italic text-muted-foreground">{MEETING_GUIDE_TEXT}</p>
                        <p className="text-sm italic text-muted-foreground">{MEETING_GUIDE_TRIGGER}</p>
                      </div>
                      <div className="space-y-4">
                        {agendaSections.map((section) => (
                          <div key={section.person.id} className="space-y-2">
                            <p className="text-sm font-semibold">{section.label}</p>
                            {section.tasks.length === 0 ? (
                              <p className="text-xs text-muted-foreground">No open tasks found.</p>
                            ) : (
                              <ul className="space-y-2">
                                {section.tasks.map((task) => {
                                  const due = formatDueDate(task.dueAt);
                                  return (
                                    <li key={task.id} className="flex items-start gap-2">
                                      <span className="mt-0.5 text-sm">{getPriorityIcon(task.priority)}</span>
                                      <div className="flex-1">
                                        <p className="text-sm leading-snug">{task.title}</p>
                                      </div>
                                      {due && (
                                        <span className="text-xs text-muted-foreground">{due}</span>
                                      )}
                                    </li>
                                  );
                                })}
                              </ul>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </ScrollArea>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={handleCopyAgenda} disabled={!agendaText}>
                  <Clipboard className="mr-2 h-4 w-4" />
                  Copy Agenda
                </Button>
                <Button onClick={handleUpdateDescription} disabled={!selectedEvent || isUpdatingDescription}>
                  {isUpdatingDescription ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Video className="mr-2 h-4 w-4" />
                  )}
                  Update Meeting Description
                </Button>
              </div>
              {recentMeetings.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold">Recent Related Meetings</h4>
                  {recentMeetings.map((meeting) => (
                    <div key={meeting.id} className="rounded-md border p-2">
                      <p className="text-sm font-medium">{meeting.title}</p>
                      <p className="text-xs text-muted-foreground line-clamp-2">{meeting.summary}</p>
                    </div>
                  ))}
              </div>
            )}
          </CardContent>
        </Card>
        </div>
      </div>
      <TaskDetailDialog
        isOpen={isTaskDetailDialogOpen}
        onClose={() => {
          setIsTaskDetailDialogOpen(false);
          setTaskForDetailView(null);
          setTaskDetailContext(null);
        }}
        task={taskForDetailView}
        onSave={handleSaveTaskDetails}
        people={people}
        workspaceId={workspaceId}
        boards={boards}
        currentBoardId={taskForDetailView?.addedToBoardId ?? null}
        onMoveToBoard={handleMoveTaskToBoard}
        getBriefContext={getBriefContext}
        shareTitle={agendaMeetingTitle || "Meeting Planner"}
        supportsSubtasks
      />
    </div>
  );
}



