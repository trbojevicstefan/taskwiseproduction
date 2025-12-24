// src/components/dashboard/explore/SessionCard.tsx
import React, { useState } from 'react';
import type { ExtractedTaskSchema } from '@/types/chat';
import type { Meeting } from '@/types/meeting';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AnimatePresence, motion } from 'framer-motion';
import TaskItem from './TaskItem';
import { ChevronDown, Flame, Video } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

const getTaskAndAllDescendantIds = (task: any): string[] => {
  const ids = [task.id];
  if (task.subtasks) {
    task.subtasks.forEach((sub: any) => ids.push(...getTaskAndAllDescendantIds(sub)));
  }
  return ids;
};

interface SessionCardProps {
  session: Meeting; // Changed from ChatSession to Meeting
  selectedTaskIds: Set<string>;
  onToggleSession: (session: Meeting, isSelected: boolean) => void;
  onToggleTask: (taskId: string, isSelected: boolean) => void;
  onViewDetails: (task: ExtractedTaskSchema, session: Meeting) => void;
  isExpanded: boolean;
}

const SessionCard: React.FC<SessionCardProps> = ({ session, selectedTaskIds, onToggleSession, onToggleTask, onViewDetails, isExpanded }) => {
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
            {session.extractedTasks && session.extractedTasks.length > 0 && (
              <CardContent className="p-3 border-t">
                <div className="space-y-1 text-sm">
                  {session.extractedTasks.map((task: ExtractedTaskSchema) => (
                    <TaskItem key={task.id} task={task} selectedIds={selectedTaskIds} onToggle={onToggleTask} onViewDetails={(task) => onViewDetails(task, session)} />
                  ))}
                </div>
              </CardContent>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
};

export default SessionCard;
