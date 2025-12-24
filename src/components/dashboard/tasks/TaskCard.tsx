// src/components/dashboard/tasks/TaskCard.tsx
"use client";

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { MoreHorizontal, GripVertical } from 'lucide-react';
import type { NestedTask } from '@/types/task-board';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface TaskCardProps {
  task: NestedTask;
  onEdit: () => void;
  onDelete: () => void;
}

const getInitials = (name: string | undefined | null) => {
  if (!name) return 'U';
  return name.split(' ').map(n => n[0]).join('').toUpperCase();
};

export default function TaskCard({ task, onEdit, onDelete }: TaskCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id, data: { type: 'task', task } });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : 'auto',
  };

  return (
    <Card ref={setNodeRef} style={style} className="p-3 shadow-sm hover:shadow-md transition-shadow bg-background">
      <div className="flex items-start justify-between">
          <div className="flex items-start gap-2 flex-1 min-w-0">
            <button {...attributes} {...listeners} className="cursor-grab touch-none p-1 -ml-1">
              <GripVertical className="h-5 w-5 text-muted-foreground/50"/>
            </button>
            <div className="min-w-0">
                <p className="text-sm font-medium">{task.title}</p>
                 {task.description && <p className="text-xs text-muted-foreground mt-1 truncate">{task.description}</p>}
            </div>
          </div>
        
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onEdit}>Edit</DropdownMenuItem>
            <DropdownMenuItem onClick={onDelete} className="text-destructive">Delete</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex items-center justify-between mt-3">
        <Badge variant={task.priority === 'high' ? 'destructive' : task.priority === 'medium' ? 'secondary' : 'outline'} className="capitalize">
          {task.priority}
        </Badge>
        {task.assignee && (
          <Avatar className="h-6 w-6">
            <AvatarImage src={task.assignee.photoURL || undefined} alt={task.assignee.name || ''} />
            <AvatarFallback className="text-xs">{getInitials(task.assignee.name)}</AvatarFallback>
          </Avatar>
        )}
      </div>
    </Card>
  );
}
