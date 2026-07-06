"use client";

// src/components/dashboard/board/BoardTaskCard.tsx
//
// Dense board card (Priority 11): title, assignee, due date, priority badge,
// source meeting, client/company, and completion-evidence indicator. The
// drag-over drop indicator is absolutely positioned so card dimensions stay
// stable while dragging (no layout jump).

import React from "react";
import {
  Building2,
  Calendar,
  CheckCircle2,
  FileCheck2,
  GripVertical,
  MessagesSquare,
  MoreHorizontal,
} from "lucide-react";
import { format, isBefore, isValid, startOfToday } from "date-fns";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { Task } from "@/types/project";
import type { Person } from "@/types/person";
import type { TaskPriorityLabel } from "@/types/chat";

export type DragPosition = "before" | "after" | null;

const priorityStyles: Record<TaskPriorityLabel, string> = {
  low: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30 dark:text-emerald-400",
  medium: "bg-amber-500/15 text-amber-700 border-amber-500/30 dark:text-amber-400",
  high: "bg-rose-500/15 text-rose-600 border-rose-500/30 dark:text-rose-400",
  urgent: "bg-red-600/15 text-red-700 border-red-600/40 dark:text-red-400",
};

export const priorityLabelText: Record<TaskPriorityLabel, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

const formatDueDate = (value?: string | Date | null) => {
  if (!value) return null;
  const parsed = new Date(value);
  if (!isValid(parsed)) return null;
  return format(parsed, "MMM d");
};

const isOverdue = (value?: string | Date | null) => {
  if (!value) return false;
  const parsed = new Date(value);
  if (!isValid(parsed)) return false;
  return isBefore(parsed, startOfToday());
};

const getInitials = (value?: string | null) => {
  if (!value) return "?";
  const cleaned = value.trim();
  if (!cleaned) return "?";
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (!parts.length) return cleaned.slice(0, 2).toUpperCase();
  const initials = parts.slice(0, 2).map((part) => part[0]).join("");
  return initials.toUpperCase();
};

export function PriorityBadge({
  priority,
  reason,
}: {
  priority: TaskPriorityLabel;
  reason?: string | null;
}) {
  return (
    <span
      title={reason || undefined}
      className={cn(
        "text-xs font-medium px-2 py-0.5 rounded-full border",
        priorityStyles[priority]
      )}
    >
      {priorityLabelText[priority]}
    </span>
  );
}

const getCleanupBadgeMeta = (
  task: Pick<Task, "cleanupStatus" | "cleanupCategory">
): { label: string; className: string } | null => {
  switch (task.cleanupStatus) {
    case "suggested_expire":
      return task.cleanupCategory === "stale_follow_up" ||
        task.cleanupCategory === "expired_event"
        ? {
            label: "Stale?",
            className:
              "bg-slate-500/15 text-slate-600 border-slate-500/30 dark:text-slate-400",
          }
        : {
            label: "Vanity?",
            className:
              "bg-amber-500/15 text-amber-700 border-amber-500/30 dark:text-amber-400",
          };
    case "duplicate_suggested":
      return {
        label: "Duplicate?",
        className:
          "bg-violet-500/15 text-violet-600 border-violet-500/30 dark:text-violet-400",
      };
    case "completed_suggested":
      return {
        label: "Done?",
        className:
          "bg-emerald-500/15 text-emerald-600 border-emerald-500/30 dark:text-emerald-400",
      };
    default:
      return null;
  }
};

export function CleanupBadge({ task }: { task: Task }) {
  const meta = getCleanupBadgeMeta(task);
  if (!meta) return null;
  return (
    <span
      title={task.cleanupReason || undefined}
      className={cn(
        "text-xs font-medium px-2 py-0.5 rounded-full border",
        meta.className
      )}
    >
      {meta.label}
    </span>
  );
}

/** Small indicator shown when completion evidence exists on the task. */
export function CompletionEvidenceIndicator({ task }: { task: Task }) {
  const evidence = task.completionEvidence || [];
  if (!evidence.length && !task.completionSuggested) return null;
  const tooltip = evidence.length
    ? evidence
        .slice(0, 2)
        .map((entry) =>
          entry.speaker ? `${entry.speaker}: ${entry.snippet}` : entry.snippet
        )
        .join("\n")
    : "Completion suggested";
  return (
    <span
      title={tooltip}
      data-testid="completion-evidence"
      className="inline-flex items-center gap-1 rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-xs font-medium text-sky-600 dark:text-sky-400"
    >
      <FileCheck2 className="h-3 w-3" aria-hidden="true" />
      Evidence
    </span>
  );
}

export function AssigneeAvatar({
  label,
  person,
}: {
  label?: string | null;
  person?: Person | null;
}) {
  const name = person?.name || label || "Unassigned";
  const initials = getInitials(name);
  const frameClass =
    "h-7 w-7 rounded-full border-2 border-background flex items-center justify-center text-[10px] font-semibold overflow-hidden";

  if (!person) {
    if (label && label !== "Unassigned") {
      return (
        <div className={cn(frameClass, "bg-primary/10 text-primary")} title={name}>
          {initials}
        </div>
      );
    }
    return (
      <div className={cn(frameClass, "bg-muted")} title="Unassigned">
        <img src="/logo.svg" alt="TaskWiseAI" className="h-4 w-4" width={16} height={16} />
      </div>
    );
  }

  if (person.avatarUrl) {
    return (
      <img
        src={person.avatarUrl}
        alt={person.name}
        className="h-7 w-7 rounded-full border-2 border-background object-cover"
      />
    );
  }

  return (
    <div className={cn(frameClass, "bg-primary/10 text-primary")} title={name}>
      {initials}
    </div>
  );
}

export function TaskActionsMenu({
  onEdit,
  onDelete,
}: {
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="rounded-md p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
          type="button"
          data-no-drag
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onEdit}>Edit task</DropdownMenuItem>
        <DropdownMenuItem
          onSelect={onDelete}
          className="text-destructive focus:text-destructive"
        >
          Delete task
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AssigneeDropdown({
  task,
  assigneeName,
  assigneePerson,
  people,
  onAssign,
}: {
  task: Task;
  assigneeName: string;
  assigneePerson: Person | null;
  people: Person[];
  onAssign: (task: Task, person: Person | null) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" data-no-drag>
          <AssigneeAvatar label={assigneeName} person={assigneePerson} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onSelect={() => onAssign(task, null)}>
          Unassigned
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {people.length ? (
          people.map((person) => (
            <DropdownMenuItem
              key={person.id}
              onSelect={() => onAssign(task, person)}
            >
              {person.name}
            </DropdownMenuItem>
          ))
        ) : (
          <DropdownMenuItem disabled>No people yet</DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export interface BoardTaskCardProps {
  task: Task;
  assigneeName: string;
  assigneePerson: Person | null;
  /** Client/company the task resolves to (assignee's company), if any. */
  company?: string | null;
  people: Person[];
  isSelected: boolean;
  onToggleSelect: (taskId: string, selected: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
  onOpen: () => void;
  onAssign: (task: Task, person: Person | null) => void;
  onDragStart: (event: React.DragEvent<HTMLDivElement>) => void;
  onDragOver: (event: React.DragEvent<HTMLDivElement>) => void;
  onDrop: (event: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
  isDragging: boolean;
  isDragOver: boolean;
  dragPosition: DragPosition;
  dragDisabled: boolean;
}

export default function BoardTaskCard({
  task,
  assigneeName,
  assigneePerson,
  company,
  people,
  isSelected,
  onToggleSelect,
  onEdit,
  onDelete,
  onOpen,
  onAssign,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  isDragging,
  isDragOver,
  dragPosition,
  dragDisabled,
}: BoardTaskCardProps) {
  const dueLabel = formatDueDate(task.dueAt || null);
  const overdue = isOverdue(task.dueAt || null);
  const subtaskCount = task.subtaskCount || 0;
  const sourceMeeting = task.sourceSessionName?.trim() || null;

  return (
    <div
      draggable={!dragDisabled}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      className={cn(
        "group relative dense-card transition-[opacity,box-shadow,border-color]",
        dragDisabled ? "cursor-default" : "cursor-grab active:cursor-grabbing",
        isDragging && "opacity-50",
        isSelected && "border-primary/50 ring-1 ring-primary/30"
      )}
    >
      {/* Drop indicators are absolutely positioned so they never change the
          card's box size (no layout jump while dragging). */}
      {isDragOver && dragPosition === "before" ? (
        <span
          aria-hidden="true"
          data-testid="drop-indicator-before"
          className="pointer-events-none absolute inset-x-1 -top-2 h-1 rounded-full bg-primary"
        />
      ) : null}
      {isDragOver && dragPosition === "after" ? (
        <span
          aria-hidden="true"
          data-testid="drop-indicator-after"
          className="pointer-events-none absolute inset-x-1 -bottom-2 h-1 rounded-full bg-primary"
        />
      ) : null}

      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Checkbox
            checked={isSelected}
            onCheckedChange={(checked) => onToggleSelect(task.id, Boolean(checked))}
            aria-label={`Select ${task.title}`}
            className="h-4 w-4"
            data-no-drag
          />
          <PriorityBadge
            priority={task.priorityLabel || task.priority || "medium"}
            reason={task.priorityReason}
          />
          <CleanupBadge task={task} />
          <CompletionEvidenceIndicator task={task} />
        </div>
        <TaskActionsMenu onEdit={onEdit} onDelete={onDelete} />
      </div>

      <button
        type="button"
        data-no-drag
        onClick={onOpen}
        className="mt-2 text-left text-sm font-semibold text-foreground leading-snug hover:text-primary"
      >
        {task.title}
      </button>
      {task.description ? (
        <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
          {task.description}
        </p>
      ) : null}

      {sourceMeeting || company ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {sourceMeeting ? (
            <span
              className="flex min-w-0 items-center gap-1"
              title={`Source meeting: ${sourceMeeting}`}
            >
              <MessagesSquare className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{sourceMeeting}</span>
            </span>
          ) : null}
          {company ? (
            <span
              className="flex min-w-0 items-center gap-1"
              title={`Client: ${company}`}
            >
              <Building2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{company}</span>
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="mt-3 flex items-center justify-between border-t border-border/60 pt-2">
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {subtaskCount > 0 ? (
            <div className="flex items-center gap-1">
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>{subtaskCount} subtasks</span>
            </div>
          ) : null}
          {dueLabel ? (
            <div
              className={cn(
                "flex items-center gap-1",
                overdue && "font-medium text-rose-600 dark:text-rose-400"
              )}
              title={overdue ? "Overdue" : undefined}
            >
              <Calendar className="h-3.5 w-3.5" />
              <span>{dueLabel}</span>
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <AssigneeDropdown
            task={task}
            assigneeName={assigneeName}
            assigneePerson={assigneePerson}
            people={people}
            onAssign={onAssign}
          />
          <GripVertical className="h-4 w-4 text-muted-foreground" />
        </div>
      </div>
    </div>
  );
}
