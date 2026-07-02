// src/components/dashboard/tasks/TaskColumn.tsx
"use client";

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PlusCircle } from 'lucide-react';
import TaskCard from './TaskCard';
import type { NestedTask } from '@/types/task-board';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

interface TaskColumnProps {
  title: string;
  status: 'todo' | 'inprogress' | 'done' | 'recurring';
  tasks: NestedTask[];
  onEditTask: (task: NestedTask) => void;
  onDeleteTask: (taskId: string) => void;
  onAddTask: (status: 'todo' | 'inprogress' | 'done' | 'recurring') => void;
}

const columnStyles = {
    todo: 'border-blue-500/50',
    inprogress: 'border-yellow-500/50',
    done: 'border-green-500/50',
    recurring: 'border-purple-500/50',
}

export default function TaskColumn({ title, status, tasks, onEditTask, onDeleteTask, onAddTask }: TaskColumnProps) {
  const { setNodeRef } = useSortable({ id: status, data: { type: 'column' } });

  return (
    <Card ref={setNodeRef} className={cn("flex flex-col bg-card/50 backdrop-blur-sm", columnStyles[status])}>
      <CardHeader className="flex flex-row items-center justify-between p-4 border-b">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
            {title}
            <Badge variant="secondary" className="rounded-full">{tasks.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-grow p-2 space-y-2 overflow-y-auto">
        <SortableContext items={tasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map(task => (
            <TaskCard
              key={task.id}
              task={task}
              onEdit={() => onEditTask(task)}
              onDelete={() => onDeleteTask(task.id)}
            />
          ))}
        </SortableContext>
        <Button variant="ghost" className="w-full justify-start text-muted-foreground" onClick={() => onAddTask(status)}>
            <PlusCircle className="mr-2 h-4 w-4"/> Add a task
        </Button>
      </CardContent>
    </Card>
  );
}
