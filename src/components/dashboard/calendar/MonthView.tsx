// src/components/dashboard/calendar/MonthView.tsx
"use client";

import React from "react";
import {
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { CalendarDayEntry } from "./types";
import { dayKey } from "./calendar-utils";
import { CalendarEntryPill } from "./CalendarEntryItem";

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const MAX_VISIBLE_PILLS = 3;

interface MonthViewProps {
  anchor: Date;
  entriesByDay: Map<string, CalendarDayEntry[]>;
  onEntryClick: (entry: CalendarDayEntry) => void;
}

export default function MonthView({
  anchor,
  entriesByDay,
  onEntryClick,
}: MonthViewProps) {
  const gridStart = startOfWeek(startOfMonth(anchor), { weekStartsOn: 1 });
  const gridEnd = endOfWeek(endOfMonth(anchor), { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

  return (
    <div
      data-view="month"
      className="overflow-hidden rounded-lg border bg-card"
    >
      <div className="grid grid-cols-7 border-b bg-muted/40 dark:bg-muted/20">
        {WEEKDAY_LABELS.map((label) => (
          <div
            key={label}
            className="px-2 py-1.5 text-center text-xs font-medium text-muted-foreground"
          >
            {label}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day, index) => {
          const key = dayKey(day);
          const entries = entriesByDay.get(key) ?? [];
          const inMonth = isSameMonth(day, anchor);
          const today = isToday(day);
          const overflowCount = entries.length - MAX_VISIBLE_PILLS;
          return (
            <div
              key={key}
              data-testid="month-day-cell"
              className={cn(
                "min-h-[6.5rem] space-y-1 border-b p-1.5",
                index % 7 !== 0 && "border-l",
                !inMonth && "bg-muted/20 dark:bg-muted/10"
              )}
            >
              <div className="flex justify-end">
                <span
                  className={cn(
                    "inline-flex h-6 w-6 items-center justify-center rounded-full text-xs",
                    today &&
                      "font-semibold text-primary ring-1 ring-primary",
                    !today && !inMonth && "text-muted-foreground/60",
                    !today && inMonth && "text-foreground/80"
                  )}
                >
                  {format(day, "d")}
                </span>
              </div>
              {entries.slice(0, MAX_VISIBLE_PILLS).map((entry) => (
                <CalendarEntryPill
                  key={`${entry.kind}-${entry.id}`}
                  entry={entry}
                  onClick={onEntryClick}
                />
              ))}
              {overflowCount > 0 && (
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="w-full rounded px-1.5 py-0.5 text-left text-[11px] text-muted-foreground transition-colors hover:bg-muted/60 dark:hover:bg-muted/40"
                    >
                      +{overflowCount} more
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-72 p-2" align="start">
                    <p className="px-1 pb-1.5 text-xs font-medium text-muted-foreground">
                      {format(day, "EEEE, MMM d")}
                    </p>
                    <div className="max-h-64 space-y-1 overflow-y-auto">
                      {entries.map((entry) => (
                        <CalendarEntryPill
                          key={`${entry.kind}-${entry.id}`}
                          entry={entry}
                          onClick={onEntryClick}
                        />
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
