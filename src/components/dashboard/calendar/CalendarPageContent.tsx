// src/components/dashboard/calendar/CalendarPageContent.tsx
"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { addDays, addMonths, addWeeks } from "date-fns";
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiFetch } from "@/lib/api";
import { subscribeRealtimeUpdates } from "@/lib/realtime-client";
import { useIntegrations } from "@/contexts/IntegrationsContext";
import {
  AGENDA_SPAN_DAYS,
  buildDayEntries,
  formatRangeLabel,
  getViewRange,
  isCalendarView,
  readStoredCalendarView,
  storeCalendarView,
} from "./calendar-utils";
import {
  EMPTY_CALENDAR_DATA,
  EMPTY_CALENDAR_WARNINGS,
  type CalendarData,
  type CalendarDayEntry,
  type CalendarView,
  type GoogleCalendarOverlayEvent,
} from "./types";
import MonthView from "./MonthView";
import WeekView from "./WeekView";
import AgendaView from "./AgendaView";

type CalendarApiResponse = {
  ok?: boolean;
  data?: Partial<CalendarData>;
} & Partial<CalendarData>;

const normalizeCalendarPayload = (payload: CalendarApiResponse): CalendarData => {
  const source =
    payload && typeof payload === "object" && payload.data
      ? payload.data
      : payload;
  return {
    meetings: Array.isArray(source?.meetings) ? source.meetings : [],
    tasks: Array.isArray(source?.tasks) ? source.tasks : [],
    warnings: source?.warnings ?? EMPTY_CALENDAR_WARNINGS,
  };
};

function CalendarLoadingSkeleton() {
  return (
    <div className="space-y-3" data-testid="calendar-skeleton">
      <div className="grid grid-cols-7 gap-2">
        {Array.from({ length: 7 }).map((_, index) => (
          <Skeleton key={index} className="h-6" />
        ))}
      </div>
      {Array.from({ length: 5 }).map((_, row) => (
        <div key={row} className="grid grid-cols-7 gap-2">
          {Array.from({ length: 7 }).map((_, col) => (
            <Skeleton key={col} className="h-24" />
          ))}
        </div>
      ))}
    </div>
  );
}

export default function CalendarPageContent() {
  const router = useRouter();
  const { isGoogleTasksConnected } = useIntegrations();
  const [view, setView] = useState<CalendarView>(() => readStoredCalendarView());
  const [anchorDate, setAnchorDate] = useState<Date>(() => new Date());
  const [data, setData] = useState<CalendarData>(EMPTY_CALENDAR_DATA);
  const [googleEvents, setGoogleEvents] = useState<GoogleCalendarOverlayEvent[]>(
    []
  );
  const [hasLoaded, setHasLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const range = useMemo(() => getViewRange(view, anchorDate), [view, anchorDate]);
  const rangeLabel = useMemo(
    () => formatRangeLabel(view, anchorDate, range),
    [view, anchorDate, range]
  );

  const refreshRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    let active = true;
    const fromIso = range.from.toISOString();
    const toIso = range.to.toISOString();

    const load = async (silent: boolean) => {
      if (!silent) {
        setIsLoading(true);
        setError(null);
      }
      try {
        const payload = await apiFetch<CalendarApiResponse>(
          `/api/calendar?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`
        );
        if (active) {
          setData(normalizeCalendarPayload(payload));
        }
      } catch (loadError: any) {
        console.error("Failed to load calendar data:", loadError);
        if (active && !silent) {
          setError(loadError?.message || "Failed to load calendar data.");
        }
      }

      if (isGoogleTasksConnected) {
        try {
          const response = await apiFetch<{
            events?: GoogleCalendarOverlayEvent[];
          }>(
            `/api/google/calendar/upcoming?start=${encodeURIComponent(fromIso)}&end=${encodeURIComponent(toIso)}&allEvents=1`
          );
          if (active) {
            setGoogleEvents(
              Array.isArray(response?.events) ? response.events : []
            );
          }
        } catch (googleError) {
          // The Google overlay is best-effort; the calendar stays usable without it.
          console.error("Failed to load Google Calendar events:", googleError);
          if (active) setGoogleEvents([]);
        }
      } else if (active) {
        setGoogleEvents([]);
      }

      if (active) {
        setIsLoading(false);
        setHasLoaded(true);
      }
    };

    refreshRef.current = () => void load(true);
    void load(false);

    const unsubscribe = subscribeRealtimeUpdates(["meetings", "tasks"], () => {
      refreshRef.current();
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [range, isGoogleTasksConnected]);

  const entriesByDay = useMemo(
    () => buildDayEntries(data, googleEvents),
    [data, googleEvents]
  );

  const handleViewChange = useCallback((value: string) => {
    if (!isCalendarView(value)) return;
    setView(value);
    storeCalendarView(value);
  }, []);

  const goToToday = useCallback(() => setAnchorDate(new Date()), []);

  const shiftAnchor = useCallback(
    (direction: 1 | -1) => {
      setAnchorDate((current) => {
        if (view === "month") return addMonths(current, direction);
        if (view === "week") return addWeeks(current, direction);
        return addDays(current, direction * AGENDA_SPAN_DAYS);
      });
    },
    [view]
  );

  const handleEntryClick = useCallback(
    (entry: CalendarDayEntry) => {
      if (entry.kind === "meeting") {
        router.push(`/meetings/${entry.id}`);
        return;
      }
      if (entry.kind === "google") {
        if (entry.link && typeof window !== "undefined") {
          window.open(entry.link, "_blank", "noopener,noreferrer");
        }
        return;
      }
      // Tasks: the calendar payload is a minimal projection without the full
      // task document or a save path, so TaskDetailDialog cannot be mounted
      // here. Navigate to the source meeting (or review queue) instead.
      if (entry.sourceSessionId) {
        router.push(`/meetings/${entry.sourceSessionId}`);
      } else {
        router.push("/review");
      }
    },
    [router]
  );

  return (
    <div className="flex h-full flex-col">
      <DashboardHeader
        pageIcon={CalendarIcon}
        pageTitle={<h1 className="text-2xl font-bold font-headline">Calendar</h1>}
        description="See what happened, what is due, and who needs a reminder."
      />
      <div className="flex-grow space-y-4 overflow-auto p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Tabs value={view} onValueChange={handleViewChange}>
            <TabsList>
              <TabsTrigger value="month">Month</TabsTrigger>
              <TabsTrigger value="week">Week</TabsTrigger>
              <TabsTrigger value="agenda">Agenda</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={() => shiftAnchor(-1)}
              aria-label="Previous"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" onClick={goToToday}>
              Today
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => shiftAnchor(1)}
              aria-label="Next"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <span
              data-testid="calendar-range-label"
              className="min-w-[9rem] text-sm font-medium text-foreground/90"
            >
              {rangeLabel}
            </span>
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive dark:bg-destructive/15">
            {error}
          </div>
        )}

        {isLoading && !hasLoaded ? (
          <CalendarLoadingSkeleton />
        ) : view === "month" ? (
          <MonthView
            anchor={anchorDate}
            entriesByDay={entriesByDay}
            onEntryClick={handleEntryClick}
          />
        ) : view === "week" ? (
          <WeekView
            anchor={anchorDate}
            entriesByDay={entriesByDay}
            onEntryClick={handleEntryClick}
          />
        ) : (
          <AgendaView
            range={range}
            warnings={data.warnings}
            entriesByDay={entriesByDay}
            onEntryClick={handleEntryClick}
          />
        )}
      </div>
    </div>
  );
}
