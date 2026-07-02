// This component is no longer used by the primary sharing flow in ChatPageContent.
// It is kept here for potential future use or for other parts of the application.
// You can safely delete this file if it is not needed elsewhere.

"use client";

import React, { useState, useEffect } from 'react';
import type { ExtractedTaskSchema } from '@/types/chat';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { ChevronRight, ChevronLeft, PlusCircle, MessageSquare, Send } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { useIntegrations } from '@/contexts/IntegrationsContext';

interface ShareWizardProps {
  isOpen: boolean;
  onClose: () => void;
  task: ExtractedTaskSchema | null;
}

type ShareDestination = 'slack' | 'sms' | 'trello';

const destinations = [
    { id: 'slack' as ShareDestination, name: 'Slack', icon: '💬' },
    { id: 'trello' as ShareDestination, name: 'Trello', icon: '📋' },
    { id: 'sms' as ShareDestination, name: 'SMS', icon: '📱' },
];

const TaskSelectionItem = ({ task, onToggle, isSelected, level = 0 }: { task: ExtractedTaskSchema; onToggle: (id: string, selected: boolean) => void; isSelected: boolean; level?: number }) => (
    <div className={cn("flex flex-col", level > 0 && "pl-6")}>
        <div className="flex items-center space-x-2 py-2">
            <Checkbox id={`share-${task.id}`} checked={isSelected} onCheckedChange={(checked) => onToggle(task.id, Boolean(checked))} />
            <Label htmlFor={`share-${task.id}`} className="flex-1 text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                {task.title}
                 <Badge variant="secondary" className="ml-2">{task.priority}</Badge>
            </Label>
        </div>
        {task.subtasks?.map(sub => <TaskSelectionItem key={sub.id} task={sub} onToggle={onToggle} isSelected={isSelected} level={level + 1} />)}
    </div>
);


export default function ShareWizard({ isOpen, onClose, task }: ShareWizardProps) {
  const { toast } = useToast();
  const { isTrelloConnected } = useIntegrations();
  const [step, setStep] = useState(1);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [selectedDestination, setSelectedDestination] = useState<ShareDestination | null>(null);

  const allTaskIds = React.useMemo(() => {
    const ids = new Set<string>();
    const collect = (t: ExtractedTaskSchema) => {
      ids.add(t.id);
      t.subtasks?.forEach(collect);
    };
    if (task) collect(task);
    return ids;
  }, [task]);

  useEffect(() => {
    if (task) {
      setSelectedTaskIds(allTaskIds); // Select all by default
    } else {
      setSelectedTaskIds(new Set());
      setStep(1);
      setSelectedDestination(null);
    }
  }, [task, allTaskIds]);

  const handleToggleTask = (id: string, selected: boolean) => {
    const newSet = new Set(selectedTaskIds);
    if (selected) newSet.add(id);
    else newSet.delete(id);
    setSelectedTaskIds(newSet);
  };

  const handleSend = () => {
    toast({
      title: "Sharing Tasks...",
      description: `Simulating sending ${selectedTaskIds.size} tasks to ${selectedDestination}.`,
    });
    // In a real app, this would trigger an API call.
    onClose();
  };

  const renderContent = () => {
    switch (step) {
      case 1:
        return (
          <>
            <SheetHeader>
              <SheetTitle>Step 1: Select Tasks to Share</SheetTitle>
              <SheetDescription>Choose which tasks from "{task?.title}" you want to share.</SheetDescription>
            </SheetHeader>
            <ScrollArea className="my-4 flex-1">
              <div className="pr-4">
                {task && <TaskSelectionItem task={task} onToggle={handleToggleTask} isSelected={selectedTaskIds.has(task.id)} />}
              </div>
            </ScrollArea>
            <SheetFooter>
              <Button onClick={onClose} variant="outline">Cancel</Button>
              <Button onClick={() => setStep(2)} disabled={selectedTaskIds.size === 0}>
                Next <ChevronRight className="ml-2 h-4 w-4" />
              </Button>
            </SheetFooter>
          </>
        );
      case 2:
        return (
          <>
            <SheetHeader>
              <SheetTitle>Step 2: Choose a Destination</SheetTitle>
              <SheetDescription>Where would you like to send these {selectedTaskIds.size} tasks?</SheetDescription>
            </SheetHeader>
            <div className="my-4 flex-1 space-y-3">
              {destinations.map(dest => {
                 const isConnected = dest.id === 'trello' ? isTrelloConnected : true; // Assume others are always available
                 return (
                    <button
                        key={dest.id}
                        onClick={() => {
                            if(isConnected) {
                                setSelectedDestination(dest.id);
                                setStep(3);
                            } else {
                                toast({ title: "Not Connected", description: `Please connect to ${dest.name} in settings first.`, variant: "destructive"})
                            }
                        }}
                        className={cn(
                            "w-full flex items-center p-4 rounded-lg border transition-colors",
                            selectedDestination === dest.id ? "bg-primary/10 border-primary" : "hover:bg-muted/50",
                            !isConnected && "opacity-50 cursor-not-allowed"
                        )}
                    >
                        <span className="text-2xl mr-4">{dest.icon}</span>
                        <span className="font-semibold">{dest.name}</span>
                        {!isConnected && <Badge variant="destructive" className="ml-auto">Not Connected</Badge>}
                    </button>
                 )
              })}
              <button className="w-full flex items-center p-4 rounded-lg border border-dashed hover:border-primary hover:text-primary transition-colors text-muted-foreground">
                  <PlusCircle className="text-2xl mr-4 h-7 w-7"/>
                  <span className="font-semibold">Add New Integration</span>
              </button>
            </div>
            <SheetFooter>
              <Button onClick={() => setStep(1)} variant="outline">
                <ChevronLeft className="mr-2 h-4 w-4" /> Back
              </Button>
            </SheetFooter>
          </>
        );
      case 3:
        return (
          <>
            <SheetHeader>
              <SheetTitle>Step 3: Confirm & Send</SheetTitle>
              <SheetDescription>
                You are about to send {selectedTaskIds.size} tasks to {selectedDestination}.
              </SheetDescription>
            </SheetHeader>
            <div className="my-4 flex-1 rounded-lg bg-muted p-4">
              <p className="text-sm">In a real application, you might see a preview of the message format here or add a custom message.</p>
            </div>
            <SheetFooter>
              <Button onClick={() => setStep(2)} variant="outline">
                <ChevronLeft className="mr-2 h-4 w-4" /> Back
              </Button>
              <Button onClick={handleSend}>
                <Send className="mr-2 h-4 w-4" /> Send to {selectedDestination}
              </Button>
            </SheetFooter>
          </>
        );
      default:
        return null;
    }
  };

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="left" className="w-[400px] sm:w-[540px] flex flex-col">
        {renderContent()}
      </SheetContent>
    </Sheet>
  );
}
