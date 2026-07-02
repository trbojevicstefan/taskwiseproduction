
// src/components/dashboard/planning/AssignPersonDialog.tsx
"use client";

import React, { useState, useEffect } from 'react';
import type { Person } from '@/types/person';
import type { ExtractedTaskSchema as DisplayTask } from '@/types/chat';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import { Loader2, UserPlus, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface AssignPersonDialogProps {
  isOpen: boolean;
  onClose: () => void;
  people: Person[];
  isLoadingPeople: boolean;
  onAssign: (person: Person) => void;
  onCreatePerson: (name: string) => Promise<string | undefined>;
  task: DisplayTask | null; // Can be null for bulk assignment
  selectedTaskIds?: Set<string>;
}

const getInitials = (name: string) => name ? name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2) : 'U';

export default function AssignPersonDialog({
  isOpen,
  onClose,
  people,
  isLoadingPeople,
  onAssign,
  onCreatePerson,
  task,
  selectedTaskIds
}: AssignPersonDialogProps) {
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [newPersonName, setNewPersonName] = useState('');
  const { toast } = useToast();

  useEffect(() => {
    if (isOpen) {
      setSelectedPersonId(task?.assignee?.uid || null);
      setSearchTerm('');
      setIsCreating(false);
      setNewPersonName('');
    }
  }, [isOpen, task]);

  const filteredPeople = people.filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase()));

  const handleCreate = async () => {
    if (!newPersonName.trim()) {
        toast({ title: "Name required", variant: "destructive" });
        return;
    }
    setIsCreating(true);
    const newPersonId = await onCreatePerson(newPersonName.trim());
    if (newPersonId) {
        setIsCreating(false);
        setNewPersonName('');
        // The parent context will update the `people` prop, and this dialog will re-render
        // We can optimistically select it.
        setSelectedPersonId(newPersonId);
    } else {
        setIsCreating(false);
    }
  };

  const handleConfirm = () => {
    const personToAssign = people.find(p => p.id === selectedPersonId);
    if (personToAssign) {
      onAssign(personToAssign);
    } else {
      toast({ title: "No person selected", variant: "destructive" });
    }
  };
  
  const numSelectedTasks = selectedTaskIds?.size || 0;
  const dialogTitle = numSelectedTasks > 0 
    ? `Assign ${numSelectedTasks} Tasks`
    : 'Assign Task to Person';
  const dialogDescription = numSelectedTasks > 0
    ? `Select a person to assign all ${numSelectedTasks} selected tasks (and their subtasks) to.`
    : `Select a person to assign "${task?.title}" and all its subtasks to.`;


  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
          <DialogDescription>{dialogDescription}</DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-4">
            <Input 
                placeholder="Search people..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
            />
          <ScrollArea className="h-64">
            <div className="pr-4 space-y-2">
                {isLoadingPeople ? (
                    <div className="flex items-center justify-center p-8">
                        <Loader2 className="h-6 w-6 animate-spin"/>
                    </div>
                ) : filteredPeople.length > 0 ? (
                    filteredPeople.map(person => (
                        <button
                            key={person.id}
                            className={`w-full flex items-center gap-3 p-2 rounded-md text-left transition-colors ${selectedPersonId === person.id ? 'bg-primary/10 ring-2 ring-primary' : 'hover:bg-muted'}`}
                            onClick={() => setSelectedPersonId(person.id)}
                        >
                            <Avatar className="h-8 w-8">
                                <AvatarImage src={person.avatarUrl || `https://api.dicebear.com/8.x/initials/svg?seed=${person.name}`} />
                                <AvatarFallback>{getInitials(person.name)}</AvatarFallback>
                            </Avatar>
                            <div>
                                <p className="font-semibold text-sm">{person.name}</p>
                                {person.email && <p className="text-xs text-muted-foreground">{person.email}</p>}
                            </div>
                        </button>
                    ))
                ) : (
                    !isCreating && <p className="text-sm text-center text-muted-foreground py-4">No people found matching "{searchTerm}". Create one below.</p>
                )}
                 {isCreating && (
                    <div className="p-3 bg-muted/50 rounded-lg space-y-2">
                         <div className="flex items-center gap-2">
                             <Input 
                                placeholder="New person's name"
                                value={newPersonName}
                                onChange={(e) => setNewPersonName(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                                autoFocus
                            />
                            <Button onClick={handleCreate} size="sm" disabled={isCreating}>
                               {isCreating ? <Loader2 size={16} className="animate-spin" /> : 'Save'}
                            </Button>
                            <Button onClick={() => setIsCreating(false)} variant="ghost" size="icon" className="h-9 w-9"><X size={16}/></Button>
                         </div>
                    </div>
                 )}
            </div>
          </ScrollArea>
           {!isCreating && (
                <Button variant="outline" className="w-full" onClick={() => setIsCreating(true)}>
                    <UserPlus className="mr-2 h-4 w-4"/>
                    Add New Person
                </Button>
            )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleConfirm} disabled={!selectedPersonId}>Assign Person</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
