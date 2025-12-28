// src/components/dashboard/explore/SessionCard.tsx
import React, { useMemo, useState } from 'react';
import type { ExtractedTaskSchema } from '@/types/chat';
import type { Meeting } from '@/types/meeting';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AnimatePresence, motion } from 'framer-motion';
import TaskItem from './TaskItem';
import { ChevronDown, Flame, Video, Users, ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import Link from 'next/link';
import type { Person } from '@/types/person';
import { getBestPersonMatch } from '@/lib/people-matching';

const getTaskAndAllDescendantIds = (task: any): string[] => {
  const ids = [task.id];
  if (task.subtasks) {
    task.subtasks.forEach((sub: any) => ids.push(...getTaskAndAllDescendantIds(sub)));
  }
  return ids;
};

interface SessionCardProps {
  session: Meeting; // Changed from ChatSession to Meeting
  people: Person[];
  selectedTaskIds: Set<string>;
  onToggleSession: (session: Meeting, isSelected: boolean) => void;
  onToggleTask: (taskId: string, isSelected: boolean) => void;
  onViewDetails: (task: ExtractedTaskSchema, session: Meeting) => void;
  isExpanded: boolean;
}

const SessionCard: React.FC<SessionCardProps> = ({ session, people, selectedTaskIds, onToggleSession, onToggleTask, onViewDetails, isExpanded }) => {
  const [isTasksVisible, setIsTasksVisible] = useState(true);

  const allTaskIdsInSession = (session.extractedTasks || []).flatMap(getTaskAndAllDescendantIds);
  const selectedTaskCount = allTaskIdsInSession.filter(id => selectedTaskIds.has(id)).length;
  
  const areAllTasksInSessionSelected = allTaskIdsInSession.length > 0 && selectedTaskCount === allTaskIdsInSession.length;

  const handleToggleSession = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleSession(session, !areAllTasksInSessionSelected);
  };
  
  const startTime = session.startTime
    ? (session.startTime as any).toDate
      ? (session.startTime as any).toDate()
      : new Date(session.startTime as any)
    : null;

  const summaryText = session.summary || "";

  const attendeeMatches = useMemo(() => {
    const attendees = session.attendees || [];
    return attendees.map((attendee) => {
      const match = getBestPersonMatch(
        { name: attendee.name, email: attendee.email },
        people,
        0.85
      );
      return {
        attendee,
        match,
      };
    });
  }, [session.attendees, people]);

  const getInitials = (name?: string | null) => {
    if (!name) return "U";
    return name
      .split(" ")
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();
  };

  return (
     <Card className="shadow-md bg-card/80 dark:bg-black/30 border border-border/50 flex flex-col text-foreground">
      <CardHeader 
        className="p-3 flex flex-row items-center justify-between space-y-0 cursor-pointer"
        onClick={() => setIsTasksVisible(!isTasksVisible)}
      >
        <div className={cn("flex items-center gap-2 min-w-0 flex-1")}>
            <div className="flex items-center gap-2">
                <ChevronDown className={cn("h-4 w-4 transition-transform text-muted-foreground", !isTasksVisible && "-rotate-90")} />
                <div className="flex items-center gap-2 min-w-0">
                    <Video size={14} className="text-primary flex-shrink-0"/>
                    <CardTitle className={cn("text-sm font-semibold truncate")} title={session.title}>
                      {session.title}
                    </CardTitle>
                </div>
            </div>
            {startTime && (
                <Badge variant="outline" className="text-xs font-mono">{format(startTime, 'h:mm a')}</Badge>
            )}
            <Badge variant="secondary" className="font-mono text-xs">
              {selectedTaskCount > 0
                ? `${selectedTaskCount}/${allTaskIdsInSession.length}`
                : allTaskIdsInSession.length}
            </Badge>
        </div>
        <div className="flex items-center space-x-2" onClick={handleToggleSession}>
          <Link
            href={`/meetings/${session.id}`}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-transparent text-muted-foreground hover:border-primary hover:text-primary"
            onClick={(event) => event.stopPropagation()}
            title="Open meeting details"
          >
            <ArrowUpRight className="h-4 w-4" />
          </Link>
          <button
            className={cn(
              "flame-button",
              areAllTasksInSessionSelected && "is-lit",
            )}
            aria-label='Select all tasks in session'
          >
            <Flame className="flame-icon text-muted-foreground" />
          </button>
        </div>
      </CardHeader>
      <AnimatePresence initial={false}>
        {isTasksVisible && (
          <motion.div
            key="content"
            initial="collapsed"
            animate="open"
            exit="collapsed"
            variants={{
              open: { opacity: 1, height: "auto" },
              collapsed: { opacity: 0, height: 0 }
            }}
            transition={{ duration: 0.3, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            {(summaryText || attendeeMatches.length > 0 || (session.extractedTasks && session.extractedTasks.length > 0)) && (
              <CardContent className="p-3 border-t">
                {summaryText && (
                  <p className="text-xs text-muted-foreground mb-2 line-clamp-2">
                    {summaryText}
                  </p>
                )}
                {attendeeMatches.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 mb-3 text-xs text-muted-foreground">
                    <Users className="h-3 w-3" />
                    {attendeeMatches.map(({ attendee, match }) => {
                      const label = attendee.name || attendee.email || "Guest";
                      if (match?.person) {
                        return (
                          <Link
                            key={`${label}-${match.person.id}`}
                            href={`/people/${match.person.id}`}
                            className="flex items-center gap-1 rounded-full border px-2 py-1 text-xs hover:border-primary"
                            title={match.person.email || label}
                          >
                            <Avatar className="h-5 w-5">
                              <AvatarImage src={match.person.avatarUrl || undefined} />
                              <AvatarFallback className="text-[10px]">
                                {getInitials(match.person.name)}
                              </AvatarFallback>
                            </Avatar>
                            <span className="truncate max-w-[120px]">{match.person.name}</span>
                          </Link>
                        );
                      }
                      return (
                        <span
                          key={label}
                          className="rounded-full border px-2 py-1 text-xs text-muted-foreground"
                          title={attendee.email || label}
                        >
                          {label}
                        </span>
                      );
                    })}
                  </div>
                )}
                {session.extractedTasks && session.extractedTasks.length > 0 && (
                  <div className="space-y-1 text-sm">
                    {session.extractedTasks.map((task: ExtractedTaskSchema) => (
                      <TaskItem
                        key={task.id}
                        task={task}
                        selectedIds={selectedTaskIds}
                        onToggle={onToggleTask}
                        onViewDetails={(task) => onViewDetails(task, session)}
                      />
                    ))}
                  </div>
                )}
              </CardContent>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
};

export default SessionCard;
