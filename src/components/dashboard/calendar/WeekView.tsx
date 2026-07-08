// src/components/dashboard/calendar/WeekView.tsx
"use client";

import React from "react";
import {
  eachDayOfInterval,
  endOfWeek,
  format,
  isToday,
  startOfWeek,
} from "date-fns";
import { cn } from "@/lib/utils";
import type { CalendarDayEntry, CalendarReminderItem } from "./types";
import { dayKey } from "./calendar-utils";
import { CalendarEntryCard } from "./CalendarEntryItem";
import { ReminderChip } from "./AgendaView";

interface WeekViewProps {
  anchor: Date;
  entriesByDay: Map<string, CalendarDayEntry[]>;
  remindersByDay?: Map<string, CalendarReminderItem[]>;
  onEntryClick: (entry: CalendarDayEntry) => void;
}

export default function WeekView({
  anchor,
  entriesByDay,
  remindersByDay,
  onEntryClick,
}: WeekViewProps) {
  const days = eachDayOfInterval({
    start: startOfWeek(anchor, { weekStartsOn: 1 }),
    end: endOfWeek(anchor, { weekStartsOn: 1 }),
  });

  return (
    <div
      data-view="week"
      className="grid grid-cols-1 gap-2 md:grid-cols-7"
    >
      {days.map((day) => {
        const entries = entriesByDay.get(dayKey(day)) ?? [];
        const reminders = remindersByDay?.get(dayKey(day)) ?? [];
        const today = isToday(day);
        return (
          <div
            key={dayKey(day)}
            data-testid="week-day-column"
            className="flex min-h-[9rem] flex-col rounded-lg border bg-card"
          >
            <div
              className={cn(
                "flex items-center justify-between gap-1 border-b px-2 py-1.5 text-xs font-medium",
                today ? "text-primary" : "text-muted-foreground"
              )}
            >
              <span>{format(day, "EEE d")}</span>
              {today && (
                <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary dark:bg-primary/20">
                  Today
                </span>
              )}
            </div>
            <div className="flex-grow space-y-1.5 p-1.5">
              {entries.length === 0 && reminders.length === 0 ? (
                <p className="px-1 pt-1 text-[11px] text-muted-foreground/60">
                  Nothing scheduled
                </p>
              ) : (
                <>
                  {entries.map((entry) => (
                    <CalendarEntryCard
                      key={`${entry.kind}-${entry.id}`}
                      entry={entry}
                      onClick={onEntryClick}
                    />
                  ))}
                  {reminders.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {reminders.map((reminder) => (
                        <ReminderChip key={reminder.id} reminder={reminder} />
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
