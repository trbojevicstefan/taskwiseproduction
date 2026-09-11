"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { PanInfo } from "framer-motion";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  CalendarClock,
  CheckCheck,
  CheckCircle2,
  Clock3,
  Flag,
  Keyboard,
  Sparkles,
  Trash2,
  User,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Slider } from "@/components/ui/slider";
import {
  filterSweepCandidatesByStrictness,
  resolveSweepActionFromDrag,
  resolveSweepActionFromKey,
} from "@/components/dashboard/board/task-sweep-interactions";

export type TaskSweepAction = "keep" | "discard" | "snooze" | "complete";
export type TaskSweepDiscardReason =
  | "low_intent"
  | "sync_issue"
  | "delegation_issue"
  | "unspecified";
export type TaskSweepFlag =
  | "old_timer"
  | "vague"
  | "overdue_loop"
  | "overdue"
  | "inactive";

export interface TaskSweepCandidate {
  id: string;
  title: string;
  description?: string | null;
  dueAt?: string | Date | null;
  sourceSessionName?: string | null;
  priority?: string | null;
  status?: string | null;
  statusLabel?: string | null;
  assigneeName?: string | null;
  taskType?: string | null;
  createdAt?: string | Date | null;
  lastUpdated?: string | Date | null;
  taskAgeDays: number;
  inactiveDays: number;
  sweepFlags: TaskSweepFlag[];
  sweepScore: number;
  aiShouldRemove: boolean;
  aiConfidence: number;
  aiReason: string;
  aiInteractionCount: number;
}

interface TaskSweepDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  candidates: TaskSweepCandidate[];
  onApplyAction: (
    task: TaskSweepCandidate,
    action: TaskSweepAction,
    options?: { reason?: TaskSweepDiscardReason }
  ) => Promise<void>;
  defaultSessionSize?: number;
  maxSessionSize?: number;
}

type WizardPhase = "setup" | "sweeping" | "reason" | "done";
type SweepSummary = Record<TaskSweepAction, number>;

const flagLabel: Record<TaskSweepFlag, string> = {
  old_timer: "Old timer",
  vague: "Vague",
  overdue_loop: "Overdue loop",
  overdue: "Overdue",
  inactive: "Inactive",
};

const reasonLabel: Record<Exclude<TaskSweepDiscardReason, "unspecified">, string> = {
  low_intent: "Never intended to do it",
  sync_issue: "Already finished elsewhere",
  delegation_issue: "Not my responsibility",
};

const flagTone: Record<TaskSweepFlag, string> = {
  old_timer: "border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-300",
  vague: "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700 dark:border-fuchsia-900 dark:bg-fuchsia-950/40 dark:text-fuchsia-300",
  overdue_loop: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300",
  overdue: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300",
  inactive: "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300",
};

const emptySummary = (): SweepSummary => ({
  keep: 0,
  discard: 0,
  snooze: 0,
  complete: 0,
});

const formatDateLabel = (value?: string | Date | null) => {
  if (!value) return "No date";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "No date" : date.toLocaleDateString();
};

const clampSessionSize = (value: number, maxSessionSize: number) =>
  Math.max(1, Math.min(Math.round(value), maxSessionSize));

export default function TaskSweepDialog({
  open,
  onOpenChange,
  candidates,
  onApplyAction,
  defaultSessionSize = 10,
  maxSessionSize = 50,
}: TaskSweepDialogProps) {
  const maximum = Math.max(1, Math.min(maxSessionSize, Math.max(candidates.length, 1)));
  const [phase, setPhase] = useState<WizardPhase>("setup");
  const [sessionSize, setSessionSize] = useState(
    clampSessionSize(defaultSessionSize, maximum)
  );
  const [strictness, setStrictness] = useState(30);
  const [queue, setQueue] = useState<TaskSweepCandidate[]>([]);
  const [index, setIndex] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingDiscardTask, setPendingDiscardTask] =
    useState<TaskSweepCandidate | null>(null);
  const [discardReason, setDiscardReason] = useState<
    Exclude<TaskSweepDiscardReason, "unspecified">
  >("low_intent");
  const [summary, setSummary] = useState<SweepSummary>(emptySummary);

  const eligibleCandidates = useMemo(
    () => filterSweepCandidatesByStrictness(candidates, strictness),
    [candidates, strictness]
  );
  const currentTask = queue[index] ?? null;
  const staleCount = useMemo(
    () => candidates.filter((candidate) => candidate.sweepFlags.length > 0).length,
    [candidates]
  );

  const resetWizard = useCallback(() => {
    setPhase("setup");
    setSessionSize(clampSessionSize(defaultSessionSize, maximum));
    setStrictness(30);
    setQueue([]);
    setIndex(0);
    setSummary(emptySummary());
    setPendingDiscardTask(null);
    setDiscardReason("low_intent");
    setIsSubmitting(false);
  }, [defaultSessionSize, maximum]);

  useEffect(() => {
    if (open) resetWizard();
  }, [open, resetWizard]);

  useEffect(() => {
    setSessionSize((value) => clampSessionSize(value, maximum));
  }, [maximum]);

  const beginSession = () => {
    const nextQueue = eligibleCandidates.slice(
      0,
      clampSessionSize(sessionSize, Math.max(eligibleCandidates.length, 1))
    );
    setQueue(nextQueue);
    setIndex(0);
    setSummary(emptySummary());
    setPendingDiscardTask(null);
    setPhase(nextQueue.length ? "sweeping" : "done");
  };

  const advance = useCallback(
    async (
      task: TaskSweepCandidate,
      action: TaskSweepAction,
      reason?: TaskSweepDiscardReason
    ) => {
      setIsSubmitting(true);
      try {
        await onApplyAction(task, action, { reason });
        setSummary((previous) => ({
          ...previous,
          [action]: previous[action] + 1,
        }));
        const nextIndex = index + 1;
        if (nextIndex >= queue.length) {
          setPhase("done");
        } else {
          setIndex(nextIndex);
          setPhase("sweeping");
        }
      } finally {
        setIsSubmitting(false);
      }
    },
    [index, onApplyAction, queue.length]
  );

  const handleAction = useCallback(
    async (action: TaskSweepAction) => {
      if (!currentTask || isSubmitting) return;
      if (action === "discard") {
        const nextDiscardCount = summary.discard + 1;
        if (nextDiscardCount % 3 === 0) {
          setPendingDiscardTask(currentTask);
          setPhase("reason");
          return;
        }
        await advance(currentTask, "discard", "unspecified");
        return;
      }
      await advance(currentTask, action);
    },
    [advance, currentTask, isSubmitting, summary.discard]
  );

  useEffect(() => {
    if (!open || phase !== "sweeping") return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      const action = resolveSweepActionFromKey(event.key);
      if (!action) return;
      event.preventDefault();
      void handleAction(action);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleAction, open, phase]);

  const confirmDiscardWithReason = async () => {
    if (!pendingDiscardTask || isSubmitting) return;
    await advance(pendingDiscardTask, "discard", discardReason);
    setPendingDiscardTask(null);
  };

  const progressLabel = queue.length
    ? `${Math.min(index + 1, queue.length)} / ${queue.length}`
    : "0 / 0";
  const progressPercent = queue.length
    ? Math.min(((index + 1) / queue.length) * 100, 100)
    : 0;
  const confidencePercent = currentTask
    ? Math.max(1, Math.min(99, Math.round(currentTask.aiConfidence * 100)))
    : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-[780px] overflow-y-auto p-0">
        <div className="border-b bg-muted/30 px-5 py-4 sm:px-6">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Sparkles className="h-4 w-4 text-primary" />
              Swipe Sweep
            </div>
            <Badge variant="outline">Board declutter</Badge>
          </div>
        </div>

        <div className="p-5 sm:p-6">
          {phase === "setup" && (
            <>
              <DialogHeader>
                <DialogTitle className="text-xl">Clear the board without opening every task</DialogTitle>
                <DialogDescription>
                  Choose how aggressive the cleanup should be, then swipe or use the keyboard to triage each candidate.
                </DialogDescription>
              </DialogHeader>

              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                <Stat label="Candidates" value={candidates.length} />
                <Stat label="Flagged stale" value={staleCount} />
                <Stat label="After strictness" value={eligibleCandidates.length} />
              </div>

              <div className="mt-6 space-y-6 rounded-2xl border bg-card p-4 sm:p-5">
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <Label>Cleanup strictness</Label>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Higher values only show tasks with stronger stale/noise signals.
                      </p>
                    </div>
                    <Badge variant="secondary">{strictness}%</Badge>
                  </div>
                  <Slider
                    aria-label="Cleanup strictness"
                    min={0}
                    max={90}
                    step={10}
                    value={[strictness]}
                    onValueChange={([value]) => setStrictness(value)}
                  />
                  <div className="flex justify-between text-[11px] text-muted-foreground">
                    <span>Review broadly</span>
                    <span>Only obvious clutter</span>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <Label>Tasks this session</Label>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Short bursts are easier to finish than a giant cleanup project.
                      </p>
                    </div>
                    <Badge variant="secondary">{Math.min(sessionSize, Math.max(eligibleCandidates.length, 1))}</Badge>
                  </div>
                  <Slider
                    aria-label="Tasks this session"
                    min={1}
                    max={Math.max(1, Math.min(maxSessionSize, eligibleCandidates.length || 1))}
                    step={1}
                    value={[Math.min(sessionSize, Math.max(1, eligibleCandidates.length))]}
                    onValueChange={([value]) => setSessionSize(value)}
                    disabled={eligibleCandidates.length === 0}
                  />
                  <div className="flex flex-wrap gap-2">
                    {[5, 10, 20].map((preset) => (
                      <Button
                        key={preset}
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setSessionSize(Math.min(preset, Math.max(eligibleCandidates.length, 1)))}
                        disabled={eligibleCandidates.length === 0}
                      >
                        {preset}
                      </Button>
                    ))}
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setSessionSize(Math.min(maxSessionSize, Math.max(eligibleCandidates.length, 1)))}
                      disabled={eligibleCandidates.length === 0}
                    >
                      All
                    </Button>
                  </div>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                <ActionLegend icon={ArrowRight} label="Keep" shortcut="→ / K" />
                <ActionLegend icon={ArrowLeft} label="Discard" shortcut="← / D" />
                <ActionLegend icon={ArrowUp} label="Snooze" shortcut="↑ / S" />
                <ActionLegend icon={ArrowDown} label="Complete" shortcut="↓ / C" />
              </div>

              <DialogFooter className="mt-6">
                <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                <Button onClick={beginSession} disabled={!eligibleCandidates.length}>Start swipe sweep</Button>
              </DialogFooter>
            </>
          )}

          {phase === "sweeping" && currentTask && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center justify-between gap-3">
                  <span>Decide, don&apos;t administrate</span>
                  <Badge variant="secondary">{progressLabel}</Badge>
                </DialogTitle>
                <DialogDescription>
                  Swipe the card, use arrow keys, or use the buttons below. Nothing is auto-removed.
                </DialogDescription>
              </DialogHeader>

              <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full bg-primary transition-all" style={{ width: `${progressPercent}%` }} />
              </div>

              <div className="relative mt-5 min-h-[390px]">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={currentTask.id}
                    drag={!isSubmitting}
                    dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
                    dragElastic={0.7}
                    onDragEnd={(
                      _event: MouseEvent | TouchEvent | PointerEvent,
                      info: PanInfo
                    ) => {
                      const action = resolveSweepActionFromDrag(info.offset);
                      if (action) void handleAction(action);
                    }}
                    initial={{ opacity: 0, scale: 0.98 }}
                    animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
                    exit={{ opacity: 0, scale: 0.96 }}
                    transition={{ duration: 0.16 }}
                    className="cursor-grab touch-none rounded-2xl border bg-card p-5 shadow-md active:cursor-grabbing sm:p-6"
                  >
                    <div className="flex flex-wrap gap-2">
                      {currentTask.sweepFlags.map((flag) => (
                        <Badge key={flag} variant="outline" className={flagTone[flag]}>{flagLabel[flag]}</Badge>
                      ))}
                      <Badge variant="secondary">Noise score {currentTask.sweepScore.toFixed(1)}/10</Badge>
                      <Badge variant="secondary">Age {currentTask.taskAgeDays}d</Badge>
                    </div>

                    <h3 className="mt-4 text-xl font-semibold leading-tight">{currentTask.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      {currentTask.description || "No description. That can itself be a sign this task needs a decision."}
                    </p>

                    <div className={currentTask.aiShouldRemove
                      ? "mt-5 rounded-xl border border-rose-200 bg-rose-50 p-4 dark:border-rose-900 dark:bg-rose-950/30"
                      : "mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950/30"}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-sm font-semibold">AI recommendation</div>
                        <Badge variant="outline">{currentTask.aiShouldRemove ? "Suggest discard" : "Suggest keep"} · {confidencePercent}%</Badge>
                      </div>
                      <p className="mt-2 text-sm leading-6">{currentTask.aiReason}</p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        Based on {currentTask.aiInteractionCount} prior interactions. Recommendation is advisory only.
                      </p>
                    </div>

                    <div className="mt-5 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                      <TaskMeta icon={Flag} label="Status" value={currentTask.statusLabel || currentTask.status || "Unknown"} />
                      <TaskMeta icon={User} label="Assignee" value={currentTask.assigneeName || "Unassigned"} />
                      <TaskMeta icon={CalendarClock} label="Due" value={formatDateLabel(currentTask.dueAt)} />
                      <TaskMeta icon={Clock3} label="Updated" value={formatDateLabel(currentTask.lastUpdated)} />
                    </div>

                    <div className="mt-5 flex items-center justify-center gap-2 text-xs text-muted-foreground">
                      <Keyboard className="h-4 w-4" />
                      Drag 80px in a direction, or use arrows / K D S C
                    </div>
                  </motion.div>
                </AnimatePresence>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Button variant="outline" onClick={() => void handleAction("discard")} disabled={isSubmitting} className="gap-2">
                  <Trash2 className="h-4 w-4" /> Discard
                </Button>
                <Button variant="outline" onClick={() => void handleAction("keep")} disabled={isSubmitting} className="gap-2">
                  <CheckCircle2 className="h-4 w-4" /> Keep
                </Button>
                <Button variant="outline" onClick={() => void handleAction("snooze")} disabled={isSubmitting} className="gap-2">
                  <ArrowUp className="h-4 w-4" /> Snooze
                </Button>
                <Button onClick={() => void handleAction("complete")} disabled={isSubmitting} className="gap-2">
                  <CheckCheck className="h-4 w-4" /> Complete
                </Button>
              </div>
            </>
          )}

          {phase === "reason" && pendingDiscardTask && (
            <>
              <DialogHeader>
                <DialogTitle>Why did this not belong on your board?</DialogTitle>
                <DialogDescription>
                  We ask occasionally so future cleanup suggestions become more useful.
                </DialogDescription>
              </DialogHeader>
              <div className="mt-4 space-y-4">
                <div className="rounded-lg border bg-muted/30 p-3 text-sm font-medium">{pendingDiscardTask.title}</div>
                <RadioGroup
                  value={discardReason}
                  onValueChange={(value) => setDiscardReason(value as Exclude<TaskSweepDiscardReason, "unspecified">)}
                  className="space-y-2"
                >
                  {(Object.keys(reasonLabel) as Array<Exclude<TaskSweepDiscardReason, "unspecified">>).map((reason) => (
                    <div key={reason} className="flex items-center space-x-2 rounded-md border p-3">
                      <RadioGroupItem value={reason} id={`reason-${reason}`} />
                      <Label htmlFor={`reason-${reason}`}>{reasonLabel[reason]}</Label>
                    </div>
                  ))}
                </RadioGroup>
              </div>
              <DialogFooter className="mt-6">
                <Button
                  variant="outline"
                  onClick={() => {
                    setPendingDiscardTask(null);
                    setPhase("sweeping");
                  }}
                  disabled={isSubmitting}
                >
                  Back
                </Button>
                <Button onClick={() => void confirmDiscardWithReason()} disabled={isSubmitting}>Discard & continue</Button>
              </DialogFooter>
            </>
          )}

          {phase === "done" && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-primary" /> Sweep complete
                </DialogTitle>
                <DialogDescription>
                  You made explicit decisions instead of carrying ambiguous tasks forward.
                </DialogDescription>
              </DialogHeader>
              <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="Kept" value={summary.keep} />
                <Stat label="Discarded" value={summary.discard} />
                <Stat label="Snoozed" value={summary.snooze} />
                <Stat label="Completed" value={summary.complete} />
              </div>
              <p className="mt-4 text-sm text-muted-foreground">
                Processed {Object.values(summary).reduce((total, value) => total + value, 0)} task decisions in this sweep.
              </p>
              <DialogFooter className="mt-6">
                <Button variant="outline" onClick={() => onOpenChange(false)}>Back to board</Button>
                <Button onClick={resetWizard}>Start another sweep</Button>
              </DialogFooter>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border bg-muted/20 p-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
}

function ActionLegend({
  icon: Icon,
  label,
  shortcut,
}: {
  icon: React.ElementType;
  label: string;
  shortcut: string;
}) {
  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <div className="flex items-center gap-2 font-medium"><Icon className="h-4 w-4" /> {label}</div>
      <div className="mt-1 text-muted-foreground">{shortcut}</div>
    </div>
  );
}

function TaskMeta({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-md border bg-muted/20 px-3 py-2">
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span>{label}: <span className="font-medium text-foreground">{value}</span></span>
    </div>
  );
}
