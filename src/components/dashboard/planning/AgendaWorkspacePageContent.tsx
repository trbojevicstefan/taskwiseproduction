// src/components/dashboard/planning/AgendaWorkspacePageContent.tsx
//
// Priority 12 — agenda workspace for one future meeting
// (/planning/agendas/[meetingId]). Shows meeting details, attendees, related
// people/client, open tasks for those attendees, deterministic suggested
// agenda topics (open tasks + carry-over from the previous meeting), and a
// user-editable agenda persisted via PATCH /api/meetings/[id]/agenda.
//
// Suggested updates are NEVER applied silently: the user picks topics in a
// checklist dialog and confirms before anything is written to the meeting.
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Building2,
  CalendarClock,
  Loader2,
  NotebookPen,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
  Users,
} from "lucide-react";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import EmptyState from "@/components/common/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiFetch } from "@/lib/api";
import { format, isValid } from "date-fns";

// ---------------------------------------------------------------------------
// Types mirroring GET /api/planning/agenda-context
// ---------------------------------------------------------------------------

export interface AgendaSectionDraft {
  id: string;
  title: string;
  notes: string;
  order: number;
}

export interface AgendaSuggestedTopic {
  id: string;
  title: string;
  notes: string;
  source: "open_task" | "carry_over";
}

interface AgendaContextMeeting {
  id: string;
  title: string;
  startTime: string | null;
  endTime: string | null;
  attendees: Array<{ name: string | null; email: string | null }>;
  agenda: AgendaSectionDraft[];
  organizerEmail: string | null;
}

interface AgendaContextPerson {
  id: string;
  name: string | null;
  email: string | null;
  personType: string | null;
  company: string | null;
}

interface AgendaContextTask {
  id: string;
  title: string;
  dueAt: string | null;
  status: string | null;
  assigneeName: string | null;
  priorityLabel: string | null;
  sourceSessionId: string | null;
}

interface AgendaContext {
  meeting: AgendaContextMeeting;
  relatedPeople: AgendaContextPerson[];
  client: { personId: string; name: string | null; company: string | null } | null;
  openTasks: AgendaContextTask[];
  suggestedTopics: AgendaSuggestedTopic[];
  carryOver: {
    meetingId: string;
    meetingTitle: string;
    startTime: string | null;
  } | null;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests)
// ---------------------------------------------------------------------------

const makeSectionId = (): string => {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return crypto.randomUUID();
    }
  } catch {
    // fall through
  }
  return `section-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

/**
 * Append user-checked suggested topics to the agenda draft as new sections.
 * Topics whose (normalized) title already exists in the agenda are skipped —
 * confirming twice never duplicates sections.
 */
export const applySuggestionsToAgenda = (
  sections: AgendaSectionDraft[],
  topics: AgendaSuggestedTopic[],
  idFactory: () => string = makeSectionId
): AgendaSectionDraft[] => {
  const existingTitles = new Set(
    sections.map((section) => section.title.trim().toLowerCase())
  );
  const next = [...sections];
  for (const topic of topics) {
    const key = topic.title.trim().toLowerCase();
    if (!key || existingTitles.has(key)) continue;
    existingTitles.add(key);
    next.push({
      id: idFactory(),
      title: topic.title.trim(),
      notes: topic.notes || "",
      order: next.length,
    });
  }
  return next.map((section, index) => ({ ...section, order: index }));
};

const normalizeContext = (data: unknown): AgendaContext | null => {
  const raw = (data && typeof data === "object" ? data : {}) as Record<
    string,
    any
  >;
  const meeting = raw.meeting;
  if (!meeting || typeof meeting !== "object" || typeof meeting.id !== "string") {
    return null;
  }
  return {
    meeting: {
      id: meeting.id,
      title: typeof meeting.title === "string" ? meeting.title : "Meeting",
      startTime: typeof meeting.startTime === "string" ? meeting.startTime : null,
      endTime: typeof meeting.endTime === "string" ? meeting.endTime : null,
      attendees: Array.isArray(meeting.attendees) ? meeting.attendees : [],
      agenda: Array.isArray(meeting.agenda) ? meeting.agenda : [],
      organizerEmail:
        typeof meeting.organizerEmail === "string"
          ? meeting.organizerEmail
          : null,
    },
    relatedPeople: Array.isArray(raw.relatedPeople) ? raw.relatedPeople : [],
    client:
      raw.client && typeof raw.client === "object" ? raw.client : null,
    openTasks: Array.isArray(raw.openTasks) ? raw.openTasks : [],
    suggestedTopics: Array.isArray(raw.suggestedTopics)
      ? raw.suggestedTopics
      : [],
    carryOver:
      raw.carryOver && typeof raw.carryOver === "object" ? raw.carryOver : null,
  };
};

const formatMeetingTime = (value: string | null): string | null => {
  if (!value) return null;
  const date = new Date(value);
  if (!isValid(date)) return null;
  return format(date, "EEEE, MMM d yyyy · HH:mm");
};

// ---------------------------------------------------------------------------
// Suggestions checklist dialog (user controls what gets applied)
// ---------------------------------------------------------------------------

export interface AgendaSuggestionsDialogProps {
  isOpen: boolean;
  topics: AgendaSuggestedTopic[];
  isApplying: boolean;
  onClose: () => void;
  onConfirm: (selected: AgendaSuggestedTopic[]) => void;
}

export function AgendaSuggestionsDialog({
  isOpen,
  topics,
  isApplying,
  onClose,
  onConfirm,
}: AgendaSuggestionsDialogProps) {
  const [checkedIds, setCheckedIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (isOpen) {
      setCheckedIds(new Set(topics.map((topic) => topic.id)));
    }
  }, [isOpen, topics]);

  const toggle = (id: string, checked: boolean) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const selected = topics.filter((topic) => checkedIds.has(topic.id));

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Review suggested agenda topics</DialogTitle>
          <DialogDescription>
            Only the topics you check are added to the agenda. Nothing is
            written until you confirm.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-72 space-y-2 overflow-y-auto py-1">
          {topics.map((topic) => (
            <label
              key={topic.id}
              className="work-inset flex cursor-pointer items-start gap-2.5 p-2.5"
            >
              <Checkbox
                checked={checkedIds.has(topic.id)}
                onCheckedChange={(checked) =>
                  toggle(topic.id, checked === true)
                }
                aria-label={`Include "${topic.title}"`}
                className="mt-0.5"
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-foreground">
                  {topic.title}
                </span>
                {topic.notes && (
                  <span className="block text-xs text-muted-foreground">
                    {topic.notes}
                  </span>
                )}
              </span>
              <Badge variant="outline" className="shrink-0 text-[10px]">
                {topic.source === "carry_over" ? "Carry-over" : "Open task"}
              </Badge>
            </label>
          ))}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={isApplying}>
            Cancel
          </Button>
          <Button
            onClick={() => onConfirm(selected)}
            disabled={isApplying || selected.length === 0}
          >
            {isApplying ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-2 h-4 w-4" />
            )}
            Add {selected.length} to agenda
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Page content
// ---------------------------------------------------------------------------

export default function AgendaWorkspacePageContent({
  meetingId,
}: {
  meetingId: string;
}) {
  const { toast } = useToast();

  const [context, setContext] = useState<AgendaContext | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sections, setSections] = useState<AgendaSectionDraft[]>([]);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSuggestionsOpen, setIsSuggestionsOpen] = useState(false);
  const [isApplyingSuggestions, setIsApplyingSuggestions] = useState(false);

  const loadContext = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const response = await apiFetch<{ ok?: boolean; data?: unknown }>(
        `/api/planning/agenda-context?meetingId=${encodeURIComponent(meetingId)}`
      );
      const normalized = normalizeContext(
        (response as any)?.data ?? response
      );
      if (!normalized) {
        throw new Error("Meeting not found.");
      }
      setContext(normalized);
      setSections(normalized.meeting.agenda);
      setIsDirty(false);
    } catch (error) {
      setLoadError(
        error instanceof Error && error.message
          ? error.message
          : "Could not load the agenda workspace."
      );
    } finally {
      setIsLoading(false);
    }
  }, [meetingId]);

  useEffect(() => {
    void loadContext();
  }, [loadContext]);

  const persistAgenda = useCallback(
    async (nextSections: AgendaSectionDraft[]) => {
      const payload = {
        agenda: nextSections
          .filter((section) => section.title.trim())
          .map((section, index) => ({
            id: section.id,
            title: section.title.trim(),
            notes: section.notes || "",
            order: index,
          })),
      };
      const response = await apiFetch<{ agenda?: AgendaSectionDraft[] }>(
        `/api/meetings/${encodeURIComponent(meetingId)}/agenda`,
        { method: "PATCH", body: JSON.stringify(payload) }
      );
      const saved = Array.isArray(response?.agenda)
        ? response.agenda
        : payload.agenda;
      setSections(saved);
      setIsDirty(false);
      return saved;
    },
    [meetingId]
  );

  const handleSave = useCallback(async () => {
    if (sections.some((section) => !section.title.trim())) {
      toast({
        title: "Every agenda section needs a title",
        variant: "destructive",
      });
      return;
    }
    setIsSaving(true);
    try {
      await persistAgenda(sections);
      toast({ title: "Agenda saved" });
    } catch (error) {
      toast({
        title: "Could not save the agenda",
        description:
          error instanceof Error && error.message ? error.message : undefined,
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  }, [persistAgenda, sections, toast]);

  const handleConfirmSuggestions = useCallback(
    async (selected: AgendaSuggestedTopic[]) => {
      if (selected.length === 0) return;
      setIsApplyingSuggestions(true);
      try {
        const next = applySuggestionsToAgenda(sections, selected);
        await persistAgenda(next);
        setIsSuggestionsOpen(false);
        toast({
          title: `Added ${selected.length} topic${selected.length === 1 ? "" : "s"} to the agenda`,
        });
      } catch (error) {
        toast({
          title: "Could not apply the suggestions",
          description:
            error instanceof Error && error.message
              ? error.message
              : undefined,
          variant: "destructive",
        });
      } finally {
        setIsApplyingSuggestions(false);
      }
    },
    [persistAgenda, sections, toast]
  );

  const updateSection = (id: string, patch: Partial<AgendaSectionDraft>) => {
    setSections((prev) =>
      prev.map((section) =>
        section.id === id ? { ...section, ...patch } : section
      )
    );
    setIsDirty(true);
  };

  const addSection = () => {
    setSections((prev) => [
      ...prev,
      { id: makeSectionId(), title: "", notes: "", order: prev.length },
    ]);
    setIsDirty(true);
  };

  const removeSection = (id: string) => {
    setSections((prev) =>
      prev
        .filter((section) => section.id !== id)
        .map((section, index) => ({ ...section, order: index }))
    );
    setIsDirty(true);
  };

  const moveSection = (id: string, direction: -1 | 1) => {
    setSections((prev) => {
      const index = prev.findIndex((section) => section.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next.map((section, i) => ({ ...section, order: i }));
    });
    setIsDirty(true);
  };

  const meetingTime = useMemo(
    () => formatMeetingTime(context?.meeting.startTime ?? null),
    [context?.meeting.startTime]
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <DashboardHeader
        pageIcon={NotebookPen}
        pageTitle={
          <h1 className="text-2xl font-bold font-headline">
            Agenda workspace
          </h1>
        }
        description="Prepare this meeting: agenda, attendees, and open work."
      >
        <Button variant="ghost" size="sm" asChild>
          <Link href="/planning/agendas">
            <ArrowLeft className="mr-2 h-4 w-4" />
            All agendas
          </Link>
        </Button>
        <Button
          size="sm"
          onClick={() => void handleSave()}
          disabled={isSaving || !isDirty}
        >
          {isSaving ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-2 h-4 w-4" />
          )}
          Save agenda
        </Button>
      </DashboardHeader>

      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        {isLoading ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <Skeleton className="h-64 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : loadError || !context ? (
          <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-6 text-center">
            <p className="text-sm text-destructive">
              {loadError || "Could not load the agenda workspace."}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => void loadContext()}
            >
              <RefreshCw className="mr-2 h-3.5 w-3.5" />
              Try again
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-6 xl:flex-row xl:items-start">
            {/* Left: meeting context */}
            <div className="min-w-0 flex-1 space-y-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">
                    {context.meeting.title}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 pt-0">
                  {meetingTime && (
                    <p className="flex items-center gap-2 text-sm text-muted-foreground">
                      <CalendarClock className="h-4 w-4" />
                      {meetingTime}
                    </p>
                  )}
                  {context.client && (
                    <p className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Building2 className="h-4 w-4" />
                      Client: {context.client.name || "Unknown"}
                      {context.client.company
                        ? ` · ${context.client.company}`
                        : ""}
                    </p>
                  )}
                  <div>
                    <p className="mb-1.5 flex items-center gap-2 text-sm font-medium">
                      <Users className="h-4 w-4" />
                      Attendees
                    </p>
                    {context.meeting.attendees.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No attendees recorded.
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {context.meeting.attendees.map((attendee, index) => (
                          <Badge
                            key={`${attendee.email || attendee.name || index}`}
                            variant="secondary"
                            className="font-normal"
                          >
                            {attendee.name || attendee.email}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                  {context.relatedPeople.length > 0 && (
                    <div>
                      <p className="mb-1.5 text-sm font-medium">
                        Known people
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {context.relatedPeople.map((person) => (
                          <Badge
                            key={person.id}
                            variant="outline"
                            className="font-normal"
                          >
                            {person.name || person.email}
                            {person.personType === "client" ? " · client" : ""}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  {context.carryOver && (
                    <p className="text-xs text-muted-foreground">
                      Carry-over source: “{context.carryOver.meetingTitle}”
                    </p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center justify-between gap-2 text-base">
                    <span>Open tasks for attendees</span>
                    <Badge variant="secondary">{context.openTasks.length}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 pt-0">
                  {context.openTasks.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No open tasks for these attendees.
                    </p>
                  ) : (
                    context.openTasks.map((task) => (
                      <div
                        key={task.id}
                        className="data-row flex items-center justify-between gap-2 p-2.5"
                      >
                        <div className="min-w-0 flex-1">
                          <p
                            className="truncate text-sm font-medium"
                            title={task.title}
                          >
                            {task.title}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {task.assigneeName || "Unassigned"}
                            {task.dueAt &&
                              isValid(new Date(task.dueAt)) &&
                              ` · due ${format(new Date(task.dueAt), "MMM d")}`}
                          </p>
                        </div>
                        {task.priorityLabel && (
                          <Badge variant="outline" className="shrink-0 text-[10px]">
                            {task.priorityLabel}
                          </Badge>
                        )}
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Right: agenda editor */}
            <div className="w-full shrink-0 space-y-4 xl:w-[480px]">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center justify-between gap-2 text-base">
                    <span>Agenda</span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setIsSuggestionsOpen(true)}
                      disabled={context.suggestedTopics.length === 0}
                    >
                      <Sparkles className="mr-2 h-3.5 w-3.5" />
                      Suggested topics ({context.suggestedTopics.length})
                    </Button>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 pt-0">
                  {sections.length === 0 && (
                    <EmptyState
                      icon={NotebookPen}
                      title="No agenda yet"
                      description="Add a section or pull in suggested topics."
                      className="work-inset border-dashed"
                    />
                  )}
                  {sections.map((section, index) => (
                    <div key={section.id} className="work-inset space-y-2 p-3">
                      <div className="flex items-center gap-1.5">
                        <span className="w-5 shrink-0 text-xs font-medium text-muted-foreground">
                          {index + 1}.
                        </span>
                        <Input
                          value={section.title}
                          placeholder="Section title"
                          maxLength={300}
                          onChange={(event) =>
                            updateSection(section.id, {
                              title: event.target.value,
                            })
                          }
                          aria-label={`Agenda section ${index + 1} title`}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 shrink-0 text-muted-foreground"
                          title="Move up"
                          aria-label="Move section up"
                          disabled={index === 0}
                          onClick={() => moveSection(section.id, -1)}
                        >
                          <ArrowUp className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 shrink-0 text-muted-foreground"
                          title="Move down"
                          aria-label="Move section down"
                          disabled={index === sections.length - 1}
                          onClick={() => moveSection(section.id, 1)}
                        >
                          <ArrowDown className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                          title="Remove section"
                          aria-label="Remove section"
                          onClick={() => removeSection(section.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      <Textarea
                        value={section.notes}
                        placeholder="Notes (optional)"
                        maxLength={4000}
                        rows={2}
                        onChange={(event) =>
                          updateSection(section.id, {
                            notes: event.target.value,
                          })
                        }
                        aria-label={`Agenda section ${index + 1} notes`}
                      />
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addSection}
                  >
                    <Plus className="mr-2 h-3.5 w-3.5" />
                    Add section
                  </Button>
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </div>

      <AgendaSuggestionsDialog
        isOpen={isSuggestionsOpen}
        topics={context?.suggestedTopics ?? []}
        isApplying={isApplyingSuggestions}
        onClose={() => setIsSuggestionsOpen(false)}
        onConfirm={(selected) => void handleConfirmSuggestions(selected)}
      />
    </div>
  );
}
