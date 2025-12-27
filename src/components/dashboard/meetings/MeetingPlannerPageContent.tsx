"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Calendar, Clipboard, Loader2, Users, Video, Wand2 } from "lucide-react";
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

const getAttendeeKey = (attendee: { email?: string | null; name?: string | null }) =>
  attendee.email || attendee.name || "";

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

  const [people, setPeople] = useState<Person[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [isLoadingEvents, setIsLoadingEvents] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [selectedAttendees, setSelectedAttendees] = useState<Set<string>>(new Set());
  const [personTasks, setPersonTasks] = useState<Record<string, Task[]>>({});
  const [isUpdatingDescription, setIsUpdatingDescription] = useState(false);
  const [addingAttendees, setAddingAttendees] = useState<Set<string>>(new Set());

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
      const selected = attendeeMatches
        .filter(({ attendee, match }) => {
          const key = getAttendeeKey(attendee);
          return key && selectedAttendees.has(key) && match?.person?.id;
        })
        .map(({ match }) => match!.person);

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
  }, [attendeeMatches, selectedAttendees]);

  const agendaSections = useMemo(() => {
    return attendeeMatches
      .filter(({ attendee, match }) => {
        const key = getAttendeeKey(attendee);
        return key && selectedAttendees.has(key) && match?.person;
      })
      .map(({ attendee, match }) => {
        const person = match!.person;
        const tasks = sortTasks(personTasks[person.id] || []);
        return {
          label: person.name || attendee.name || attendee.email || "Attendee",
          person,
          tasks,
        };
      });
  }, [attendeeMatches, selectedAttendees, personTasks]);

  const agendaText = useMemo(() => {
    if (!selectedEvent) return "";
    const lines: string[] = [];
    lines.push(`Taskwise Agenda: ${selectedEvent.title}`);
    lines.push("");
    lines.push(
      `Meeting Guide: We'll review Taskwise open items and go around the room for status updates.`
    );
    lines.push(`Say "Taskwise open items" to trigger the live check.`);
    lines.push("");
    agendaSections.forEach((section) => {
      lines.push(section.label);
      if (section.tasks.length === 0) {
        lines.push("- No open tasks found.");
      } else {
        section.tasks.forEach((task) => {
          const due = task.dueAt ? format(new Date(task.dueAt as string), "MMM d") : "No due date";
          lines.push(`- ${task.title} (Priority: ${task.priority}, Due: ${due})`);
        });
      }
      lines.push("");
    });
    return lines.join("\n");
  }, [selectedEvent, agendaSections]);

  const recentMeetings = useMemo(() => {
    if (!selectedEvent) return [];
    const attendeeEmails = new Set(
      (selectedEvent.attendees || [])
        .map((attendee) => attendee.email?.toLowerCase())
        .filter(Boolean) as string[]
    );
    return meetings
      .filter((meeting) =>
        (meeting.attendees || []).some((attendee) =>
          attendee.email ? attendeeEmails.has(attendee.email.toLowerCase()) : false
        )
      )
      .slice(0, 3);
  }, [meetings, selectedEvent]);

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
    <div className="flex flex-col h-full">
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
      <div className="flex flex-1 gap-6 p-4 sm:p-6 lg:p-8 overflow-hidden">
        <Card className="w-full max-w-xs flex flex-col">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Calendar className="h-4 w-4" />
              Upcoming Meetings
            </CardTitle>
            <CardDescription>Pick a meeting to prepare the agenda.</CardDescription>
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
                        className={`w-full rounded-lg border p-3 text-left transition ${
                          isSelected ? "border-primary bg-primary/10" : "border-border"
                        }`}
                        onClick={() => setSelectedEventId(event.id)}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold truncate">{event.title}</p>
                            <p className="text-xs text-muted-foreground truncate">
                              {event.startTime ? format(new Date(event.startTime), "MMM d, h:mm a") : "No time"}
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

        <div className="flex-1 grid grid-cols-1 xl:grid-cols-2 gap-6 overflow-hidden">
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
              {selectedEvent && (
                <>
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
                          {section.tasks.map((task) => (
                            <li key={task.id}>
                              {task.title} · {task.priority} ·{" "}
                              {task.dueAt ? format(new Date(task.dueAt as string), "MMM d") : "No due date"}
                            </li>
                          ))}
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
              <Textarea value={agendaText} readOnly rows={14} className="flex-1 resize-none" />
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
    </div>
  );
}
