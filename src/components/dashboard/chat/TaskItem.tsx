// src/components/dashboard/tasks/TaskItem.tsx
"use client";

import React, { useState } from 'react';
import type { ExtractedTaskSchema as DisplayTask } from '@/types/chat';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ChevronDown, ChevronRight, MoreVertical, Loader2, Brain, Zap as SimplifyIcon, Edit3, Trash2, UserPlus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';

const getInitials = (name: string | null | undefined) => {
    if (!name) return '?';
    return name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
};

const getProviderLabel = (provider: DisplayTask['aiProvider']) => {
  if (provider === 'openai') return 'OpenAI';
  if (provider === 'gemini') return 'Gemini';
  return null;
};

interface TaskItemProps {
  task: DisplayTask;
  level?: number;
  isSelected: boolean;
  isIndeterminate: boolean;
  onToggleSelection: (taskId: string, isSelected: boolean) => void;
  currentSelectedIds: Set<string>;
  allDisplayTasks: DisplayTask[];
  onBreakDown: (task: DisplayTask) => void;
  onViewDetails: (task: DisplayTask) => void;
  onDeleteTask: (task: DisplayTask) => void;
  onSimplifyTask: (task: DisplayTask) => void;
  onAssignPerson: (task: DisplayTask) => void;
  getCheckboxState: (task: DisplayTask, currentSelectedIds: Set<string>, allDisplayTasks: DisplayTask[]) => 'checked' | 'unchecked' | 'indeterminate';
  isProcessing: boolean;
  taskBeingProcessedId: string | null;
}

const TaskItem: React.FC<TaskItemProps> = ({
  task,
  level = 0,
  isSelected,
  isIndeterminate,
  onToggleSelection,
  currentSelectedIds,
  allDisplayTasks,
  isProcessing,
  taskBeingProcessedId,
  onBreakDown,
  onViewDetails,
  onDeleteTask,
  onSimplifyTask,
  onAssignPerson,
  getCheckboxState,
}) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const hasSubtasks = task.subtasks && task.subtasks.length > 0;
  const isCurrentlyBeingProcessed = task.id === taskBeingProcessedId && isProcessing;
  const providerLabel = getProviderLabel(task.aiProvider);

  const priorityClasses = {
    high: 'border-l-red-500/80 bg-red-500/5',
    medium: 'border-l-yellow-500/80 bg-yellow-500/5',
    low: 'border-l-blue-500/80 bg-blue-500/5',
  };

  return (
    <div
      className={cn(
        'group/task-item relative transition-colors duration-200 rounded-lg',
        level > 0 && 'ml-6 pl-3 border-l-2 border-dashed border-border/40',
        isSelected ? 'bg-primary/10' : 'hover:bg-muted/50'
      )}
      data-task-id={task.id}
    >
      <div className="flex items-center p-2">
        <Checkbox
          id={`task-${task.id}`}
          checked={isIndeterminate ? 'indeterminate' : isSelected}
          onCheckedChange={(checked) => onToggleSelection(task.id, checked as boolean)}
          className="mr-3"
          aria-label={`Select task ${task.title}`}
          disabled={isProcessing}
        />

        {hasSubtasks ? (
          <Button variant="ghost" size="icon" className="h-6 w-6 mr-1 shrink-0" onClick={() => setIsExpanded(!isExpanded)}>
            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </Button>
        ) : (
          <div className="w-7 h-6 mr-1 shrink-0" />
        )}
        
        <div className="flex-1 min-w-0 cursor-pointer" onClick={() => onViewDetails(task)}>
            <div className="flex items-center gap-2 min-w-0">
                <p className="text-sm font-medium truncate">{task.title}</p>
                {providerLabel && <Badge variant="outline" className="text-[10px] shrink-0">{providerLabel}</Badge>}
            </div>
            {task.description && (
                <p className="text-xs text-muted-foreground truncate">{task.description}</p>
            )}
        </div>
        
        <div className="flex items-center gap-2 ml-2 flex-shrink-0">
             {task.assignee?.name && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger>
                      <Avatar className="h-6 w-6">
                        <AvatarImage src={task.assignee.photoURL || `https://api.dicebear.com/8.x/initials/svg?seed=${task.assignee.name}`} />
                        <AvatarFallback className="text-xs">{getInitials(task.assignee.name)}</AvatarFallback>
                      </Avatar>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Assigned to {task.assignee.name}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
            )}

            <div className="flex items-center gap-2 opacity-0 group-hover/task-item:opacity-100 transition-opacity">
                {task.priority && <Badge variant={task.priority === 'high' ? 'destructive' : task.priority === 'medium' ? 'secondary' : 'outline'} className="capitalize">{task.priority}</Badge>}

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7" disabled={isProcessing && !isCurrentlyBeingProcessed}>
                      {isCurrentlyBeingProcessed ? <Loader2 size={16} className="animate-spin" /> : <MoreVertical size={16} />}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => onViewDetails(task)} disabled={isProcessing}><Edit3 className="mr-2 h-4 w-4" />View/Edit Details</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onAssignPerson(task)} disabled={isProcessing}><UserPlus className="mr-2 h-4 w-4" />Assign Person</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => onBreakDown(task)} disabled={isProcessing}><Brain className="mr-2 h-4 w-4" />Break Down with AI</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onSimplifyTask(task)} disabled={isProcessing}><SimplifyIcon className="mr-2 h-4 w-4" />Simplify with AI</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => onDeleteTask(task)} disabled={isProcessing} className="text-destructive focus:text-destructive"><Trash2 className="mr-2 h-4 w-4" />Delete Task</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
            </div>
        </div>
      </div>
      
      {isExpanded && hasSubtasks && (
        <div className="mt-1">
          {task.subtasks!.map(subtask => (
            <TaskItem
              key={subtask.id}
              task={subtask}
              level={level + 1}
              isSelected={currentSelectedIds.has(subtask.id)}
              isIndeterminate={getCheckboxState(subtask, currentSelectedIds, allDisplayTasks) === 'indeterminate'}
              onToggleSelection={onToggleSelection}
              currentSelectedIds={currentSelectedIds}
              allDisplayTasks={allDisplayTasks}
              onBreakDown={onBreakDown}
              onViewDetails={onViewDetails}
              onDeleteTask={onDeleteTask}
              onSimplifyTask={onSimplifyTask}
              onAssignPerson={onAssignPerson}
              getCheckboxState={getCheckboxState}
              isProcessing={isProcessing}
              taskBeingProcessedId={taskBeingProcessedId}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default TaskItem;
