
// src/components/dashboard/planning/SetDueDateDialog.tsx
"use client";

import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Calendar } from '@/components/ui/calendar';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

interface SetDueDateDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (date: Date | undefined) => void; // Undefined means clear due date
}

export default function SetDueDateDialog({ isOpen, onClose, onConfirm }: SetDueDateDialogProps) {
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date());
  const [clearDueDate, setClearDueDate] = useState(false);

  const handleConfirm = () => {
    onConfirm(clearDueDate ? undefined : selectedDate);
    onClose(); // Close the dialog after confirm
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      onClose();
      // Reset state if needed when dialog closes via X or overlay click
      setSelectedDate(new Date());
      setClearDueDate(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Set Due Date</DialogTitle>
          <DialogDescription>
            Select a due date for the selected tasks and their subtasks.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-4">
          <Calendar
            mode="single"
            selected={selectedDate}
            onSelect={setSelectedDate}
            disabled={clearDueDate}
            className="rounded-md border"
          />
          <div className="flex items-center space-x-2">
            <Switch
              id="clear-due-date"
              checked={clearDueDate}
              onCheckedChange={setClearDueDate}
            />
            <Label htmlFor="clear-due-date">Clear existing due date(s)</Label>
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">Cancel</Button>
          </DialogClose>
          <Button type="button" onClick={handleConfirm}>
            {clearDueDate ? "Clear Due Dates" : "Set Due Date"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
