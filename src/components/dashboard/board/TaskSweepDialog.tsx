"use client";

import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ArrowUp, CheckCircle2, Clock3, Sparkles, Trash2 } from "lucide-react";
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

export type TaskSweepAction = "keep" | "discard" | "snooze";
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
  taskAgeDays: number;
  inactiveDays: number;
  sweepFlags: TaskSweepFlag[];
  sweepScore: number;
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
  const [summary, setSummary] = useState({ keep: 0, discard: 0, snooze: 0 });

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
    setSummary({ keep: 0, discard: 0, snooze: 0 });
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
    setSummary({ keep: 0, discard: 0, snooze: 0 });
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

  const confirmDiscardWithReason = async () => {
    if (!pendingDiscardTask || isSubmitting) return;
    await advance(pendingDiscardTask, "discard", discardReason);
    setPendingDiscardTask(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px]">
        {phase === "setup" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                Task Sweep
              </DialogTitle>
              <DialogDescription>
                Clean clutter in short bursts. Sweep starts from your oldest tasks first.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="rounded-lg border bg-muted/40 p-3 text-sm">
                <div>
                  Candidates in this board: <strong>{candidates.length}</strong>
                </div>
                <div className="text-muted-foreground">
                  Flagged stale tasks: <strong>{staleCount}</strong>
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
            <DialogFooter>
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
                <span>Task Sweep</span>
                <Badge variant="secondary">{progressLabel}</Badge>
              </DialogTitle>
              <DialogDescription>
                Swipe right to keep, left to discard, up to snooze.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="h-2 w-full rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>

              <motion.div
                key={currentTask.id}
                drag
                dragElastic={0.2}
                dragMomentum={false}
                onDragEnd={handleSwipeEnd}
                className="rounded-xl border bg-card p-5 shadow-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  {currentTask.sweepFlags.map((flag) => (
                    <Badge key={flag} variant="outline">
                      {flagLabel[flag]}
                    </Badge>
                  ))}
                  <Badge variant="secondary">Age {currentTask.taskAgeDays}d</Badge>
                  <Badge variant="secondary">Inactive {currentTask.inactiveDays}d</Badge>
                </div>
                <h3 className="mt-3 text-lg font-semibold">{currentTask.title}</h3>
                {currentTask.description ? (
                  <p className="mt-2 text-sm text-muted-foreground">{currentTask.description}</p>
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground">No description</p>
                )}
                <div className="mt-4 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                  <div>
                    Source: <span className="text-foreground">{currentTask.sourceSessionName || "General"}</span>
                  </div>
                  <div>
                    Due:{" "}
                    <span className="text-foreground">
                      {currentTask.dueAt
                        ? new Date(currentTask.dueAt).toLocaleDateString()
                        : "No due date"}
                    </span>
                  </div>
                </div>
              </motion.div>

              <div className="grid grid-cols-3 gap-2">
                <Button
                  variant="outline"
                  className="gap-2"
                  onClick={() => void handleAction("discard")}
                  disabled={isSubmitting}
                >
                  <Trash2 className="h-4 w-4" />
                  Discard
                </Button>
                <Button
                  variant="outline"
                  className="gap-2"
                  onClick={() => void handleAction("snooze")}
                  disabled={isSubmitting}
                >
                  <ArrowUp className="h-4 w-4" />
                  Snooze
                </Button>
                <Button
                  className="gap-2"
                  onClick={() => void handleAction("keep")}
                  disabled={isSubmitting}
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Keep
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
            <div className="space-y-4">
              <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                <p className="font-medium">{pendingDiscardTask.title}</p>
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
            <DialogFooter>
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
                Nice pass. Start another short sweep anytime from this screen.
              </DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-3 gap-2 text-sm">
              <div className="rounded-lg border bg-muted/30 p-3 text-center">
                <div className="text-muted-foreground">Keep</div>
                <div className="text-lg font-semibold">{summary.keep}</div>
              </div>
              <div className="rounded-lg border bg-muted/30 p-3 text-center">
                <div className="text-muted-foreground">Discard</div>
                <div className="text-lg font-semibold">{summary.discard}</div>
              </div>
              <div className="rounded-lg border bg-muted/30 p-3 text-center">
                <div className="text-muted-foreground">Snooze</div>
                <div className="text-lg font-semibold">{summary.snooze}</div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
              <Button onClick={resetWizard}>Start another sweep</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
