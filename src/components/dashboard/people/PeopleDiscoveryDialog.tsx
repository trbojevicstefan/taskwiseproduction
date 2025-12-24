// src/components/dashboard/people/PeopleDiscoveryDialog.tsx
"use client";

import React, { useState, useEffect, useMemo } from 'react';
import type { Person } from '@/types/person';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Loader2, UserCheck, UserPlus, Info } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import { Separator } from '@/components/ui/separator';


interface PeopleDiscoveryDialogProps {
  isOpen: boolean;
  onClose: (peopleToCreate: Partial<Person>[]) => void;
  discoveredPeople: any[]; // People from AI
  existingPeople: Person[]; // People from Firestore
}

const getInitials = (name: string) => name ? name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2) : 'U';

export default function PeopleDiscoveryDialog({
  isOpen,
  onClose,
  discoveredPeople,
  existingPeople,
}: PeopleDiscoveryDialogProps) {
  const [peopleToCreate, setPeopleToCreate] = useState<Set<string>>(new Set());

  const { newPeople, existingDiscoveredPeople } = useMemo(() => {
    const existingNames = new Set(existingPeople.map(p => p.name.toLowerCase()));
    const existingEmails = new Set(existingPeople.map(p => p.email?.toLowerCase()).filter(Boolean));

    const allDiscovered = discoveredPeople.map(dp => {
        const isExisting = existingNames.has(dp.name.toLowerCase()) || (dp.email && existingEmails.has(dp.email.toLowerCase()));
        return { ...dp, isExisting };
    });
    
    return {
        newPeople: allDiscovered.filter(p => !p.isExisting),
        existingDiscoveredPeople: allDiscovered.filter(p => p.isExisting)
    };
  }, [discoveredPeople, existingPeople]);


  useEffect(() => {
    if (isOpen) {
      // Pre-select all new people by default
      setPeopleToCreate(new Set(newPeople.map(p => p.name)));
    }
  }, [isOpen, newPeople]);

  const handleTogglePerson = (name: string) => {
    setPeopleToCreate(prev => {
      const newSet = new Set(prev);
      if (newSet.has(name)) {
        newSet.delete(name);
      } else {
        newSet.add(name);
      }
      return newSet;
    });
  };

  const handleConfirm = () => {
    // Filter the original `newPeople` array to get the full objects of those selected.
    const finalPeopleToCreate = newPeople.filter(p => peopleToCreate.has(p.name));
    
    // IMPORTANT: Strip the `isExisting` property before passing it to the parent.
    const cleanPeopleData = finalPeopleToCreate.map(({ isExisting, ...rest }) => rest);

    onClose(cleanPeopleData);
  };
  
  if (!isOpen) return null;
  
  // This state handles if the dialog was opened but there are no people.
  if (discoveredPeople.length === 0) {
       return (
        <Dialog open={isOpen} onOpenChange={() => onClose([])}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>People</DialogTitle>
                </DialogHeader>
                 <Alert>
                    <Info className="h-4 w-4" />
                    <AlertTitle>No People Found</AlertTitle>
                    <AlertDescription>
                        The AI did not identify any people in this session.
                    </AlertDescription>
                </Alert>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onClose([])}>Close</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
  }

  const totalDiscovered = discoveredPeople.length;
  const totalNew = newPeople.length;
  const totalExisting = existingDiscoveredPeople.length;


  return (
    <Dialog open={isOpen} onOpenChange={() => onClose([])}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>People Discovered</DialogTitle>
          <DialogDescription>
            The AI found {totalDiscovered} people. {totalNew > 0 ? `${totalNew} are new and will be added to your directory.` : `All people found already exist in your directory.`}
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-80 -mx-6 px-6">
          <div className="space-y-4">
            {newPeople.length > 0 && (
                <div>
                    <h4 className="text-sm font-semibold mb-2 flex items-center gap-2"><UserPlus className="h-4 w-4 text-primary"/> New People to Add</h4>
                    <div className="space-y-1 rounded-lg border p-2">
                        {newPeople.map((person, index) => (
                            <div key={`new-${index}`} className="flex items-center gap-3 p-2 rounded-md hover:bg-muted/50">
                                <Checkbox 
                                    id={`person-new-${index}`}
                                    checked={peopleToCreate.has(person.name)}
                                    onCheckedChange={() => handleTogglePerson(person.name)}
                                />
                                <Avatar className="h-8 w-8">
                                    <AvatarImage src={`https://api.dicebear.com/8.x/initials/svg?seed=${person.name}`} />
                                    <AvatarFallback>{getInitials(person.name)}</AvatarFallback>
                                </Avatar>
                                <Label htmlFor={`person-new-${index}`} className="flex-grow cursor-pointer">
                                    <p className="font-semibold text-sm">{person.name}</p>
                                    {person.title && <p className="text-xs text-muted-foreground">{person.title}</p>}
                                </Label>
                            </div>
                        ))}
                    </div>
                </div>
            )}
            {existingDiscoveredPeople.length > 0 && (
                 <div>
                    <h4 className="text-sm font-semibold mb-2 flex items-center gap-2"><UserCheck className="h-4 w-4 text-green-500"/> Matched Existing People</h4>
                     <div className="space-y-1 rounded-lg border p-2 bg-muted/30">
                        {existingDiscoveredPeople.map((person, index) => (
                            <div key={`existing-${index}`} className="flex items-center gap-3 p-2 rounded-md opacity-80">
                                <UserCheck className="h-5 w-5 text-green-500 ml-1.5 flex-shrink-0"/>
                                <Avatar className="h-8 w-8">
                                    <AvatarImage src={`https://api.dicebear.com/8.x/initials/svg?seed=${person.name}`} />
                                    <AvatarFallback>{getInitials(person.name)}</AvatarFallback>
                                </Avatar>
                                <div>
                                    <p className="font-semibold text-sm">{person.name}</p>
                                    {person.title && <p className="text-xs text-muted-foreground">{person.title}</p>}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
          </div>
        </ScrollArea>
        <DialogFooter>
          <Button variant="outline" onClick={() => onClose([])}>Cancel</Button>
          <Button onClick={handleConfirm} disabled={peopleToCreate.size === 0}>
            <UserPlus className="mr-2 h-4 w-4" />
            Add {peopleToCreate.size} New People
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
