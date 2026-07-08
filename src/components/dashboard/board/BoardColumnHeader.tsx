"use client";

// src/components/dashboard/board/BoardColumnHeader.tsx
//
// Column header for the board view (Priority 11): category label, task count
// with a WIP cue over the threshold, quick-add input, per-column sort control,
// and the existing column management menu.

import React, { useRef, useState } from "react";
import { ArrowUpDown, MoreHorizontal, Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { BoardStatus, BoardStatusCategory } from "@/types/board";
import {
  COLUMN_WIP_THRESHOLD,
  type ColumnSortMode,
} from "@/components/dashboard/board/board-filters";

const CATEGORY_LABELS: Record<BoardStatusCategory, string> = {
  todo: "To do",
  inprogress: "In progress",
  done: "Done",
  recurring: "Recurring",
};

const SORT_LABELS: Record<ColumnSortMode, string> = {
  manual: "Manual order",
  priority: "Priority",
  due: "Due date",
  recency: "Recently added",
};

const applyHexAlpha = (hex: string, alpha: number) => {
  if (!hex) return `rgba(0, 0, 0, ${alpha})`;
  let value = hex.replace("#", "").trim();
  if (value.length === 3) {
    value = value
      .split("")
      .map((ch) => ch + ch)
      .join("");
  }
  if (value.length !== 6) {
    return `rgba(0, 0, 0, ${alpha})`;
  }
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  if ([r, g, b].some((part) => Number.isNaN(part))) {
    return `rgba(0, 0, 0, ${alpha})`;
  }
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

export interface BoardColumnHeaderProps {
  status: BoardStatus;
  /** Tasks visible in the column after filters. */
  visibleCount: number;
  /** All tasks in the column regardless of filters (drives the WIP cue). */
  totalCount: number;
  wipThreshold?: number;
  sortMode: ColumnSortMode;
  onSortChange: (mode: ColumnSortMode) => void;
  /** Creates a task in this column; resolve true to clear the input. */
  onQuickAdd: (title: string) => Promise<boolean> | boolean;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onChangeColor: () => void;
  onDelete: () => void;
  deleteDisabled: boolean;
}

export default function BoardColumnHeader({
  status,
  visibleCount,
  totalCount,
  wipThreshold = COLUMN_WIP_THRESHOLD,
  sortMode,
  onSortChange,
  onQuickAdd,
  onSelectAll,
  onClearSelection,
  onChangeColor,
  onDelete,
  deleteDisabled,
}: BoardColumnHeaderProps) {
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
  const [quickAddTitle, setQuickAddTitle] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const overWip = totalCount > wipThreshold;
  const isFiltered = visibleCount !== totalCount;

  const submitQuickAdd = async () => {
    const title = quickAddTitle.trim();
    if (!title || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const created = await onQuickAdd(title);
      if (created) {
        setQuickAddTitle("");
        inputRef.current?.focus();
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="sticky top-0 rounded-t-xl border-b border-t-2 border-border/60"
      style={{
        backgroundColor: applyHexAlpha(status.color, 0.12),
        borderTopColor: status.color,
      }}
    >
      <div className="flex items-center justify-between p-3">
        <div className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden="true"
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: status.color }}
          />
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-foreground">
              {status.label}
            </h3>
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              {CATEGORY_LABELS[status.category] || status.category}
              {status.isTerminal ? " · Terminal" : ""}
            </p>
          </div>
          <span
            title={
              overWip
                ? `Over WIP threshold (${wipThreshold})`
                : isFiltered
                ? `${visibleCount} of ${totalCount} tasks match the filters`
                : undefined
            }
            className={cn(
              "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium",
              overWip
                ? "border border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-400"
                : "bg-muted text-muted-foreground"
            )}
          >
            {isFiltered ? `${visibleCount}/${totalCount}` : totalCount}
          </span>
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            className={cn(
              "rounded-md p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground",
              isQuickAddOpen && "bg-muted text-foreground"
            )}
            type="button"
            title="Quick add task"
            aria-label={`Quick add task to ${status.label}`}
            onClick={() => {
              setIsQuickAddOpen((prev) => !prev);
              requestAnimationFrame(() => inputRef.current?.focus());
            }}
          >
            <Plus className="h-4 w-4" />
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className={cn(
                  "rounded-md p-1 transition hover:bg-muted hover:text-foreground",
                  sortMode !== "manual" ? "text-primary" : "text-muted-foreground"
                )}
                type="button"
                title={`Sort: ${SORT_LABELS[sortMode]}`}
                aria-label={`Sort ${status.label} column`}
              >
                <ArrowUpDown className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Sort column</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={sortMode}
                onValueChange={(value) => onSortChange(value as ColumnSortMode)}
              >
                {(Object.keys(SORT_LABELS) as ColumnSortMode[]).map((mode) => (
                  <DropdownMenuRadioItem key={mode} value={mode}>
                    {SORT_LABELS[mode]}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="rounded-md p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
                type="button"
                aria-label={`Column actions for ${status.label}`}
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onSelectAll}>
                Select all tasks
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onClearSelection}>
                Clear selection
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onChangeColor}>
                Change color
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={onDelete}
                disabled={deleteDisabled}
                className="text-destructive focus:text-destructive"
              >
                Delete stage
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {isQuickAddOpen ? (
        <div className="px-3 pb-2">
          <Input
            ref={inputRef}
            value={quickAddTitle}
            disabled={isSubmitting}
            onChange={(event) => setQuickAddTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void submitQuickAdd();
              }
              if (event.key === "Escape") {
                event.stopPropagation();
                setIsQuickAddOpen(false);
                setQuickAddTitle("");
              }
            }}
            placeholder="Task title, then Enter"
            aria-label={`New task title for ${status.label}`}
            className="h-8 bg-card text-sm"
          />
        </div>
      ) : null}
    </div>
  );
}
