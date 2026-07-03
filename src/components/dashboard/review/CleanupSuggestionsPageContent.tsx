"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  Clock,
  Copy,
  Loader2,
  Sparkles,
  Timer,
} from "lucide-react";
import { format, isValid } from "date-fns";
import EmptyState from "@/components/common/EmptyState";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
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
import { useToast } from "@/hooks/use-toast";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { Task } from "@/types/project";
import type { TaskCleanupCategory } from "@/types/chat";

type CleanupAction =
  | "expire"
  | "mark_duplicate"
  | "mark_completed"
  | "dismiss"
  | "restore";

type SuggestionsResponse = {
  suggestions?: Task[];
  expired?: Task[];
};

type ScanResponse = {
  scanned?: number;
  flagged?: number;
  expired?: number;
  byCategory?: Record<string, number>;
};

type ActionResponse = {
  updated?: number;
};

const CLEANUP_CATEGORY_LABELS: Record<TaskCleanupCategory, string> = {
  scheduling_admin: "Scheduling & admin",
  meeting_logistics: "Meeting logistics",
  already_completed: "Already completed",
  duplicate: "Duplicate",
  low_specificity: "Low specificity",
  stale_follow_up: "Stale follow-up",
  expired_event: "Expired event",
};

// Badge tones follow the ReviewTasksPageContent statusMeta light/dark pairs:
// vanity/scheduling amber, duplicate violet, stale slate, completed emerald.
const CLEANUP_CATEGORY_TONES: Record<TaskCleanupCategory, string> = {
  scheduling_admin:
    "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  meeting_logistics:
    "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  low_specificity:
    "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  duplicate:
    "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  stale_follow_up:
    "border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300",
  expired_event:
    "border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300",
  already_completed:
    "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
};

const formatDate = (value: unknown): string | null => {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (!isValid(parsed)) return null;
  return format(parsed, "MMM d, yyyy");
};

const formatConfidence = (value: number | null | undefined): string | null => {
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  return `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`;
};

function CategoryChip({ category }: { category?: TaskCleanupCategory | null }) {
  if (!category || !CLEANUP_CATEGORY_LABELS[category]) return null;
  return (
    <Badge
      variant="outline"
      className={cn("rounded-full text-[11px]", CLEANUP_CATEGORY_TONES[category])}
    >
      {CLEANUP_CATEGORY_LABELS[category]}
    </Badge>
  );
}

function SuggestionRow({
  task,
  isSelected,
  onToggleSelect,
  extraChips,
  detail,
}: {
  task: Task;
  isSelected: boolean;
  onToggleSelect: (taskId: string, selected: boolean) => void;
  extraChips?: React.ReactNode;
  detail?: React.ReactNode;
}) {
  const confidence = formatConfidence(task.cleanupConfidence);
  return (
    <div className="flex items-start gap-3 rounded-xl border bg-card px-3 py-2.5">
      <Checkbox
        checked={isSelected}
        onCheckedChange={(checked) => onToggleSelect(task.id, Boolean(checked))}
        aria-label={`Select ${task.title}`}
        className="mt-0.5"
      />
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <p className="min-w-0 truncate text-sm font-medium">{task.title}</p>
          <CategoryChip category={task.cleanupCategory} />
          {confidence ? (
            <span className="text-[11px] text-muted-foreground">
              {confidence} confidence
            </span>
          ) : null}
          {extraChips}
        </div>
        {task.cleanupReason ? (
          <p className="text-xs text-muted-foreground">{task.cleanupReason}</p>
        ) : null}
        {detail}
      </div>
    </div>
  );
}

function SectionHeader({
  icon: Icon,
  title,
  count,
  allSelected,
  someSelected,
  onToggleAll,
}: {
  icon: React.ElementType;
  title: string;
  count: number;
  allSelected: boolean;
  someSelected: boolean;
  onToggleAll: (selected: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Checkbox
        checked={allSelected ? true : someSelected ? "indeterminate" : false}
        onCheckedChange={(checked) => onToggleAll(Boolean(checked))}
        aria-label={`Select all in ${title}`}
      />
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {title}
      </div>
      <Badge variant="secondary">{count}</Badge>
    </div>
  );
}

export default function CleanupSuggestionsPageContent() {
  const router = useRouter();
  const { toast } = useToast();
  const [suggestions, setSuggestions] = useState<Task[]>([]);
  const [expiredTasks, setExpiredTasks] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isScanning, setIsScanning] = useState(false);
  const [pendingAction, setPendingAction] = useState<CleanupAction | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showExpired, setShowExpired] = useState(false);
  const [confirmCompletedOpen, setConfirmCompletedOpen] = useState(false);

  const loadSuggestions = useCallback(async () => {
    try {
      const response = await apiFetch<SuggestionsResponse>(
        "/api/tasks/cleanup/suggestions",
        { cache: "no-store" }
      );
      setSuggestions(Array.isArray(response.suggestions) ? response.suggestions : []);
      setExpiredTasks(Array.isArray(response.expired) ? response.expired : []);
    } catch (error) {
      toast({
        title: "Could not load cleanup suggestions",
        description: error instanceof Error ? error.message : "Request failed.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void loadSuggestions();
  }, [loadSuggestions]);

  const suggestedExpire = useMemo(
    () => suggestions.filter((task) => task.cleanupStatus === "suggested_expire"),
    [suggestions]
  );
  const duplicateSuggested = useMemo(
    () => suggestions.filter((task) => task.cleanupStatus === "duplicate_suggested"),
    [suggestions]
  );
  const completedSuggested = useMemo(
    () => suggestions.filter((task) => task.cleanupStatus === "completed_suggested"),
    [suggestions]
  );

  const taskTitleById = useMemo(() => {
    const map = new Map<string, string>();
    [...suggestions, ...expiredTasks].forEach((task) => {
      if (task.id) map.set(task.id, task.title);
    });
    return map;
  }, [suggestions, expiredTasks]);

  const selectedIdsIn = useCallback(
    (tasks: Task[]) => tasks.filter((task) => selected.has(task.id)).map((task) => task.id),
    [selected]
  );

  const selectedExpireIds = selectedIdsIn(suggestedExpire);
  const selectedDuplicateIds = selectedIdsIn(duplicateSuggested);
  const selectedCompletedIds = selectedIdsIn(completedSuggested);
  const selectedExpiredIds = selectedIdsIn(expiredTasks);
  const selectedSuggestionIds = [
    ...selectedExpireIds,
    ...selectedDuplicateIds,
    ...selectedCompletedIds,
  ];
  const selectedCount =
    selectedSuggestionIds.length + selectedExpiredIds.length;

  const toggleSelect = useCallback((taskId: string, isSelected: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      if (isSelected) {
        next.add(taskId);
      } else {
        next.delete(taskId);
      }
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback((tasks: Task[], isSelected: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      tasks.forEach((task) => {
        if (isSelected) {
          next.add(task.id);
        } else {
          next.delete(task.id);
        }
      });
      return next;
    });
  }, []);

  const runScan = useCallback(async () => {
    setIsScanning(true);
    try {
      const result = await apiFetch<ScanResponse>("/api/tasks/cleanup/scan", {
        method: "POST",
        body: JSON.stringify({}),
      });
      toast({
        title: "Cleanup scan complete",
        description: `Scanned ${result.scanned ?? 0} tasks · ${result.flagged ?? 0} flagged · ${result.expired ?? 0} expired.`,
      });
      await loadSuggestions();
    } catch (error) {
      toast({
        title: "Cleanup scan failed",
        description: error instanceof Error ? error.message : "Request failed.",
        variant: "destructive",
      });
    } finally {
      setIsScanning(false);
    }
  }, [loadSuggestions, toast]);

  const performAction = useCallback(
    async (action: CleanupAction, taskIds: string[]) => {
      if (!taskIds.length) return;
      setPendingAction(action);
      try {
        const result = await apiFetch<ActionResponse>("/api/tasks/cleanup/actions", {
          method: "POST",
          body: JSON.stringify({ action, taskIds }),
        });
        toast({
          title: "Cleanup updated",
          description: `${result.updated ?? 0} task${(result.updated ?? 0) === 1 ? "" : "s"} updated.`,
        });
        setSelected((current) => {
          const next = new Set(current);
          taskIds.forEach((id) => next.delete(id));
          return next;
        });
        await loadSuggestions();
      } catch (error) {
        toast({
          title: "Cleanup action failed",
          description: error instanceof Error ? error.message : "Request failed.",
          variant: "destructive",
        });
      } finally {
        setPendingAction(null);
      }
    },
    [loadSuggestions, toast]
  );

  const isBusy = pendingAction !== null;
  const isEmpty =
    !isLoading &&
    suggestedExpire.length === 0 &&
    duplicateSuggested.length === 0 &&
    completedSuggested.length === 0 &&
    expiredTasks.length === 0;

  const runScanButton = (
    <Button size="sm" onClick={() => void runScan()} disabled={isScanning}>
      {isScanning ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <Sparkles className="mr-2 h-4 w-4" />
      )}
      Run scan
    </Button>
  );

  return (
    <div className="flex h-full flex-col bg-background">
      <DashboardHeader
        pageIcon={Sparkles}
        pageTitle={<h1 className="text-2xl font-bold font-headline">Cleanup Suggestions</h1>}
        description="Review low-value, duplicate, stale, and already-done tasks before they clutter your board."
      >
        <Button variant="ghost" size="sm" onClick={() => router.push("/review")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to review
        </Button>
        {runScanButton}
      </DashboardHeader>

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto w-full max-w-3xl space-y-8 p-4 pb-24">
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : isEmpty ? (
            <EmptyState
              className="h-full py-16"
              icon={Sparkles}
              title="Nothing to clean up"
              description="Run a scan to look for vanity, duplicate, stale, and already-done tasks across your workspace."
              action={runScanButton}
            />
          ) : (
            <>
              {suggestedExpire.length > 0 ? (
                <section className="space-y-3">
                  <SectionHeader
                    icon={Timer}
                    title="Suggested to expire"
                    count={suggestedExpire.length}
                    allSelected={
                      selectedExpireIds.length === suggestedExpire.length
                    }
                    someSelected={selectedExpireIds.length > 0}
                    onToggleAll={(checked) => toggleSelectAll(suggestedExpire, checked)}
                  />
                  <div className="space-y-2">
                    {suggestedExpire.map((task) => {
                      const expiresLabel = formatDate(task.expiresAt);
                      return (
                        <SuggestionRow
                          key={task.id}
                          task={task}
                          isSelected={selected.has(task.id)}
                          onToggleSelect={toggleSelect}
                          extraChips={
                            expiresLabel ? (
                              <span className="text-[11px] text-muted-foreground">
                                Auto-expires {expiresLabel}
                              </span>
                            ) : null
                          }
                        />
                      );
                    })}
                  </div>
                </section>
              ) : null}

              {duplicateSuggested.length > 0 ? (
                <section className="space-y-3">
                  <SectionHeader
                    icon={Copy}
                    title="Possible duplicates"
                    count={duplicateSuggested.length}
                    allSelected={
                      selectedDuplicateIds.length === duplicateSuggested.length
                    }
                    someSelected={selectedDuplicateIds.length > 0}
                    onToggleAll={(checked) =>
                      toggleSelectAll(duplicateSuggested, checked)
                    }
                  />
                  <div className="space-y-2">
                    {duplicateSuggested.map((task) => (
                      <SuggestionRow
                        key={task.id}
                        task={task}
                        isSelected={selected.has(task.id)}
                        onToggleSelect={toggleSelect}
                        detail={
                          task.duplicateOfTaskId ? (
                            <p className="text-xs text-muted-foreground">
                              Duplicate of{" "}
                              <span className="font-medium text-foreground">
                                {taskTitleById.get(task.duplicateOfTaskId) ||
                                  task.duplicateOfTaskId}
                              </span>
                            </p>
                          ) : null
                        }
                      />
                    ))}
                  </div>
                </section>
              ) : null}

              {completedSuggested.length > 0 ? (
                <section className="space-y-3">
                  <SectionHeader
                    icon={CheckCircle2}
                    title="Probably already done"
                    count={completedSuggested.length}
                    allSelected={
                      selectedCompletedIds.length === completedSuggested.length
                    }
                    someSelected={selectedCompletedIds.length > 0}
                    onToggleAll={(checked) =>
                      toggleSelectAll(completedSuggested, checked)
                    }
                  />
                  <div className="space-y-2">
                    {completedSuggested.map((task) => {
                      const evidence = task.cleanupEvidence?.[0]?.snippet;
                      return (
                        <SuggestionRow
                          key={task.id}
                          task={task}
                          isSelected={selected.has(task.id)}
                          onToggleSelect={toggleSelect}
                          detail={
                            evidence ? (
                              <blockquote className="border-l-2 border-border/70 pl-3 text-xs italic text-muted-foreground">
                                “{evidence}”
                              </blockquote>
                            ) : null
                          }
                        />
                      );
                    })}
                  </div>
                </section>
              ) : null}

              {expiredTasks.length > 0 ? (
                <section className="space-y-3">
                  <button
                    type="button"
                    onClick={() => setShowExpired((current) => !current)}
                    className="flex w-full items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                  >
                    <ChevronDown
                      className={cn(
                        "h-3.5 w-3.5 transition-transform",
                        !showExpired && "-rotate-90"
                      )}
                    />
                    <Clock className="h-3.5 w-3.5" />
                    Expired
                    <Badge variant="secondary">{expiredTasks.length}</Badge>
                  </button>
                  {showExpired ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 pl-1">
                        <Checkbox
                          checked={
                            selectedExpiredIds.length === expiredTasks.length
                              ? true
                              : selectedExpiredIds.length > 0
                                ? "indeterminate"
                                : false
                          }
                          onCheckedChange={(checked) =>
                            toggleSelectAll(expiredTasks, Boolean(checked))
                          }
                          aria-label="Select all expired tasks"
                        />
                        <span className="text-xs text-muted-foreground">
                          Select all — expired tasks are hidden from the board and can
                          only be restored.
                        </span>
                      </div>
                      {expiredTasks.map((task) => (
                        <div
                          key={task.id}
                          className="flex items-start gap-3 rounded-xl border border-dashed bg-muted/30 px-3 py-2.5"
                        >
                          <Checkbox
                            checked={selected.has(task.id)}
                            onCheckedChange={(checked) =>
                              toggleSelect(task.id, Boolean(checked))
                            }
                            aria-label={`Select ${task.title}`}
                            className="mt-0.5"
                          />
                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="min-w-0 truncate text-sm font-medium text-muted-foreground">
                                {task.title}
                              </p>
                              <CategoryChip category={task.cleanupCategory} />
                            </div>
                            {task.cleanupReason ? (
                              <p className="text-xs text-muted-foreground">
                                {task.cleanupReason}
                              </p>
                            ) : null}
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={isBusy}
                            onClick={() => void performAction("restore", [task.id])}
                          >
                            Restore
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </section>
              ) : null}
            </>
          )}
        </div>

        {selectedCount > 0 ? (
          <div className="sticky bottom-4 z-20 mx-auto w-full max-w-3xl px-4">
            <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-background/95 p-3 shadow-lg backdrop-blur">
              <span className="text-sm font-medium">{selectedCount} selected</span>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                {selectedExpireIds.length > 0 ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isBusy}
                    onClick={() => void performAction("expire", selectedExpireIds)}
                  >
                    Expire ({selectedExpireIds.length})
                  </Button>
                ) : null}
                {selectedDuplicateIds.length > 0 ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isBusy}
                    onClick={() =>
                      void performAction("mark_duplicate", selectedDuplicateIds)
                    }
                  >
                    Mark duplicate ({selectedDuplicateIds.length})
                  </Button>
                ) : null}
                {selectedCompletedIds.length > 0 ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isBusy}
                    onClick={() => setConfirmCompletedOpen(true)}
                  >
                    Mark completed ({selectedCompletedIds.length})
                  </Button>
                ) : null}
                {selectedSuggestionIds.length > 0 ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={isBusy}
                    onClick={() => void performAction("dismiss", selectedSuggestionIds)}
                  >
                    Dismiss ({selectedSuggestionIds.length})
                  </Button>
                ) : null}
                {selectedExpiredIds.length > 0 ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isBusy}
                    onClick={() => void performAction("restore", selectedExpiredIds)}
                  >
                    Restore ({selectedExpiredIds.length})
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={isBusy}
                  onClick={() => setSelected(new Set())}
                >
                  Clear
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <AlertDialog open={confirmCompletedOpen} onOpenChange={setConfirmCompletedOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark tasks as completed?</AlertDialogTitle>
            <AlertDialogDescription>
              {selectedCompletedIds.length} task
              {selectedCompletedIds.length === 1 ? "" : "s"} will be marked as done and
              synced to your board columns. You can restore them later if needed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmCompletedOpen(false);
                void performAction("mark_completed", selectedCompletedIds);
              }}
            >
              Mark completed
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
