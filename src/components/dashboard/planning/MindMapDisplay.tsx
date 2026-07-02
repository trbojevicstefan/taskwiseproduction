
// src/components/dashboard/planning/MindMapDisplay.tsx
"use client";

import React from 'react';
import type { ExtractedTaskSchema as DisplayTask } from '@/types/chat';
import MindMapNode from './MindMapNode';

interface MindMapDisplayProps {
  tasks: DisplayTask[];
  onBreakDown: (task: DisplayTask) => void;
  onViewDetails: (task: DisplayTask) => void;
  onDeleteTask: (task: DisplayTask) => void; // Added
  onSimplifyTask: (task: DisplayTask) => void; // Added
  isProcessingSubtasksGlobal: boolean;
  taskForSubtaskGenerationId: string | null;
}

const MindMapDisplay: React.FC<MindMapDisplayProps> = ({ 
    tasks, 
    onBreakDown, 
    onViewDetails, 
    onDeleteTask, // Added
    onSimplifyTask, // Added
    isProcessingSubtasksGlobal, 
    taskForSubtaskGenerationId 
}) => {
  if (!tasks || tasks.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-10">No tasks to display in mind map.</p>;
  }

  return (
    <div className="space-y-4 relative">
      {tasks.map((task, index) => (
        <MindMapNode 
            key={task.id} 
            task={task} 
            level={0} 
            isLastChild={index === tasks.length - 1} 
            parentHasSibling={tasks.length > 1} 
            onBreakDown={onBreakDown}
            onViewDetails={onViewDetails}
            onDeleteTask={onDeleteTask} // Pass down
            onSimplifyTask={onSimplifyTask} // Pass down
            isProcessingSubtasksGlobal={isProcessingSubtasksGlobal}
            taskForSubtaskGenerationId={taskForSubtaskGenerationId}
        />
      ))}
    </div>
  );
};

export default MindMapDisplay;
