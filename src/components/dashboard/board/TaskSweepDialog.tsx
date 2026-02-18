"use client";

import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  CalendarClock,
  CheckCircle2,
  CheckCheck,
  Clock3,
  Flag,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

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

const parsePositiveInt = (value: string, fallback: number, maxValue: number) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maxValue);
};

const formatDateLabel = (value?: string | Date | null) => {
  if (!value) return "No date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No date";
  return date.toLocaleDateString();
};

const priorityLabelMap: Record<string, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

const priorityTone: Record<string, string> = {
  high: "bg-rose-100 text-rose-700 border-rose-200",
  medium: "bg-amber-100 text-amber-700 border-amber-200",
  low: "bg-emerald-100 text-emerald-700 border-emerald-200",
};

const flagTone: Record<TaskSweepFlag, string> = {
  old_timer: "bg-indigo-100 text-indigo-700 border-indigo-200",
  vague: "bg-fuchsia-100 text-fuchsia-700 border-fuchsia-200",
  overdue_loop: "bg-rose-100 text-rose-700 border-rose-200",
  overdue: "bg-amber-100 text-amber-700 border-amber-200",
  inactive: "bg-slate-100 text-slate-700 border-slate-200",
};

type SweepSummary = {
  keep: number;
  discard: number;
  snooze: number;
  complete: number;
};

export default function TaskSweepDialog({
  open,
  onOpenChange,
  candidates,
  onApplyAction,
  defaultSessionSize = 10,
  maxSessionSize = 50,
}: TaskSweepDialogProps) {
  const [phase, setPhase] = useState<WizardPhase>("setup");
  const [sessionSizeInput, setSessionSizeInput] = useState(String(defaultSessionSize));
  const [queue, setQueue] = useState<TaskSweepCandidate[]>([]);
  const [index, setIndex] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingDiscardTask, setPendingDiscardTask] = useState<TaskSweepCandidate | null>(null);
  const [discardReason, setDiscardReason] = useState<Exclude<TaskSweepDiscardReason, "unspecified">>(
    "low_intent"
  );
  const [summary, setSummary] = useState<SweepSummary>({
    keep: 0,
    discard: 0,
    snooze: 0,
    complete: 0,
  });

  const currentTask = queue[index] ?? null;
  const staleCount = useMemo(
    () => candidates.filter((candidate: any) => candidate.sweepFlags.length > 0).length,
    [candidates]
  );

  const resetWizard = () => {
    setPhase("setup");
    setSessionSizeInput(String(defaultSessionSize));
    setQueue([]);
    setIndex(0);
    setSummary({ keep: 0, discard: 0, snooze: 0, complete: 0 });
    setPendingDiscardTask(null);
    setDiscardReason("low_intent");
    setIsSubmitting(false);
  };

  useEffect(() => {
    if (open) {
      resetWizard();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const beginSession = () => {
    const sessionSize = parsePositiveInt(sessionSizeInput, defaultSessionSize, maxSessionSize);
    const nextQueue = candidates.slice(0, sessionSize);
    setSessionSizeInput(String(sessionSize));
    setQueue(nextQueue);
    setIndex(0);
    setSummary({ keep: 0, discard: 0, snooze: 0, complete: 0 });
    setPendingDiscardTask(null);
    setDiscardReason("low_intent");
    setPhase(nextQueue.length ? "sweeping" : "done");
  };

  const advance = async (
    task: TaskSweepCandidate,
    action: TaskSweepAction,
    reason?: TaskSweepDiscardReason
  ) => {
    setIsSubmitting(true);
    try {
      await onApplyAction(task, action, { reason });
      setSummary((prev) => ({
        keep: prev.keep + (action === "keep" ? 1 : 0),
        discard: prev.discard + (action === "discard" ? 1 : 0),
        snooze: prev.snooze + (action === "snooze" ? 1 : 0),
        complete: prev.complete + (action === "complete" ? 1 : 0),
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
  };

  const handleAction = async (action: TaskSweepAction) => {
    if (!currentTask || isSubmitting) return;
    if (action === "discard") {
      const nextDiscardCount = summary.discard + 1;
      const shouldAskReason = nextDiscardCount % 3 === 0;
      if (shouldAskReason) {
        setPendingDiscardTask(currentTask);
        setPhase("reason");
        return;
      }
      await advance(currentTask, "discard", "unspecified");
      return;
    }
    await advance(currentTask, action);
  };

  const handleSwipeEnd = async (
    _event: MouseEvent | TouchEvent | PointerEvent,
    info: { offset: { x: number; y: number } }
  ) => {
    if (!currentTask || phase !== "sweeping" || isSubmitting) return;
    if (info.offset.y >= 100) {
      await handleAction("complete");
      return;
    }
    if (info.offset.x >= 120) {
      await handleAction("keep");
      return;
    }
    if (info.offset.x <= -120) {
      await handleAction("discard");
      return;
    }
    if (info.offset.y <= -100) {
      await handleAction("snooze");
    }
  };

  const progressLabel =
    queue.length > 0 ? `${Math.min(index + 1, queue.length)} / ${queue.length}` : "0 / 0";
  const progressPercent = queue.length ? Math.min(((index + 1) / queue.length) * 100, 100) : 0;
  const currentPriorityKey = String(currentTask?.priority || "medium").toLowerCase();
  const currentPriorityLabel =
    priorityLabelMap[currentPriorityKey] || currentTask?.priority || "Medium";
  const currentPriorityClass =
    priorityTone[currentPriorityKey] || "bg-slate-100 text-slate-700 border-slate-200";
  const currentScorePercent = currentTask
    ? Math.max(10, Math.min(100, Math.round((currentTask.sweepScore / 10) * 100)))
    : 0;
  const currentAIConfidencePercent = currentTask
    ? Math.max(1, Math.min(99, Math.round(currentTask.aiConfidence * 100)))
    : 0;

  const confirmDiscardWithReason = async () => {
    if (!pendingDiscardTask || isSubmitting) return;
    await advance(pendingDiscardTask, "discard", discardReason);
    setPendingDiscardTask(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[760px] overflow-hidden p-0">
        <div className="border-b bg-gradient-to-r from-sky-50 via-indigo-50 to-emerald-50 px-6 py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              <Sparkles className="h-4 w-4 text-indigo-600" />
              Task Sweep
            </div>
            <Badge className="border-indigo-200 bg-indigo-100 text-indigo-700">
              Session cleanup
            </Badge>
          </div>
        </div>

        <div className="p-6">
          {phase === "setup" && (
            <>
              <DialogHeader>
                <DialogTitle className="text-xl">Clean task clutter in short bursts</DialogTitle>
                <DialogDescription>
                  Start from oldest tasks, then quickly keep, complete, snooze, or discard.
                </DialogDescription>
              </DialogHeader>
              <div className="mt-5 space-y-5">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-sky-200 bg-sky-50 p-4">
                    <div className="text-xs uppercase tracking-wide text-sky-700">Candidates</div>
                    <div className="mt-1 text-2xl font-semibold text-sky-900">{candidates.length}</div>
                  </div>
                  <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4">
                    <div className="text-xs uppercase tracking-wide text-indigo-700">Flagged stale</div>
                    <div className="mt-1 text-2xl font-semibold text-indigo-900">{staleCount}</div>
                  </div>
                </div>

                <div className="rounded-xl border bg-muted/30 p-4">
                  <div className="text-sm font-medium">Gesture and action map</div>
                  <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                    <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-2 text-emerald-700">
                      <CheckCircle2 className="h-4 w-4" />
                      Swipe right / Keep
                    </div>
                    <div className="flex items-center gap-2 rounded-md border border-rose-200 bg-rose-50 p-2 text-rose-700">
                      <ArrowLeft className="h-4 w-4" />
                      Swipe left / Discard
                    </div>
                    <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-amber-700">
                      <ArrowUp className="h-4 w-4" />
                      Swipe up / Snooze
                    </div>
                    <div className="flex items-center gap-2 rounded-md border border-sky-200 bg-sky-50 p-2 text-sky-700">
                      <ArrowDown className="h-4 w-4" />
                      Swipe down / Complete
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="task-sweep-session-size">Tasks this session</Label>
                  <Input
                    id="task-sweep-session-size"
                    inputMode="numeric"
                    value={sessionSizeInput}
                    onChange={(event) => setSessionSizeInput(event.target.value.replace(/[^\d]/g, ""))}
                    placeholder="10"
                  />
                  <p className="text-xs text-muted-foreground">
                    Default is 10 tasks. You can pick up to {maxSessionSize} per sweep.
                  </p>
                </div>
              </div>
              <DialogFooter className="mt-6">
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button onClick={beginSession} disabled={!candidates.length}>
                  Start sweep
                </Button>
              </DialogFooter>
            </>
          )}

          {phase === "sweeping" && currentTask && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center justify-between gap-3">
                  <span>Review task</span>
                  <Badge variant="secondary">{progressLabel}</Badge>
                </DialogTitle>
                <DialogDescription>
                  Use actions or gestures to process tasks quickly.
                </DialogDescription>
              </DialogHeader>
              <div className="mt-4 space-y-4">
                <div className="h-2 w-full rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-sky-500 via-indigo-500 to-emerald-500 transition-all"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>

                <motion.div
                  key={currentTask.id}
                  drag
                  dragElastic={0.2}
                  dragMomentum={false}
                  onDragEnd={handleSwipeEnd}
                  className="rounded-2xl border bg-card p-5 shadow-sm"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    {currentTask.sweepFlags.map((flag) => (
                      <Badge key={flag} className={`border ${flagTone[flag]}`}>
                        {flagLabel[flag]}
                      </Badge>
                    ))}
                    <Badge className={`border ${currentPriorityClass}`}>
                      Priority {currentPriorityLabel}
                    </Badge>
                    <Badge variant="secondary">Age {currentTask.taskAgeDays}d</Badge>
                    <Badge variant="secondary">Inactive {currentTask.inactiveDays}d</Badge>
                  </div>

                  <h3 className="mt-3 text-lg font-semibold">{currentTask.title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {currentTask.description || "No description available."}
                  </p>

                  <div className="mt-4 space-y-2 rounded-lg border bg-muted/20 p-3">
                    <div className="text-xs font-medium text-muted-foreground">Stale score</div>
                    <div className="h-1.5 w-full rounded-full bg-slate-200">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-amber-400 via-orange-500 to-rose-500"
                        style={{ width: `${currentScorePercent}%` }}
                      />
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Score {currentTask.sweepScore.toFixed(1)} / 10
                    </div>
                  </div>

                  <div
                    className={
                      currentTask.aiShouldRemove
                        ? "mt-3 space-y-2 rounded-lg border border-rose-200 bg-rose-50 p-3"
                        : "mt-3 space-y-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3"
                    }
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div
                        className={
                          currentTask.aiShouldRemove
                            ? "text-xs font-semibold text-rose-700"
                            : "text-xs font-semibold text-emerald-700"
                        }
                      >
                        AI recommendation
                      </div>
                      <Badge
                        className={
                          currentTask.aiShouldRemove
                            ? "border-rose-200 bg-rose-100 text-rose-700"
                            : "border-emerald-200 bg-emerald-100 text-emerald-700"
                        }
                      >
                        {currentTask.aiShouldRemove ? "Suggest remove" : "Suggest keep"}
                      </Badge>
                    </div>
                    <div
                      className={
                        currentTask.aiShouldRemove
                          ? "text-xs text-rose-700"
                          : "text-xs text-emerald-700"
                      }
                    >
                      {currentTask.aiReason}
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-white/70">
                      <div
                        className={
                          currentTask.aiShouldRemove
                            ? "h-full rounded-full bg-rose-500"
                            : "h-full rounded-full bg-emerald-500"
                        }
                        style={{ width: `${currentAIConfidencePercent}%` }}
                      />
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Confidence {currentAIConfidencePercent}% based on {currentTask.aiInteractionCount} prior interactions
                    </div>
                  </div>

                  <div className="mt-4 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                    <div className="flex items-center gap-2 rounded-md border bg-muted/20 px-3 py-2">
                      <Flag className="h-3.5 w-3.5 text-indigo-600" />
                      Status:{" "}
                      <span className="font-medium text-foreground">
                        {currentTask.statusLabel || currentTask.status || "Unknown"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 rounded-md border bg-muted/20 px-3 py-2">
                      <User className="h-3.5 w-3.5 text-sky-600" />
                      Assignee:{" "}
                      <span className="font-medium text-foreground">
                        {currentTask.assigneeName || "Unassigned"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 rounded-md border bg-muted/20 px-3 py-2">
                      <CalendarClock className="h-3.5 w-3.5 text-amber-600" />
                      Due: <span className="font-medium text-foreground">{formatDateLabel(currentTask.dueAt)}</span>
                    </div>
                    <div className="flex items-center gap-2 rounded-md border bg-muted/20 px-3 py-2">
                      <Clock3 className="h-3.5 w-3.5 text-emerald-600" />
                      Last updated:{" "}
                      <span className="font-medium text-foreground">
                        {formatDateLabel(currentTask.lastUpdated)}
                      </span>
                    </div>
                  </div>

                  <details className="mt-3 rounded-md border bg-muted/10 p-3 text-xs text-muted-foreground">
                    <summary className="cursor-pointer font-medium text-foreground">
                      More task details
                    </summary>
                    <div className="mt-2 grid gap-1 sm:grid-cols-2">
                      <div>
                        Source:{" "}
                        <span className="text-foreground">{currentTask.sourceSessionName || "General"}</span>
                      </div>
                      <div>
                        Type: <span className="text-foreground">{currentTask.taskType || "General"}</span>
                      </div>
                      <div>
                        Created: <span className="text-foreground">{formatDateLabel(currentTask.createdAt)}</span>
                      </div>
                      <div>
                        Task ID: <span className="text-foreground">{currentTask.id}</span>
                      </div>
                    </div>
                  </details>
                </motion.div>

                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant="outline"
                    className="gap-2 border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
                    onClick={() => void handleAction("discard")}
                    disabled={isSubmitting}
                  >
                    <Trash2 className="h-4 w-4" />
                    Discard
                  </Button>
                  <Button
                    variant="outline"
                    className="gap-2 border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                    onClick={() => void handleAction("keep")}
                    disabled={isSubmitting}
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    Keep
                  </Button>
                  <Button
                    variant="outline"
                    className="gap-2 border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
                    onClick={() => void handleAction("snooze")}
                    disabled={isSubmitting}
                  >
                    <ArrowUp className="h-4 w-4" />
                    Snooze
                  </Button>
                  <Button
                    className="gap-2 bg-sky-600 text-white hover:bg-sky-700"
                    onClick={() => void handleAction("complete")}
                    disabled={isSubmitting}
                  >
                    <CheckCheck className="h-4 w-4" />
                    Complete
                  </Button>
                </div>
              </div>
            </>
          )}

          {phase === "reason" && pendingDiscardTask && (
            <>
              <DialogHeader>
                <DialogTitle>Why was this task irrelevant?</DialogTitle>
                <DialogDescription>
                  This helps TaskWise learn what to suppress in future suggestions.
                </DialogDescription>
              </DialogHeader>
              <div className="mt-4 space-y-4">
                <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm">
                  <p className="font-medium text-rose-800">{pendingDiscardTask.title}</p>
                </div>
                <RadioGroup
                  value={discardReason}
                  onValueChange={(value) =>
                    setDiscardReason(value as Exclude<TaskSweepDiscardReason, "unspecified">)
                  }
                  className="space-y-2"
                >
                  <div className="flex items-center space-x-2 rounded-md border p-3">
                    <RadioGroupItem value="low_intent" id="reason-low-intent" />
                    <Label htmlFor="reason-low-intent">{reasonLabel.low_intent}</Label>
                  </div>
                  <div className="flex items-center space-x-2 rounded-md border p-3">
                    <RadioGroupItem value="sync_issue" id="reason-sync-issue" />
                    <Label htmlFor="reason-sync-issue">{reasonLabel.sync_issue}</Label>
                  </div>
                  <div className="flex items-center space-x-2 rounded-md border p-3">
                    <RadioGroupItem value="delegation_issue" id="reason-delegation-issue" />
                    <Label htmlFor="reason-delegation-issue">{reasonLabel.delegation_issue}</Label>
                  </div>
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
                <Button onClick={() => void confirmDiscardWithReason()} disabled={isSubmitting}>
                  Save and continue
                </Button>
              </DialogFooter>
            </>
          )}

          {phase === "done" && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Clock3 className="h-5 w-5 text-primary" />
                  Sweep complete
                </DialogTitle>
                <DialogDescription>
                  Session finished. You can start another sweep with a fresh task count anytime.
                </DialogDescription>
              </DialogHeader>
              <div className="mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-center">
                  <div className="text-emerald-700">Keep</div>
                  <div className="text-lg font-semibold text-emerald-900">{summary.keep}</div>
                </div>
                <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-center">
                  <div className="text-sky-700">Complete</div>
                  <div className="text-lg font-semibold text-sky-900">{summary.complete}</div>
                </div>
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-center">
                  <div className="text-amber-700">Snooze</div>
                  <div className="text-lg font-semibold text-amber-900">{summary.snooze}</div>
                </div>
                <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-center">
                  <div className="text-rose-700">Discard</div>
                  <div className="text-lg font-semibold text-rose-900">{summary.discard}</div>
                </div>
              </div>
              <DialogFooter className="mt-6">
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  Close
                </Button>
                <Button onClick={resetWizard}>Start another sweep</Button>
              </DialogFooter>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
