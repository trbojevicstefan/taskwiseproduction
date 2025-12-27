// src/components/dashboard/explore/DayColumn.tsx
import React from 'react';
import type { DayData, Meeting, ExtractedTaskSchema } from './types';
import { format, isToday } from 'date-fns';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { ScrollArea } from '@/components/ui/scroll-area';
import SessionCard from './SessionCard';
import CalendarEventCard from './CalendarEventCard';

interface DayColumnProps {
  day: DayData;
  isActive: boolean;
  onHoverStart: () => void;
  onHoverEnd: () => void;
  selectedTaskIds: Set<string>;
  onToggleTask: (taskId: string, isSelected: boolean) => void;
  onToggleSession: (session: Meeting, isSelected: boolean) => void;
  onToggleDay: (day: DayData, isSelected: boolean) => void;
  onViewDetails: (task: ExtractedTaskSchema, session: Meeting) => void;
}

const getHeatColor = (count: number) => {
  if (count === 0) return "bg-gray-400/50";
  if (count < 2) return "bg-yellow-400";
  if (count < 5) return "bg-orange-500";
  return "bg-red-600";
};

const MAX_DOTS = 5;

const DayColumn: React.FC<DayColumnProps> = ({ 
    day, 
    isActive, 
    onHoverStart, 
    onHoverEnd, 
    selectedTaskIds, 
    onToggleTask, 
    onToggleSession, 
    onToggleDay, 
    onViewDetails 
}) => {
  
  const heatColor = getHeatColor(day.meetingCount);
  const dotsToShow = Math.min(day.meetingCount, MAX_DOTS);
  const hasMeetings = day.meetingCount > 0;

  return (
    <motion.div
        layout
        onHoverStart={hasMeetings ? onHoverStart : undefined}
        onHoverEnd={hasMeetings ? onHoverEnd : undefined}
        onClick={hasMeetings ? onHoverStart : undefined} // For mobile tap
        className={cn(
            "relative flex flex-col items-center justify-center pt-16 border-r border-border/10 overflow-hidden h-full",
            hasMeetings ? "cursor-pointer" : "cursor-default"
        )}
        animate={{
            flex: isActive ? 5 : day.meetingCount === 0 ? 0.5 : 1,
            boxShadow: isActive ? "0 0 30px rgba(80,80,120,0.3)" : "0 0 0px rgba(0,0,0,0)",
        }}
        transition={{ type: "spring", stiffness: 200, damping: 20 }}
    >
        <div className={cn("absolute top-4 left-0 right-0 px-2 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider flex flex-col items-center justify-center group-hover:text-foreground transition-colors", isActive && "opacity-0")}>
            <span className={cn("text-4xl font-light block transition-all", isToday(day.date) && "text-primary")}>{format(day.date, 'd')}</span>
            <span>{format(day.date, 'E')}</span>
        </div>
        
        <AnimatePresence>
        {!isActive && hasMeetings && (
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center gap-y-2 z-10"
            >
                {Array.from({ length: dotsToShow }).map((_, i) => (
                    <div key={i} className={cn("w-2 h-2 rounded-full", heatColor)} />
                ))}
            </motion.div>
        )}
        </AnimatePresence>


        <AnimatePresence>
            {isActive && (
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20, transition: { duration: 0.2 } }}
                transition={{ duration: 0.3 }}
                className="absolute top-0 bottom-4 w-full px-2 flex flex-col"
            >
                <div className="flex-shrink-0 pt-4 pb-2 text-xs font-semibold text-muted-foreground flex items-center justify-center gap-2">
                    <div className="flex items-center gap-1">
                        {Array.from({ length: dotsToShow }).map((_, i) => (
                            <div key={i} className={cn("w-1 h-1 rounded-full", heatColor)} />
                        ))}
                    </div>
                    <span>
                       {day.meetingCount} Meeting{day.meetingCount !== 1 && 's'} - {format(day.date, 'MMM d')}
                    </span>
                </div>
                <ScrollArea className="flex-grow min-h-0">
                    <div className="p-1 space-y-4">
                        {day.meetings.map(meeting => (
                            <SessionCard
                                key={meeting.id}
                                session={meeting}
                                selectedTaskIds={selectedTaskIds}
                                onToggleSession={onToggleSession}
                                onToggleTask={onToggleTask}
                                onViewDetails={onViewDetails}
                                isExpanded={isActive}
                            />
                        ))}
                        {day.calendarEvents.map((event) => (
                            <CalendarEventCard key={event.id} event={event} />
                        ))}
                    </div>
                </ScrollArea>
            </motion.div>
            )}
        </AnimatePresence>
    </motion.div>
  );
};

export default DayColumn;
