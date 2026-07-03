// src/components/dashboard/calendar/AgendaView.tsx
"use client";

import React from "react";
import { eachDayOfInterval, format, isToday, startOfDay } from "date-fns";
import { AlertTriangle, Archive, Bell, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  REMINDER_KIND_LABELS,
  type CalendarDayEntry,
  type CalendarRange,
  type CalendarReminderItem,
  type CalendarWarnings,
} from "./types";
import { dayKey } from "./calendar-utils";
import { CalendarEntryCard } from "./CalendarEntryItem";

interface AgendaViewProps {
  range: CalendarRange;
  warnings: CalendarWarnings;
  entriesByDay: Map<string, CalendarDayEntry[]>;
  remindersByDay?: Map<string, CalendarReminderItem[]>;
  onEntryClick: (entry: CalendarDayEntry) => void;
}

const chipClass =
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors";

/** Small outline pill for a scheduled Slack reminder (also used by WeekView). */
export function ReminderChip({ reminder }: { reminder: CalendarReminderItem }) {
  const runAt = new Date(reminder.runAt);
  const timeLabel = Number.isNaN(runAt.getTime())
    ? reminder.runAt
    : format(runAt, "MMM d, p");
  const kindLabel = REMINDER_KIND_LABELS[reminder.kind] || reminder.kind;
  return (
    <span
      data-testid="reminder-chip"
      title={`${kindLabel} reminder · ${timeLabel}`}
      className="inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
    >
      <Bell className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span className="truncate">Reminder: {reminder.taskTitle}</span>
    </span>
  );
}

export function AgendaWarningsStrip({
  warnings,
}: {
  warnings: CalendarWarnings;
}) {
  const { overdueCount, cleanupSuggestedCount, expiredCount } = warnings;
  if (overdueCount <= 0 && cleanupSuggestedCount <= 0 && expiredCount <= 0) {
    return null;
  }
  return (
    <div
      data-testid="warnings-strip"
      className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3"
    >
      {overdueCount > 0 && (
        <span
          className={cn(
            chipClass,
            "border-transparent bg-destructive/10 text-destructive dark:bg-destructive/25"
          )}
        >
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
          {overdueCount} overdue
        </span>
      )}
      {cleanupSuggestedCount > 0 && (
        <a
          href="/review/cleanup"
          className={cn(
            chipClass,
            "border-transparent bg-amber-100 text-amber-800 hover:bg-amber-200/70 dark:bg-amber-500/20 dark:text-amber-300 dark:hover:bg-amber-500/25"
          )}
        >
          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
          {cleanupSuggestedCount} cleanup suggestions
        </a>
      )}
      {expiredCount > 0 && (
        <a
          href="/review/cleanup"
          className={cn(
            chipClass,
            "border-border bg-muted/60 text-muted-foreground hover:bg-muted dark:bg-muted/40 dark:hover:bg-muted/60"
          )}
        >
          <Archive className="h-3.5 w-3.5" aria-hidden="true" />
          {expiredCount} expired
        </a>
      )}
    </div>
  );
}

export default function AgendaView({
  range,
  warnings,
  entriesByDay,
  remindersByDay,
  onEntryClick,
}: AgendaViewProps) {
  const days = eachDayOfInterval({
    start: startOfDay(range.from),
    end: startOfDay(range.to),
  }).filter(
    (day) =>
      (entriesByDay.get(dayKey(day)) ?? []).length > 0 ||
      (remindersByDay?.get(dayKey(day)) ?? []).length > 0
  );

  return (
    <div data-view="agenda" className="space-y-4">
      <AgendaWarningsStrip warnings={warnings} />
      {days.length === 0 ? (
        <div className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
          Nothing scheduled or due in the next 30 days.
        </div>
      ) : (
        days.map((day) => {
          const entries = entriesByDay.get(dayKey(day)) ?? [];
          const reminders = remindersByDay?.get(dayKey(day)) ?? [];
          const today = isToday(day);
          return (
            <section key={dayKey(day)} data-testid="agenda-day">
              <h3
                className={cn(
                  "text-sm font-semibold",
                  today ? "text-primary" : "text-foreground"
                )}
              >
                {today ? "Today" : format(day, "EEEE, MMM d")}
              </h3>
              <div className="mt-1.5 space-y-1.5">
                {entries.map((entry) => (
                  <CalendarEntryCard
                    key={`${entry.kind}-${entry.id}`}
                    entry={entry}
                    onClick={onEntryClick}
                  />
                ))}
                {reminders.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {reminders.map((reminder) => (
                      <ReminderChip key={reminder.id} reminder={reminder} />
                    ))}
                  </div>
                )}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}
