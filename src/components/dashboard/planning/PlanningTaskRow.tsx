// src/components/dashboard/planning/PlanningTaskRow.tsx
//
// One task row inside a planning section: title, priority badge (same idiom
// as the Board), due-date chip (destructive when overdue), assignee, flag
// chips for the OTHER applicable planningFlags, and quick controls.
// Planning decides what matters — execution status stays on the Board, so
// the only status mutation offered here is "Mark done".
"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  Calendar as CalendarIcon,
  Check,
  ExternalLink,
  Loader2,
  UserPlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { format, isValid } from "date-fns";
import type { TaskPriorityLabel } from "@/types/chat";
import type {
  PlanningFlags,
  PlanningSectionKey,
  PlanningTask,
} from "./planning-overview";
import { PLANNING_SECTION_META } from "./planning-overview";

// Same priority badge tones the Board uses (BoardPageContent), incl. urgent.
const PRIORITY_STYLES: Record<TaskPriorityLabel, string> = {
  low: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30 dark:text-emerald-400",
  medium: "bg-amber-500/15 text-amber-700 border-amber-500/30 dark:text-amber-400",
  high: "bg-rose-500/15 text-rose-600 border-rose-500/30 dark:text-rose-400",
  urgent: "bg-red-600/15 text-red-700 border-red-600/40 dark:text-red-400",
};

const PRIORITY_LABELS: Record<TaskPriorityLabel, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

type ChipFlag = Exclude<keyof PlanningFlags, "overdue">;

export const PLANNING_FLAG_CHIPS: Record<ChipFlag, { label: string; className: string }> = {
  blocked: {
    label: "Blocked",
    className:
      "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:border-amber-400/40 dark:bg-amber-400/10 dark:text-amber-300",
  },
  waitingOnClient: {
    label: "Client",
    className:
      "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:border-sky-400/40 dark:bg-sky-400/10 dark:text-sky-300",
  },
  needsOwner: {
    label: "No owner",
    className:
      "border-violet-500/40 bg-violet-500/10 text-violet-700 dark:border-violet-400/40 dark:bg-violet-400/10 dark:text-violet-300",
  },
  needsDueDate: {
    label: "No due date",
    className:
      "border-slate-400/50 bg-slate-400/10 text-slate-700 dark:border-slate-500/40 dark:bg-slate-500/10 dark:text-slate-300",
  },
};

const CHIP_FLAG_ORDER: ChipFlag[] = [
  "blocked",
  "waitingOnClient",
  "needsOwner",
  "needsDueDate",
];

const toDate = (value: PlanningTask["dueAt"]): Date | undefined => {
  if (!value) return undefined;
  const parsed = value instanceof Date ? value : new Date(value);
  return isValid(parsed) ? parsed : undefined;
};

const resolvePriority = (task: PlanningTask): TaskPriorityLabel => {
  const label = task.priorityLabel || task.priority;
  return label && label in PRIORITY_LABELS ? (label as TaskPriorityLabel) : "medium";
};

/** Same fallback the chat sources use: source meeting when known, else Review. */
export const resolvePlanningTaskHref = (task: PlanningTask): string =>
  task.sourceSessionId ? `/meetings/${task.sourceSessionId}` : "/review";

export interface PlanningTaskRowProps {
  task: PlanningTask;
  sectionKey: PlanningSectionKey;
  onRequestAssign: (task: PlanningTask) => void;
  onSetDueDate: (task: PlanningTask, date: Date) => Promise<void> | void;
  onMarkDone: (task: PlanningTask) => Promise<void> | void;
  isMutating?: boolean;
}

export default function PlanningTaskRow({
  task,
  sectionKey,
  onRequestAssign,
  onSetDueDate,
  onMarkDone,
  isMutating = false,
}: PlanningTaskRowProps) {
  const [isDuePopoverOpen, setIsDuePopoverOpen] = useState(false);

  const flags = task.planningFlags || {};
  const suppressedFlag = PLANNING_SECTION_META[sectionKey]?.suppressedFlag;
  const chips = CHIP_FLAG_ORDER.filter(
    (flag) => flag !== suppressedFlag && flags[flag] === true
  );

  const priority = resolvePriority(task);
  const dueDate = toDate(task.dueAt);
  const dueLabel = dueDate ? format(dueDate, "MMM d") : null;
  const isOverdue = flags.overdue === true;
  const assigneeName =
    task.assigneeName ||
    (task.assignee as { name?: string } | undefined)?.name ||
    null;

  return (
    <div className="flex items-start justify-between gap-2 rounded-lg border border-border/50 bg-background/60 p-2.5">
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="truncate text-sm font-medium text-foreground" title={task.title}>
          {task.title}
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            title={task.priorityReason || undefined}
            className={cn(
              "rounded-full border px-2 py-0.5 text-xs font-medium",
              PRIORITY_STYLES[priority]
            )}
          >
            {PRIORITY_LABELS[priority]}
          </span>
          {dueLabel && (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
                isOverdue
                  ? "border-destructive/40 bg-destructive/10 text-destructive"
                  : "border-border/60 bg-muted/50 text-muted-foreground"
              )}
            >
              <CalendarIcon className="h-3 w-3" />
              {dueLabel}
              {isOverdue && <span className="sr-only">(overdue)</span>}
            </span>
          )}
          <span className="max-w-[140px] truncate text-xs text-muted-foreground">
            {assigneeName || "Unassigned"}
          </span>
          {chips.map((flag) => (
            <span
              key={flag}
              className={cn(
                "rounded-full border px-2 py-0.5 text-[11px] font-medium",
                PLANNING_FLAG_CHIPS[flag].className
              )}
            >
              {PLANNING_FLAG_CHIPS[flag].label}
            </span>
          ))}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
          title="Assign"
          aria-label={`Assign "${task.title}"`}
          disabled={isMutating}
          onClick={() => onRequestAssign(task)}
        >
          <UserPlus className="h-3.5 w-3.5" />
        </Button>
        <Popover open={isDuePopoverOpen} onOpenChange={setIsDuePopoverOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              title="Set due date"
              aria-label={`Set due date for "${task.title}"`}
              disabled={isMutating}
            >
              <CalendarIcon className="h-3.5 w-3.5" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="end">
            <Calendar
              mode="single"
              selected={dueDate}
              onSelect={(date: Date | undefined) => {
                if (!date) return;
                setIsDuePopoverOpen(false);
                void onSetDueDate(task, date);
              }}
              initialFocus
            />
          </PopoverContent>
        </Popover>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-emerald-600 dark:hover:text-emerald-400"
          title="Mark done"
          aria-label={`Mark "${task.title}" done`}
          disabled={isMutating}
          onClick={() => void onMarkDone(task)}
        >
          {isMutating ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Check className="h-3.5 w-3.5" />
          )}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
          title="Open"
          aria-label={`Open "${task.title}"`}
          asChild
        >
          <Link href={resolvePlanningTaskHref(task)}>
            <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        </Button>
      </div>
    </div>
  );
}
