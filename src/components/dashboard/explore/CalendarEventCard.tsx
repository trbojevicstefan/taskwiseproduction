import React from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar, Video, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import type { CalendarEvent } from "./types";

interface CalendarEventCardProps {
  event: CalendarEvent;
}

const getStartTime = (event: CalendarEvent) => {
  if (!event.startTime) return null;
  const parsed = new Date(event.startTime);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
};

export default function CalendarEventCard({ event }: CalendarEventCardProps) {
  const startTime = getStartTime(event);
  const hasLink = Boolean(event.hangoutLink);
  const attendeeNames = (event.attendees || [])
    .map((attendee: any) => attendee.name || attendee.email)
    .filter(Boolean) as string[];

  return (
    <Card className="p-3 border border-dashed bg-muted/20">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Calendar className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate" title={event.title}>
              {event.title}
            </p>
            {event.organizer && (
              <p className="text-xs text-muted-foreground truncate">
                Organizer: {event.organizer}
              </p>
            )}
          </div>
        </div>
        {startTime && (
          <Badge variant="outline" className="text-xs font-mono">
            {format(startTime, "h:mm a")}
          </Badge>
        )}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="text-xs text-muted-foreground truncate">
          {event.location || (hasLink ? "Google Meet" : "Calendar Event")}
        </div>
        {hasLink && (
          <a
            href={event.hangoutLink || undefined}
            target="_blank"
            rel="noreferrer"
            className={cn(
              "inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
            )}
          >
            <Video className="h-3 w-3" />
            Join
          </a>
        )}
      </div>
      {event.description && (
        <p className="mt-2 text-xs text-muted-foreground line-clamp-2">
          {event.description}
        </p>
      )}
      {attendeeNames.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Users className="h-3 w-3" />
          <span className="truncate">
            {attendeeNames.slice(0, 3).join(", ")}
            {attendeeNames.length > 3 ? ` +${attendeeNames.length - 3} more` : ""}
          </span>
        </div>
      )}
    </Card>
  );
}

