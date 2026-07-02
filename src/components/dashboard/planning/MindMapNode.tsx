
// src/components/dashboard/planning/MindMapNode.tsx
"use client";

import React from 'react';
import type { ExtractedTaskSchema as DisplayTask } from '@/types/chat';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Brain, Loader2, Edit3, Trash2, Zap as SimplifyIcon } from 'lucide-react'; // Added Trash2, SimplifyIcon
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal } from 'lucide-react';


interface MindMapNodeProps {
  task: DisplayTask;
  level: number;
  isLastChild: boolean;
  parentHasSibling: boolean; 
  onBreakDown: (task: DisplayTask) => void;
  onViewDetails: (task: DisplayTask) => void;
  onDeleteTask: (task: DisplayTask) => void; // Added
  onSimplifyTask: (task: DisplayTask) => void; // Added
  isProcessingSubtasksGlobal: boolean; 
  taskForSubtaskGenerationId: string | null;
}

const priorityStyles = {
  high: 'border-red-500/70 bg-red-500/10 hover:bg-red-500/20',
  medium: 'border-yellow-500/60 bg-yellow-500/10 hover:bg-yellow-500/20',
  low: 'border-green-500/50 bg-green-500/10 hover:bg-green-500/20',
  default: 'border-border bg-card hover:bg-muted/50', 
};

const MindMapNode: React.FC<MindMapNodeProps> = ({ 
  task, 
  level, 
  isLastChild, 
  parentHasSibling, 
  onBreakDown, 
  onViewDetails,
  onDeleteTask, // Added
  onSimplifyTask, // Added
  isProcessingSubtasksGlobal,
  taskForSubtaskGenerationId 
}) => {
  const subtasks = task.subtasks || [];
  const hasSubtasks = subtasks.length > 0;
  const priorityClass = priorityStyles[task.priority] || priorityStyles.default;
  const isCurrentlyBeingProcessed = task.id === taskForSubtaskGenerationId && isProcessingSubtasksGlobal;

  return (
    <div className={cn("relative pl-6 group/node")}>
      {level > 0 && (
        <div
          className={cn(
            "absolute top-0 left-[calc(0.375rem-1px)] w-0.5 h-full bg-border",
            isLastChild && "h-[1.375rem]" 
          )}
        />
      )}
      
       {level > 0 && (
         <div className="absolute top-[1.375rem] left-[calc(0.375rem-1px)] w-[calc(1.5rem+1px)] h-0.5 bg-border" />
       )}

      <div
        className={cn(
          "p-3 rounded-lg border shadow-sm mb-3 min-w-[200px] inline-block transition-all",
          priorityClass,
          level === 0 && "ml-[-1.5rem]" 
        )}
      >
        <div className="flex justify-between items-start gap-2">
            <h4 
                className={cn("font-semibold text-sm cursor-pointer hover:underline", 
                  task.priority === 'high' ? 'text-red-700 dark:text-red-400' :
                  task.priority === 'medium' ? 'text-yellow-700 dark:text-yellow-400' :
                  task.priority === 'low' ? 'text-green-700 dark:text-green-400' :
                  'text-foreground' 
                )}
                onClick={() => onViewDetails(task)}
            >
                {task.title}
            </h4>
            <Badge variant={task.priority === 'high' ? 'destructive' : task.priority === 'medium' ? 'secondary' : 'outline'}
             className="ml-2 capitalize text-xs px-1.5 py-0.5 shrink-0">
                {task.priority}
            </Badge>
        </div>
        {task.description && (
            <p 
                className="text-xs text-muted-foreground mt-1 cursor-pointer hover:underline"
                onClick={() => onViewDetails(task)}
            >
                {task.description.substring(0,80)}{task.description.length > 80 ? "..." : ""}
            </p>
        )}
         <div className="mt-2 pt-2 border-t border-border/30 flex justify-end items-center gap-1">
            <Button 
                variant="ghost" 
                size="xs" 
                className="text-xs text-muted-foreground hover:text-primary" 
                onClick={() => onBreakDown(task)}
                disabled={isProcessingSubtasksGlobal || isCurrentlyBeingProcessed}
                title="Break down with AI"
            >
                {isCurrentlyBeingProcessed && task.id === taskForSubtaskGenerationId ? (
                    <Loader2 size={12} className="mr-1 animate-spin"/>
                ) : (
                    <Brain size={12} className="mr-1"/>
                )}
                {isCurrentlyBeingProcessed && task.id === taskForSubtaskGenerationId ? "Processing..." : "Break down"}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-foreground" disabled={isProcessingSubtasksGlobal && !isCurrentlyBeingProcessed}>
                    <MoreHorizontal size={14}/>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                 <DropdownMenuItem onClick={() => onViewDetails(task)} disabled={isProcessingSubtasksGlobal}>
                    <Edit3 className="mr-2 h-3 w-3" />
                    View/Edit Details
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onSimplifyTask(task)} disabled={isProcessingSubtasksGlobal || isCurrentlyBeingProcessed}>
                  <SimplifyIcon className="mr-2 h-4 w-4" />
                  Simplify with AI
                </DropdownMenuItem>
                <DropdownMenuSeparator/>
                <DropdownMenuItem onClick={() => onDeleteTask(task)} disabled={isProcessingSubtasksGlobal} className="text-destructive focus:text-destructive">
                    <Trash2 className="mr-2 h-3 w-3" />
                    Delete Task
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
        </div>
      </div>

      {hasSubtasks && (
        <div className={cn("pl-6 mt-[-0.75rem] relative")}>
          {subtasks.map((subtask, index) => (
            <MindMapNode
              key={subtask.id}
              task={subtask}
              level={level + 1}
              isLastChild={index === subtasks.length - 1}
              parentHasSibling={subtasks.length - 1 > index} 
              onBreakDown={onBreakDown}
              onViewDetails={onViewDetails}
              onDeleteTask={onDeleteTask}
              onSimplifyTask={onSimplifyTask}
              isProcessingSubtasksGlobal={isProcessingSubtasksGlobal}
              taskForSubtaskGenerationId={taskForSubtaskGenerationId}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default MindMapNode;
