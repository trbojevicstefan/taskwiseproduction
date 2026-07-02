// src/components/dashboard/explore/SelectionViewDialog.tsx
"use client";

import React from 'react';
import type { ExtractedTaskSchema } from '@/types/chat';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';

interface SelectionViewDialogProps {
  isOpen: boolean;
  onClose: () => void;
  tasks: ExtractedTaskSchema[];
}

const SelectionViewDialog: React.FC<SelectionViewDialogProps> = ({ isOpen, onClose, tasks }) => {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Selected Items ({tasks.length})</DialogTitle>
          <DialogDescription>
            A consolidated view of all the tasks you have selected.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh] -mx-6 px-6 py-4 border-y">
            <div className="space-y-4">
                {tasks.length > 0 ? (
                    tasks.map((task, index) => (
                        <div key={task.id}>
                            <div className="flex justify-between items-start">
                                <div className="flex-1">
                                    <p className="font-semibold">{task.title}</p>
                                    {task.description && (
                                        <p className="text-sm text-muted-foreground mt-1">{task.description}</p>
                                    )}
                                </div>
                                <Badge variant="outline" className="ml-4 capitalize">{task.priority}</Badge>
                            </div>
                            {index < tasks.length - 1 && <Separator className="mt-4" />}
                        </div>
                    ))
                ) : (
                    <p className="text-sm text-muted-foreground text-center py-10">
                        No tasks selected.
                    </p>
                )}
            </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
};

export default SelectionViewDialog;
