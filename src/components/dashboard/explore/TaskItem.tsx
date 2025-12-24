// src/components/dashboard/explore/TaskItem.tsx
import React, { useMemo, useState } from 'react';
import type { ExtractedTaskSchema } from '@/types/chat';
import { cn } from '@/lib/utils';
import { Flame, Share2, UserPlus, Edit3, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { motion, AnimatePresence } from 'framer-motion';

interface TaskItemProps {
  task: ExtractedTaskSchema;
  level?: number;
  selectedIds: Set<string>;
  onToggle: (id: string, selected: boolean) => void;
  onViewDetails: (task: ExtractedTaskSchema) => void;
}

const getTaskAndAllDescendantIds = (task: ExtractedTaskSchema): string[] => {
  const ids = [task.id];
  if (task.subtasks) {
    task.subtasks.forEach(sub => ids.push(...getTaskAndAllDescendantIds(sub)));
  }
  return ids;
};

const TaskItem: React.FC<TaskItemProps> = ({ task, level = 0, selectedIds, onToggle, onViewDetails }) => {
  const allSubTaskIds = useMemo(() => task.subtasks ? task.subtasks.flatMap(getTaskAndAllDescendantIds) : [], [task.subtasks]);
  const isSelected = selectedIds.has(task.id);
  const [isHovered, setIsHovered] = useState(false);

  const checkboxState = useMemo(() => {
    if (allSubTaskIds.length > 0) {
      const selectedSubTasksCount = allSubTaskIds.filter(id => selectedIds.has(id)).length;
      if (selectedSubTasksCount === 0 && !isSelected) return 'unchecked';
      if (selectedSubTasksCount === allSubTaskIds.length && isSelected) return 'checked';
      return 'indeterminate';
    }
    return isSelected ? 'checked' : 'unchecked';
  }, [isSelected, allSubTaskIds, selectedIds]);

  const handleToggle = () => {
    onToggle(task.id, checkboxState !== 'checked');
  };

  return (
    <div
      className={cn("group", level > 0 && "ml-5 pl-3 border-l border-dashed border-border/50")}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onDoubleClick={() => onViewDetails(task)}
    >
      <div className="flex items-center space-x-2 py-1 relative">
        <button
          onClick={handleToggle}
          className={cn(
            "flame-button",
            (isSelected || checkboxState === 'indeterminate') && "is-lit",
          )}
          aria-label={`Select task ${task.title}`}
        >
          <Flame className="flame-icon" />
        </button>
        <div className="flex-1 min-w-0">
          <span className={cn(
              "leading-none cursor-pointer",
              level === 0 ? "text-sm font-bold text-foreground/90" : "text-xs font-medium text-muted-foreground",
              isSelected && "text-foreground font-semibold"
          )}>
            {task.title}
          </span>
        </div>
        <AnimatePresence>
          {isHovered && (
            <motion.div
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                transition={{ duration: 0.2 }}
                className="absolute right-0 top-1/2 -translate-y-1/2 flex items-center bg-background/80 backdrop-blur-sm rounded-full border px-1 py-0.5"
            >
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onViewDetails(task)} title="Edit Details"><Edit3 size={14}/></Button>
                <Button variant="ghost" size="icon" className="h-6 w-6" title="Share"><Share2 size={14}/></Button>
                <Button variant="ghost" size="icon" className="h-6 w-6" title="Assign"><UserPlus size={14}/></Button>
                <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:text-destructive" title="Delete"><Trash2 size={14}/></Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      {task.subtasks && task.subtasks.map(subtask => (
        <TaskItem key={subtask.id} task={subtask} level={level + 1} selectedIds={selectedIds} onToggle={onToggle} onViewDetails={onViewDetails} />
      ))}
    </div>
  );
};

export default TaskItem;
