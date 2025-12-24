// src/components/dashboard/planning/HierarchicalTaskItem.tsx
"use client";

import React, { useState } from 'react';
import type { ExtractedTaskSchema as DisplayTask } from '@/types/chat';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Bot, ChevronDown, ChevronRight, Brain, Edit3, MoreVertical, Loader2, Trash2, Zap as SimplifyIcon, UserPlus, Sparkles } from 'lucide-react';
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
    if (!name) return 'U';
    return name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
};

const getProviderMeta = (provider: DisplayTask['aiProvider']) => {
  if (provider === 'openai') return { label: 'OpenAI', icon: Bot };
  if (provider === 'gemini') return { label: 'Gemini', icon: Sparkles };
  return null;
};


interface HierarchicalTaskItemProps {
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
  isProcessingSubtasksGlobal: boolean; 
  taskForSubtaskGenerationId: string | null; 
}

const HierarchicalTaskItem: React.FC<HierarchicalTaskItemProps> = ({
  task,
  level = 0,
  isSelected,
  isIndeterminate,
  onToggleSelection,
  currentSelectedIds,
  allDisplayTasks,
  onBreakDown,
  onViewDetails,
  onDeleteTask,
  onSimplifyTask,
  onAssignPerson,
  getCheckboxState,
  isProcessingSubtasksGlobal,
  taskForSubtaskGenerationId,
}) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const hasSubtasks = task.subtasks && task.subtasks.length > 0;
  const isCurrentlyBeingProcessed = task.id === taskForSubtaskGenerationId && isProcessingSubtasksGlobal;
  const providerMeta = getProviderMeta(task.aiProvider);

  return (
    <div className={cn("py-1.5 min-w-0", level > 0 && "ml-4 pl-3 border-l border-border/20")}>
      <div className="flex items-start gap-2 min-w-0 group">
        <Checkbox
          id={`plan-task-select-${task.id}`}
          checked={isIndeterminate ? 'indeterminate' : isSelected}
          onCheckedChange={(checked) => onToggleSelection(task.id, checked as boolean)}
          className="mr-2 shrink-0 border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground data-[state=indeterminate]:bg-primary/50 data-[state=indeterminate]:text-primary-foreground"
          aria-label={`Select task ${task.title}`}
          disabled={isProcessingSubtasksGlobal}
        />
        {hasSubtasks ? (
          <Button variant="ghost" size="icon" className="h-6 w-6 mr-1 shrink-0" onClick={() => setIsExpanded(!isExpanded)}>
            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </Button>
        ) : <div className="w-6 h-6 mr-1 shrink-0" />}
        
        <div
          className="flex-grow min-w-0 cursor-pointer"
          onClick={() => onViewDetails(task)}
        >
            <div className="flex flex-wrap items-start gap-2 min-w-0">
              <span
                className={cn("text-sm whitespace-normal break-words hover:underline", level === 0 ? "font-semibold text-foreground" : "font-normal text-muted-foreground")}
              >
                {task.title}
              </span>
              {providerMeta && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0.5 shrink-0 flex items-center gap-1">
                  <providerMeta.icon className="h-3 w-3" />
                  {providerMeta.label}
                </Badge>
              )}
            </div>
            {task.description && (
                <p className="text-xs text-muted-foreground mt-0.5 whitespace-normal break-words">
                    {task.description}
                </p>
              )}
        </div>
        
        <div className="flex flex-wrap items-center gap-2 ml-2 shrink-0">
            {task.assignee?.name && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger>
                        <Avatar className="h-6 w-6">
                            <AvatarImage src={task.assignee.photoURL || `https://api.dicebear.com/8.x/initials/svg?seed=${task.assignee.name}`} alt={task.assignee.name} />
                            <AvatarFallback className="text-xs">{getInitials(task.assignee.name)}</AvatarFallback>
                        </Avatar>
                    </TooltipTrigger>
                    <TooltipContent><p>Assigned to {task.assignee.name}</p></TooltipContent>
                  </Tooltip>
                </TooltipProvider>
            )}
            
            <Badge
                variant={task.priority === 'high' ? 'destructive' : task.priority === 'medium' ? 'secondary' : 'outline'}
                className="ml-2 capitalize text-xs px-1.5 py-0.5 shrink-0"
            >
                {task.priority}
            </Badge>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7 ml-1 opacity-50 group-hover:opacity-100" disabled={isProcessingSubtasksGlobal && !isCurrentlyBeingProcessed}>
                  {isCurrentlyBeingProcessed ? <Loader2 size={16} className="animate-spin" /> : <MoreVertical size={16} />}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => onViewDetails(task)} disabled={isProcessingSubtasksGlobal}>
                  <Edit3 className="mr-2 h-4 w-4" />
                  View/Edit Details
                </DropdownMenuItem>
                 <DropdownMenuItem onClick={() => onAssignPerson(task)} disabled={isProcessingSubtasksGlobal}>
                  <UserPlus className="mr-2 h-4 w-4" />
                  Assign to Person
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => onBreakDown(task)} disabled={isProcessingSubtasksGlobal || isCurrentlyBeingProcessed}>
                  <Brain className="mr-2 h-4 w-4" />
                  Break down with AI
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onSimplifyTask(task)} disabled={isProcessingSubtasksGlobal || isCurrentlyBeingProcessed}>
                  <SimplifyIcon className="mr-2 h-4 w-4" />
                  Simplify with AI
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => onDeleteTask(task)} disabled={isProcessingSubtasksGlobal} className="text-destructive focus:text-destructive">
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete Task
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
        </div>

      </div>
      
      {isExpanded && hasSubtasks && (
        <div className="mt-1">
          {(task.subtasks || []).map(subtask => (
            <HierarchicalTaskItem
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
              isProcessingSubtasksGlobal={isProcessingSubtasksGlobal}
              taskForSubtaskGenerationId={taskForSubtaskGenerationId}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default HierarchicalTaskItem;
