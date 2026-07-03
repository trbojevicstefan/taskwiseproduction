// src/components/dashboard/planning/PlanningWorkspacePageContent.tsx
//
// Phase 5 planning workspace at /planning: six triage sections computed by
// GET /api/planning/overview (Today / This week / Blocked / Waiting on client
// / Needs owner / Needs due date), per-row quick controls, and the AI
// planning assistant (GeneralChatPanel against POST /api/ai/chat).
//
// Planning decides what matters; the Board owns execution status — no
// drag/drop or column management here.
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarClock, Lightbulb, Loader2, RefreshCw } from "lucide-react";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import EmptyState from "@/components/common/EmptyState";
import GeneralChatPanel from "@/components/dashboard/chat/GeneralChatPanel";
import AssignPersonDialog from "@/components/dashboard/planning/AssignPersonDialog";
import PlanningTaskRow from "@/components/dashboard/planning/PlanningTaskRow";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { Person } from "@/types/person";
import type { ExtractedTaskSchema } from "@/types/chat";
import {
  EMPTY_PLANNING_OVERVIEW,
  PLANNING_ASSISTANT_PROMPTS,
  PLANNING_SECTION_META,
  PLANNING_SECTION_ORDER,
  isPlanningOverviewEmpty,
  normalizePlanningOverview,
  type PlanningOverview,
  type PlanningSectionKey,
  type PlanningTask,
} from "./planning-overview";

// ---------------------------------------------------------------------------
// Sections grid (pure — exported for tests)
// ---------------------------------------------------------------------------

export interface PlanningSectionsGridProps {
  overview: PlanningOverview;
  mutatingTaskIds?: Set<string>;
  onRequestAssign: (task: PlanningTask) => void;
  onSetDueDate: (task: PlanningTask, date: Date) => Promise<void> | void;
  onMarkDone: (task: PlanningTask) => Promise<void> | void;
}

export function PlanningSectionsGrid({
  overview,
  mutatingTaskIds,
  onRequestAssign,
  onSetDueDate,
  onMarkDone,
}: PlanningSectionsGridProps) {
  if (isPlanningOverviewEmpty(overview)) {
    return (
      <EmptyState
        icon={Lightbulb}
        title="Nothing to plan yet"
        description="Sync meetings or approve tasks first."
        className="rounded-xl border border-dashed border-border/60 bg-card/40"
      />
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {PLANNING_SECTION_ORDER.map((key: PlanningSectionKey) => {
        const meta = PLANNING_SECTION_META[key];
        const tasks = overview.sections[key];
        const count = overview.counts[key];
        return (
          <Card key={key} className="border-border/60 bg-card/70">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center justify-between gap-2 text-base">
                <span>{meta.title}</span>
                <Badge
                  variant="secondary"
                  className={cn(
                    "shrink-0",
                    count === 0 && "text-muted-foreground"
                  )}
                >
                  {count}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 pt-0">
              {tasks.length === 0 ? (
                <p className="text-sm text-muted-foreground">{meta.emptyText}</p>
              ) : (
                tasks.map((task) => (
                  <PlanningTaskRow
                    key={task.id}
                    task={task}
                    sectionKey={key}
                    onRequestAssign={onRequestAssign}
                    onSetDueDate={onSetDueDate}
                    onMarkDone={onMarkDone}
                    isMutating={mutatingTaskIds?.has(task.id) === true}
                  />
                ))
              )}
              {count > tasks.length && (
                <p className="pt-1 text-xs text-muted-foreground">
                  +{count - tasks.length} more not shown
                </p>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function PlanningSectionsSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {PLANNING_SECTION_ORDER.map((key) => (
        <Card key={key} className="border-border/60 bg-card/70">
          <CardHeader className="pb-3">
            <Skeleton className="h-5 w-32" />
          </CardHeader>
          <CardContent className="space-y-2 pt-0">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page content
// ---------------------------------------------------------------------------

export default function PlanningWorkspacePageContent() {
  const { toast } = useToast();

  const [overview, setOverview] = useState<PlanningOverview>(
    EMPTY_PLANNING_OVERVIEW
  );
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isRecomputing, setIsRecomputing] = useState(false);
  const [people, setPeople] = useState<Person[]>([]);
  const [isLoadingPeople, setIsLoadingPeople] = useState(true);
  const [assignTask, setAssignTask] = useState<PlanningTask | null>(null);
  const [mutatingTaskIds, setMutatingTaskIds] = useState<Set<string>>(
    () => new Set()
  );

  const loadOverview = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!options?.silent) {
        setIsLoading(true);
      }
      setLoadError(null);
      try {
        const response = await apiFetch<{ ok?: boolean; data?: unknown }>(
          "/api/planning/overview"
        );
        setOverview(normalizePlanningOverview(response?.data));
      } catch (error) {
        setLoadError(
          error instanceof Error && error.message
            ? error.message
            : "Could not load the planning overview."
        );
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await apiFetch<Person[]>("/api/people");
        if (!cancelled) {
          setPeople(Array.isArray(list) ? list : []);
        }
      } catch (error) {
        console.error("Failed to load people:", error);
      } finally {
        if (!cancelled) {
          setIsLoadingPeople(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const patchTask = useCallback(
    async (
      task: PlanningTask,
      body: Record<string, unknown>,
      successTitle: string
    ) => {
      setMutatingTaskIds((prev) => {
        const next = new Set(prev);
        next.add(task.id);
        return next;
      });
      try {
        await apiFetch(`/api/tasks/${task.id}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
        toast({ title: successTitle });
        await loadOverview({ silent: true });
      } catch (error) {
        toast({
          title: "Update failed",
          description:
            error instanceof Error && error.message
              ? error.message
              : "Could not update the task.",
          variant: "destructive",
        });
      } finally {
        setMutatingTaskIds((prev) => {
          const next = new Set(prev);
          next.delete(task.id);
          return next;
        });
      }
    },
    [loadOverview, toast]
  );

  const handleSetDueDate = useCallback(
    (task: PlanningTask, date: Date) =>
      patchTask(task, { dueAt: date.toISOString() }, "Due date updated"),
    [patchTask]
  );

  const handleMarkDone = useCallback(
    (task: PlanningTask) =>
      patchTask(task, { status: "done" }, "Task marked done"),
    [patchTask]
  );

  const handleAssignPerson = useCallback(
    async (person: Person) => {
      if (!assignTask) return;
      const task = assignTask;
      setAssignTask(null);
      await patchTask(
        task,
        {
          assignee: {
            id: person.id,
            name: person.name,
            email: person.email || undefined,
          },
          assigneeName: person.name,
        },
        `Assigned to ${person.name}`
      );
    },
    [assignTask, patchTask]
  );

  const handleCreatePerson = useCallback(
    async (name: string) => {
      try {
        const created = await apiFetch<Person>("/api/people", {
          method: "POST",
          body: JSON.stringify({ name }),
        });
        setPeople((prev) => {
          const existingIndex = prev.findIndex(
            (person) => person.id === created.id
          );
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
          description:
            error instanceof Error ? error.message : "Try again in a moment.",
          variant: "destructive",
        });
        return undefined;
      }
    },
    [toast]
  );

  const handleRecompute = useCallback(async () => {
    setIsRecomputing(true);
    try {
      const response = await apiFetch<{ ok?: boolean; updated?: number }>(
        "/api/tasks/priority/recompute",
        { method: "POST", body: JSON.stringify({}) }
      );
      const updated =
        typeof response?.updated === "number" ? response.updated : null;
      toast({
        title: "Priorities recomputed",
        description:
          updated === null
            ? undefined
            : `${updated} task${updated === 1 ? "" : "s"} updated.`,
      });
      await loadOverview({ silent: true });
    } catch (error) {
      toast({
        title: "Recompute failed",
        description:
          error instanceof Error && error.message
            ? error.message
            : "Could not recompute task priorities.",
        variant: "destructive",
      });
    } finally {
      setIsRecomputing(false);
    }
  }, [loadOverview, toast]);

  const assignDialogTask = useMemo(
    () => (assignTask ? (assignTask as unknown as ExtractedTaskSchema) : null),
    [assignTask]
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <DashboardHeader
        pageIcon={Lightbulb}
        pageTitle={<h1 className="text-2xl font-bold font-headline">Planning</h1>}
        description="Turn upcoming meetings and open tasks into a practical plan."
      >
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void handleRecompute()}
          disabled={isRecomputing}
        >
          {isRecomputing ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          Recompute priorities
        </Button>
        <Button variant="outline" size="sm" asChild>
          <Link href="/planning/agendas">
            <CalendarClock className="mr-2 h-4 w-4" />
            Meeting agendas
          </Link>
        </Button>
      </DashboardHeader>

      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-start">
          <div className="min-w-0 flex-1">
            {isLoading ? (
              <PlanningSectionsSkeleton />
            ) : loadError ? (
              <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-6 text-center">
                <p className="text-sm text-destructive">{loadError}</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={() => void loadOverview()}
                >
                  <RefreshCw className="mr-2 h-3.5 w-3.5" />
                  Try again
                </Button>
              </div>
            ) : (
              <PlanningSectionsGrid
                overview={overview}
                mutatingTaskIds={mutatingTaskIds}
                onRequestAssign={setAssignTask}
                onSetDueDate={handleSetDueDate}
                onMarkDone={handleMarkDone}
              />
            )}
          </div>

          <aside className="w-full shrink-0 xl:w-[380px]">
            <Card className="border-border/60 bg-card/70">
              <CardContent className="p-4">
                <GeneralChatPanel
                  heroTitle="Plan with AI"
                  suggestedPrompts={PLANNING_ASSISTANT_PROMPTS}
                  compact
                />
              </CardContent>
            </Card>
          </aside>
        </div>
      </div>

      <AssignPersonDialog
        isOpen={assignTask !== null}
        onClose={() => setAssignTask(null)}
        people={people}
        isLoadingPeople={isLoadingPeople}
        onAssign={(person) => void handleAssignPerson(person)}
        onCreatePerson={handleCreatePerson}
        task={assignDialogTask}
      />
    </div>
  );
}
