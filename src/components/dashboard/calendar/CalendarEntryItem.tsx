// src/components/dashboard/calendar/CalendarEntryItem.tsx
"use client";

import React from "react";
import { Building2, CalendarDays, Video } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CalendarDayEntry } from "./types";
import { formatEntryTime } from "./calendar-utils";

export const entryPillClass = (entry: CalendarDayEntry): string => {
  if (entry.kind === "meeting") {
    return "bg-primary/10 text-primary hover:bg-primary/15 dark:bg-primary/20 dark:hover:bg-primary/25";
  }
  if (entry.kind === "google") {
    return "border border-border bg-background text-muted-foreground hover:bg-muted/50 dark:bg-transparent dark:hover:bg-muted/30";
  }
  if (entry.tone === "overdue") {
    return "bg-destructive/10 text-destructive hover:bg-destructive/15 dark:bg-destructive/25 dark:hover:bg-destructive/30";
  }
  if (entry.tone === "urgent") {
    return "bg-rose-100 text-rose-700 hover:bg-rose-200/70 dark:bg-rose-500/20 dark:text-rose-300 dark:hover:bg-rose-500/25";
  }
  return "bg-muted text-foreground/80 hover:bg-muted/70 dark:bg-muted/50 dark:hover:bg-muted/60";
};

const entryIcon = (entry: CalendarDayEntry): React.ElementType | null => {
  if (entry.kind === "meeting") return entry.isClientMeeting ? Building2 : Video;
  if (entry.kind === "google") return CalendarDays;
  return null;
};

const taskDotClass = (entry: CalendarDayEntry): string => {
  if (entry.kind !== "task") return "bg-muted-foreground/40";
  if (entry.tone === "overdue") return "bg-destructive";
  if (entry.tone === "urgent") return "bg-rose-500 dark:bg-rose-400";
  if ((entry.priorityLabel || "").toLowerCase() === "high") {
    return "bg-amber-500 dark:bg-amber-400";
  }
  return "bg-muted-foreground/40";
};

interface EntryProps {
  entry: CalendarDayEntry;
  onClick: (entry: CalendarDayEntry) => void;
}

/** Compact one-line pill used by the month grid and its overflow popover. */
export function CalendarEntryPill({ entry, onClick }: EntryProps) {
  const Icon = entryIcon(entry);
  return (
    <button
      type="button"
      data-testid="calendar-entry-pill"
      onClick={() => onClick(entry)}
      title={entry.title}
      className={cn(
        "flex w-full items-center gap-1 rounded px-1.5 py-0.5 text-left text-[11px] leading-4 transition-colors",
        entryPillClass(entry)
      )}
    >
      {Icon && <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />}
      <span className="min-w-0 flex-1 truncate">{entry.title}</span>
    </button>
  );
}

/** Slightly richer stacked card used by the week columns and agenda list. */
export function CalendarEntryCard({ entry, onClick }: EntryProps) {
  const Icon = entryIcon(entry);
  const time = formatEntryTime(entry);
  return (
    <button
      type="button"
      data-testid="calendar-entry-card"
      onClick={() => onClick(entry)}
      className={cn(
        "flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors",
        entryPillClass(entry)
      )}
    >
      <span className="flex items-center gap-1.5">
        {Icon ? (
          <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        ) : (
          <span
            className={cn("h-2 w-2 shrink-0 rounded-full", taskDotClass(entry))}
            aria-hidden="true"
          />
        )}
        <span className="min-w-0 flex-1 truncate text-xs font-medium">
          {entry.title}
        </span>
      </span>
      {entry.kind === "task" ? (
        <span className="pl-3.5 text-[11px] text-muted-foreground">
          {[
            entry.assigneeName || "Unassigned",
            entry.tone === "overdue"
              ? "Overdue"
              : entry.priorityLabel
                ? entry.priorityLabel
                : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
      ) : (
        time && (
          <span className="pl-5 text-[11px] text-muted-foreground">{time}</span>
        )
      )}
    </button>
  );
}
