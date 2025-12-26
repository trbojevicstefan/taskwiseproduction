// src/components/dashboard/people/PersonDetailPageContent.tsx
"use client";

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { User, Mail, Loader2, Briefcase, Save, MessageSquare, Bot, FileText, Slack, Edit3, CheckCircle2, X } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { getPersonDetails, onTasksForPersonSnapshot, updatePersonInFirestore } from '@/lib/data';
import type { Person, PersonWithTaskCount } from '@/types/person';
import type { Task } from '@/types/project';
import Link from 'next/link';
import { format } from 'date-fns';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { useIntegrations } from '@/contexts/IntegrationsContext';
import ShareToSlackDialog from '@/components/dashboard/common/ShareToSlackDialog';
import { Badge } from '@/components/ui/badge';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import type { ExtractedTaskSchema } from '@/types/chat';
import DashboardHeader from '../DashboardHeader';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useRouter } from 'next/navigation';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { apiFetch } from '@/lib/api';


interface PersonDetailPageContentProps {
  personId: string;
}

const getInitials = (name: string | null | undefined) => {
    if (!name) return 'U';
    return name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
};

const DetailField = ({ 
    icon: Icon, 
    label, 
    value, 
    placeholder,
    isEditing,
    onChange,
    className
}: {
    icon: React.ElementType;
    label: string;
    value: string;
    placeholder: string;
    isEditing: boolean;
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    className?: string;
}) => (
    <div className={cn("p-4 rounded-lg bg-background/50 border border-border/30", className)}>
        <Label htmlFor={`person-${label.toLowerCase()}`} className="flex items-center text-sm font-medium text-muted-foreground mb-1">
            <Icon className="mr-2 h-4 w-4" />
            {label}
        </Label>
        
        {isEditing ? (
            <Input 
                id={`person-${label.toLowerCase()}`} 
                value={value} 
                onChange={onChange} 
                placeholder={placeholder}
                className="bg-transparent border-none p-0 text-base h-auto focus-visible:ring-0 placeholder:text-muted-foreground/60"
            />
        ) : (
            <p className="text-base font-normal text-foreground min-h-[26px]">{value || <span className="text-muted-foreground/60 italic">{placeholder}</span>}</p>
        )}
    </div>
);


export default function PersonDetailPageContent({ personId }: PersonDetailPageContentProps) {
  const { user, loading: authLoading } = useAuth();
  const { isSlackConnected } = useIntegrations();
  const router = useRouter();
  const { toast } = useToast();
  const [person, setPerson] = useState<PersonWithTaskCount | null>(null);
  const [editablePerson, setEditablePerson] = useState<Partial<Person>>({});
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isBlocking, setIsBlocking] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [isSlackShareOpen, setIsSlackShareOpen] = useState(false);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [slackShareTasks, setSlackShareTasks] = useState<ExtractedTaskSchema[]>([]);
  const [statusFilter, setStatusFilter] = useState<"all" | Task["status"]>("all");
  const [bulkStatusValue, setBulkStatusValue] = useState<string>("");

  const mapTaskToExtracted = useCallback(
    (task: Task): ExtractedTaskSchema => ({
      id: task.id,
      title: task.title,
      description: task.description ?? null,
      priority: task.priority,
      dueAt: task.dueAt ?? null,
      assignee: task.assignee ?? null,
      assigneeName: task.assignee?.name ?? null,
      subtasks: null,
      status: task.status,
    }),
    []
  );

  const slackTasks = useMemo(() => {
    return tasks.map(mapTaskToExtracted);
  }, [tasks, mapTaskToExtracted]);

  const selectedTasks = useMemo(
    () => tasks.filter((task) => selectedTaskIds.has(task.id)),
    [tasks, selectedTaskIds]
  );

  const selectedSlackTasks = useMemo(
    () => selectedTasks.map(mapTaskToExtracted),
    [selectedTasks, mapTaskToExtracted]
  );

  const filteredTasks = useMemo(() => {
    if (statusFilter === "all") return tasks;
    return tasks.filter((task) => (task.status || "todo") === statusFilter);
  }, [tasks, statusFilter]);

  const selectedVisibleCount = useMemo(
    () => filteredTasks.filter((task) => selectedTaskIds.has(task.id)).length,
    [filteredTasks, selectedTaskIds]
  );

  const allVisibleSelected =
    filteredTasks.length > 0 && selectedVisibleCount === filteredTasks.length;

  const groupedTasks = useMemo(() => {
    if (filteredTasks.length === 0) return {};
    return filteredTasks.reduce((acc, task) => {
      const groupName = task.sourceSessionName || "General Tasks";
      if (!acc[groupName]) {
        acc[groupName] = [];
      }
      acc[groupName].push(task);
      return acc;
    }, {} as Record<string, Task[]>);
  }, [filteredTasks]);

  useEffect(() => {
    if (authLoading) {
      setIsLoading(true);
      return;
    }
    if (!user?.uid || !personId) {
      setPerson(null);
      setEditablePerson({});
      setTasks([]);
      setIsLoading(false);
      return;
    }

    const fetchDetails = async () => {
      setIsLoading(true);
      try {
        const personDetails = await getPersonDetails(user.uid, personId);
        setPerson(personDetails);
        setEditablePerson(personDetails || {});
      } catch (error) {
        console.error("Error fetching person details:", error);
      } finally {
        setIsLoading(false);
      }
    };
    fetchDetails();

    const unsubscribe = onTasksForPersonSnapshot(user.uid, personId, (loadedTasks) => {
        setTasks(loadedTasks);
    });
    return () => unsubscribe();
  }, [user, personId, authLoading]);

  useEffect(() => {
    setSelectedTaskIds((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set<string>();
      tasks.forEach((task) => {
        if (prev.has(task.id)) {
          next.add(task.id);
        }
      });
      return next;
    });
  }, [tasks]);

  const handleInputChange = (field: keyof Person, value: string | string[]) => {
      setEditablePerson(prev => ({ ...prev, [field]: value }));
  }

  const handleAliasChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const aliases = e.target.value.split(',').map(alias => alias.trim());
      handleInputChange('aliases', aliases);
  }
  
  const hasChanges = useMemo(() => {
    if (!person || !isEditing) return false;
    return JSON.stringify(person) !== JSON.stringify({ ...person, ...editablePerson });
  }, [person, editablePerson, isEditing]);


  const handleSaveChanges = async () => {
    if (!user || !person || !person.id) {
        toast({ title: "Error", description: "Could not save changes. User or Person ID is missing.", variant: "destructive"});
        setIsEditing(false);
        return;
    };
    
    if (!hasChanges) {
        setIsEditing(false);
        return;
    }

    setIsSaving(true);
    try {
        await updatePersonInFirestore(user.uid, person.id, editablePerson);
        const updatedPersonDetails = await getPersonDetails(user.uid, person.id);
        setPerson(updatedPersonDetails);
        setEditablePerson(updatedPersonDetails || {});
        
        toast({
          title: "Profile Synced!",
          description: `${person.name}'s profile has been successfully updated.`,
        });

        setIsEditing(false);
    } catch (error) {
        console.error("Error updating person profile:", error);
        toast({ title: "Save Failed", description: "Could not save the changes.", variant: "destructive"});
    } finally {
        setIsSaving(false);
    }
  }

  const handleToggleBlock = async () => {
    if (!user || !person?.id) return;
    setIsBlocking(true);
    try {
      const nextBlocked = !person.isBlocked;
      await updatePersonInFirestore(user.uid, person.id, { isBlocked: nextBlocked });
      const updatedPersonDetails = await getPersonDetails(user.uid, person.id);
      setPerson(updatedPersonDetails);
      setEditablePerson(updatedPersonDetails || {});
      toast({
        title: nextBlocked ? "Person Blocked" : "Person Unblocked",
        description: nextBlocked
          ? "This person will be ignored in future discoveries."
          : "This person can be discovered again.",
      });
    } catch (error) {
      console.error("Error updating block status:", error);
      toast({ title: "Update Failed", description: "Could not update block status.", variant: "destructive" });
    } finally {
      setIsBlocking(false);
    }
  };

  const handleDeletePerson = async () => {
    if (!user?.uid || !person?.id) return;
    try {
      const response = await fetch(`/api/people/${person.id}`, { method: "DELETE" });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "Delete failed.");
      }
      toast({ title: "Person Deleted", description: "This person has been removed from your directory." });
      router.push("/people");
    } catch (error) {
      console.error("Error deleting person:", error);
      toast({ title: "Delete Failed", description: "Could not delete this person.", variant: "destructive" });
    }
  };

  const handleToggleTaskSelection = (taskId: string, checked: boolean) => {
    setSelectedTaskIds((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(taskId);
      } else {
        next.delete(taskId);
      }
      return next;
    });
  };

  const handleSelectAllTasks = () => {
    setSelectedTaskIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        filteredTasks.forEach((task) => next.delete(task.id));
      } else {
        filteredTasks.forEach((task) => next.add(task.id));
      }
      return next;
    });
  };

  const handleTaskStatusChange = async (task: Task, nextStatus: Task["status"]) => {
    try {
      if (task.sourceSessionType === "meeting" || task.sourceSessionType === "chat") {
        await apiFetch("/api/tasks/status", {
          method: "PATCH",
          body: JSON.stringify({
            sourceSessionId: task.sourceSessionId,
            sourceSessionType: task.sourceSessionType,
            taskId: task.sourceTaskId || task.id.split(":")[1] || task.id,
            status: nextStatus,
          }),
        });
      } else {
        await apiFetch(`/api/tasks/${task.id}`, {
          method: "PATCH",
          body: JSON.stringify({ status: nextStatus }),
        });
      }

      setTasks((prev) =>
        prev.map((item) =>
          item.id === task.id ? { ...item, status: nextStatus } : item
        )
      );
    } catch (error) {
      console.error("Failed to update task status:", error);
      toast({
        title: "Status Update Failed",
        description: "Could not update the task status.",
        variant: "destructive",
      });
    }
  };

  const handleBulkStatusChange = async (nextStatus: Task["status"]) => {
    if (selectedTasks.length === 0) return;
    await Promise.all(
      selectedTasks.map((task) => handleTaskStatusChange(task, nextStatus))
    );
    setBulkStatusValue("");
  };
  
  if (isLoading) {
      return (
        <div className="flex items-center justify-center py-20">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
            <p className="ml-3 text-muted-foreground">Loading person details...</p>
        </div>
      );
  }

  if (!person) {
    return (
      <div className="text-center py-20">
        <h2 className="text-2xl font-bold">Person Not Found</h2>
        <p className="text-muted-foreground">The person you are looking for does not exist or could not be loaded.</p>
        <Link href="/people"><Button variant="link" className="mt-4">Back to People Directory</Button></Link>
      </div>
    );
  }

  const currentPersonData = isEditing ? editablePerson : person;

  const headerTitle = (
      <h1 className="text-2xl font-bold font-headline">
        {currentPersonData.name ? `Profile: ${currentPersonData.name}` : "Person Details"}
      </h1>
  );

  return (
    <div className="flex flex-col h-full">
        <DashboardHeader
            pageIcon={User}
            pageTitle={headerTitle}
        >
            {person?.isBlocked && (
              <Badge variant="destructive">Blocked</Badge>
            )}
            {isEditing ? (
                <>
                    <Button variant="outline" onClick={() => { setIsEditing(false); setEditablePerson(person);}}>
                        <X className="mr-2 h-4 w-4"/> Cancel
                    </Button>
                    <Button onClick={handleSaveChanges} disabled={isSaving || !hasChanges}>
                        {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Save className="mr-2 h-4 w-4"/>}
                        Save Profile
                    </Button>
                </>
            ) : (
                <>
                  <Button variant="outline" onClick={handleToggleBlock} disabled={isBlocking}>
                    {isBlocking ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <CheckCircle2 className="mr-2 h-4 w-4"/>}
                    {person?.isBlocked ? "Unblock" : "Block"}
                  </Button>
                  {isSlackConnected && (
                    <Button
                      variant="outline"
                      onClick={() => {
                        setSlackShareTasks(slackTasks);
                        setIsSlackShareOpen(true);
                      }}
                    >
                      <Slack className="mr-2 h-4 w-4" />
                      Send to Slack
                    </Button>
                  )}
                  <Button variant="outline" onClick={() => setIsDeleteConfirmOpen(true)}>
                    Delete
                  </Button>
                  <Button onClick={() => setIsEditing(true)}>
                      <Edit3 className="mr-2 h-4 w-4"/> Edit Profile
                  </Button>
                </>
            )}
        </DashboardHeader>
        
        <div className="flex-grow p-4 sm:p-6 lg:p-8 space-y-8 overflow-auto">
            <div className="max-w-4xl mx-auto">
                 <motion.div 
                    initial={{ opacity: 0, y: -20 }} 
                    animate={{ opacity: 1, y: 0 }} 
                    transition={{ duration: 0.5, delay: 0.1 }} 
                    className="flex flex-col md:flex-row items-center gap-6"
                >
                    <div className="relative group flex-shrink-0">
                        <div className="p-1 bg-gradient-to-br from-green-400 to-teal-500 rounded-full">
                            <Avatar className="w-16 h-16 border-4 border-background shadow-lg">
                                <AvatarImage src={currentPersonData.avatarUrl || `https://api.dicebear.com/8.x/initials/svg?seed=${currentPersonData.name}`} alt={currentPersonData.name} />
                                <AvatarFallback className="text-2xl">{getInitials(currentPersonData.name)}</AvatarFallback>
                            </Avatar>
                        </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 flex-grow">
                        <DetailField 
                            icon={User}
                            label="Name"
                            value={editablePerson.name || ''}
                            placeholder="Full Name"
                            isEditing={isEditing}
                            onChange={(e) => handleInputChange('name', e.target.value)}
                        />
                         <DetailField 
                            icon={Mail}
                            label="Email"
                            value={editablePerson.email || ''}
                            placeholder="Email Address"
                            isEditing={isEditing}
                            onChange={(e) => handleInputChange('email', e.target.value)}
                        />
                        <DetailField 
                            icon={Briefcase}
                            label="Title"
                            value={editablePerson.title || ''}
                            placeholder="Job Title or Role"
                            isEditing={isEditing}
                            onChange={(e) => handleInputChange('title', e.target.value)}
                        />
                    </div>
                </motion.div>
                
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.2 }} className="mt-8">
                   <Accordion type="single" collapsible defaultValue="aliases" className="w-full">
                      <AccordionItem value="aliases" className="border-none">
                          <div className="rounded-xl bg-card border border-border/30 shadow-lg relative overflow-hidden">
                              <div className="absolute top-0 left-0 h-1 w-full bg-gradient-to-r from-orange-400 via-red-500 to-yellow-400" />
                              <AccordionTrigger className="p-6 hover:no-underline">
                                  <div className="text-left flex-grow">
                                      <CardTitle className="flex items-center gap-3"><Bot className="text-muted-foreground"/> Integration Aliases</CardTitle>
                                      <CardDescription className="mt-1">Improve future AI matching by adding nicknames or IDs from other platforms.</CardDescription>
                                  </div>
                              </AccordionTrigger>
                              <AccordionContent className="px-6 pb-6 pt-0">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <DetailField 
                                        icon={Slack}
                                        label="Slack Member ID"
                                        value={editablePerson.slackId || ''}
                                        placeholder="e.g. U02ABC123"
                                        isEditing={isEditing}
                                        onChange={(e) => handleInputChange('slackId', e.target.value)}
                                    />
                                     <DetailField 
                                        icon={Bot}
                                        label="Fireflies.ai Nickname"
                                        value={editablePerson.firefliesId || ''}
                                        placeholder="e.g. 'Stefan'"
                                        isEditing={isEditing}
                                        onChange={(e) => handleInputChange('firefliesId', e.target.value)}
                                    />
                                     <DetailField 
                                        icon={FileText}
                                        label="PhantomBuster ID"
                                        value={editablePerson.phantomBusterId || ''}
                                        placeholder="e.g. 123456789"
                                        isEditing={isEditing}
                                        onChange={(e) => handleInputChange('phantomBusterId', e.target.value)}
                                    />
                                    <DetailField 
                                        icon={MessageSquare}
                                        label="Other Aliases"
                                        value={(editablePerson.aliases || []).join(', ')}
                                        placeholder="e.g. Stef, Steve, The Boss"
                                        isEditing={isEditing}
                                        onChange={handleAliasChange}
                                    />
                                </div>
                              </AccordionContent>
                          </div>
                      </AccordionItem>
                   </Accordion>
                </motion.div>
              
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.3 }} className="mt-8">
                    <Card>
                        <CardHeader>
                          <CardTitle className="flex items-center gap-3">
                            <Briefcase className="text-muted-foreground"/> Assigned Tasks ({tasks.length})
                          </CardTitle>
                          <CardDescription>
                            A complete history of all tasks assigned to {person.name}, grouped by their source session.
                          </CardDescription>
                          <div className="mt-4 flex flex-wrap items-center gap-2">
                            <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as "all" | Task["status"])}>
                              <SelectTrigger className="h-8 w-[180px] text-xs">
                                <SelectValue placeholder="Filter by status" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="all">All statuses</SelectItem>
                                <SelectItem value="todo">To do</SelectItem>
                                <SelectItem value="inprogress">In progress</SelectItem>
                                <SelectItem value="done">Done</SelectItem>
                                <SelectItem value="recurring">Recurring</SelectItem>
                              </SelectContent>
                            </Select>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={handleSelectAllTasks}
                              disabled={filteredTasks.length === 0}
                            >
                              {allVisibleSelected ? "Clear selection" : "Select all"}
                            </Button>
                            <Select
                              value={bulkStatusValue}
                              onValueChange={(value) => {
                                setBulkStatusValue(value);
                                handleBulkStatusChange(value as Task["status"]);
                              }}
                              disabled={selectedTasks.length === 0}
                            >
                              <SelectTrigger className="h-8 w-[170px] text-xs">
                                <SelectValue placeholder="Set status for selected" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="todo">To do</SelectItem>
                                <SelectItem value="inprogress">In progress</SelectItem>
                                <SelectItem value="done">Done</SelectItem>
                                <SelectItem value="recurring">Recurring</SelectItem>
                              </SelectContent>
                            </Select>
                            {isSlackConnected && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setSlackShareTasks(selectedSlackTasks);
                                  setIsSlackShareOpen(true);
                                }}
                                disabled={selectedSlackTasks.length === 0}
                              >
                                Send selected to Slack
                              </Button>
                            )}
                          </div>
                        </CardHeader>
                        <CardContent>
                          {filteredTasks.length > 0 ? (
                            <Accordion type="multiple" defaultValue={Object.keys(groupedTasks)} className="w-full">
                              {Object.entries(groupedTasks).map(([sessionName, sessionTasks]) => (
                                <AccordionItem value={sessionName} key={sessionName}>
                                  <AccordionTrigger className="hover:no-underline py-4">
                                      <div className="flex items-center gap-3">
                                        <MessageSquare className="h-5 w-5 text-muted-foreground"/>
                                        <span className="font-semibold text-md">{sessionName}</span>
                                        <Badge variant="secondary">{sessionTasks.length}</Badge>
                                      </div>
                                  </AccordionTrigger>
                                  <AccordionContent className="pl-6 border-l-2 border-primary/20 ml-2">
                                     <div className="space-y-3 py-2">
                                        {sessionTasks.map(task => {
                                          const taskStatus = task.status || "todo";
                                          return (
                                            <div key={task.id} className="p-3 rounded-md border bg-background hover:bg-muted/50 transition-colors">
                                              <div className="flex justify-between items-start gap-4">
                                                  <div className="flex items-start gap-3 flex-1">
                                                    <Checkbox
                                                      className="mt-1"
                                                      checked={selectedTaskIds.has(task.id)}
                                                      onCheckedChange={(checked) =>
                                                        handleToggleTaskSelection(task.id, checked === true)
                                                      }
                                                    />
                                                    <div>
                                                      <p className="font-semibold">{task.title}</p>
                                                      {task.description && (
                                                        <p className="text-sm text-muted-foreground mt-1">
                                                          {task.description}
                                                        </p>
                                                      )}
                                                    </div>
                                                  </div>
                                                  <div className="text-right text-sm flex-shrink-0 flex items-center gap-2">
                                                      <div className="flex flex-col items-end gap-1">
                                                        <Select
                                                          value={taskStatus}
                                                          onValueChange={(value) =>
                                                            handleTaskStatusChange(
                                                              task,
                                                              value as Task["status"]
                                                            )
                                                          }
                                                        >
                                                          <SelectTrigger className="h-7 w-[130px] text-xs">
                                                            <SelectValue />
                                                          </SelectTrigger>
                                                          <SelectContent>
                                                            <SelectItem value="todo">To do</SelectItem>
                                                            <SelectItem value="inprogress">In progress</SelectItem>
                                                            <SelectItem value="done">Done</SelectItem>
                                                            <SelectItem value="recurring">Recurring</SelectItem>
                                                          </SelectContent>
                                                        </Select>
                                                        <p className="text-xs text-muted-foreground">
                                                          {task.dueAt
                                                            ? format(new Date(task.dueAt as string), 'MMM d, yyyy')
                                                            : 'No due date'}
                                                        </p>
                                                      </div>
                                                  </div>
                                              </div>
                                            </div>
                                          );
                                        })}
                                    </div>
                                  </AccordionContent>
                                </AccordionItem>
                              ))}
                            </Accordion>
                          ) : (
                             <div className="text-center py-16 text-muted-foreground bg-muted/30 rounded-lg">
                                <Briefcase size={32} className="mx-auto mb-3 opacity-50"/>
                                <p className="font-semibold">No tasks in this view</p>
                                <p className="text-sm">Try a different status filter or assign new tasks.</p>
                             </div>
                          )}
                        </CardContent>
                    </Card>
                </motion.div>
            </div>
        </div>
      <AlertDialog open={isDeleteConfirmOpen} onOpenChange={setIsDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this person?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the person from your directory and unassigns any tasks linked to them. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeletePerson} className="bg-destructive hover:bg-destructive/90 text-destructive-foreground">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {isSlackConnected && person && (
        <ShareToSlackDialog
          isOpen={isSlackShareOpen}
          onClose={() => setIsSlackShareOpen(false)}
          tasks={slackShareTasks.length ? slackShareTasks : slackTasks}
          sessionTitle={`Tasks for ${person.name}`}
          defaultDestinationType={person.slackId ? "person" : "channel"}
          defaultUserId={person.slackId || null}
        />
      )}
    </div>
  );
}
