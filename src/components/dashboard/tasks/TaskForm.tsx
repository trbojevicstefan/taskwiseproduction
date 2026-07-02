// src/components/dashboard/tasks/TaskForm.tsx
"use client";

import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import type { Task } from '@/types/project';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { CalendarIcon } from 'lucide-react';
import { format } from 'date-fns';
import { useEffect } from 'react';
import { cn } from '@/lib/utils';
import type { AppUser } from '@/contexts/AuthContext';


const taskFormSchema = z.object({
  title: z.string().min(1, "Title is required."),
  description: z.string().optional(),
  status: z.enum(['todo', 'inprogress', 'done', 'recurring']),
  priority: z.enum(['high', 'medium', 'low']),
  dueAt: z.date().optional().nullable(),
  assignee: z.string().optional().nullable(),
});

type TaskFormData = z.infer<typeof taskFormSchema>;

interface TaskFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: Omit<Task, 'id' | 'userId' | 'createdAt' | 'order' | 'subtaskCount' | 'parentId' >, taskId?: string) => void;
  task?: Task | null;
  users: AppUser[];
  defaultStatus?: 'todo' | 'inprogress' | 'done' | 'recurring';
}

export default function TaskForm({ isOpen, onClose, onSubmit, task, users, defaultStatus }: TaskFormProps) {
  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm<TaskFormData>({
    resolver: zodResolver(taskFormSchema),
  });

  useEffect(() => {
    if (task) {
      reset({
        title: task.title,
        description: task.description || '',
        status: task.status,
        priority: task.priority,
        dueAt: task.dueAt ? new Date(task.dueAt as string) : null,
        assignee: task.assignee?.uid || null,
      });
    } else {
        reset({
            title: '',
            description: '',
            status: defaultStatus || 'todo',
            priority: 'medium',
            dueAt: null,
            assignee: null,
        });
    }
  }, [task, isOpen, reset, defaultStatus]);

  const handleFormSubmit = (data: TaskFormData) => {
    const selectedUser = users.find(u => u.uid === data.assignee);
    onSubmit({
        ...data,
        dueAt: data.dueAt ? data.dueAt.toISOString() : null,
        assignee: selectedUser,
        aiSuggested: false,
        projectId: task?.projectId || '',
    }, task?.id);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{task ? 'Edit Task' : 'Create New Task'}</DialogTitle>
          <DialogDescription>
            {task ? 'Update the details of your task.' : 'Fill in the details for your new task.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4 py-4">
          <div>
            <Label htmlFor="title">Title</Label>
            <Input id="title" {...register('title')} />
            {errors.title && <p className="text-sm text-destructive mt-1">{errors.title.message}</p>}
          </div>
          <div>
            <Label htmlFor="description">Description</Label>
            <Textarea id="description" {...register('description')} />
          </div>
          <div className="grid grid-cols-2 gap-4">
             <div>
                <Label>Status</Label>
                <Controller
                    control={control}
                    name="status"
                    render={({ field }) => (
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <SelectTrigger><SelectValue/></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="todo">To Do</SelectItem>
                                <SelectItem value="inprogress">In Progress</SelectItem>
                                <SelectItem value="done">Done</SelectItem>
                                <SelectItem value="recurring">Recurring</SelectItem>
                            </SelectContent>
                        </Select>
                    )}
                />
             </div>
             <div>
                <Label>Priority</Label>
                 <Controller
                    control={control}
                    name="priority"
                    render={({ field }) => (
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <SelectTrigger><SelectValue/></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="low">Low</SelectItem>
                                <SelectItem value="medium">Medium</SelectItem>
                                <SelectItem value="high">High</SelectItem>
                            </SelectContent>
                        </Select>
                    )}
                />
             </div>
          </div>
            <div>
              <Label>Due Date</Label>
                <Controller
                    control={control}
                    name="dueAt"
                    render={({ field }) => (
                         <Popover>
                            <PopoverTrigger asChild>
                                <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !field.value && "text-muted-foreground")}>
                                    <CalendarIcon className="mr-2 h-4 w-4" />
                                    {field.value ? format(field.value, "PPP") : <span>Pick a date</span>}
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0">
                                <Calendar mode="single" selected={field.value || undefined} onSelect={field.onChange} initialFocus/>
                            </PopoverContent>
                        </Popover>
                    )}
                />
            </div>
            <div>
                <Label>Assignee</Label>
                 <Controller
                    control={control}
                    name="assignee"
                    render={({ field }) => (
                        <Select onValueChange={field.onChange} defaultValue={field.value || ''}>
                            <SelectTrigger><SelectValue placeholder="Unassigned"/></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="">Unassigned</SelectItem>
                                {users.map(user => (
                                    <SelectItem key={user.uid} value={user.uid}>{user.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    )}
                />
            </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit">Save Task</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

    