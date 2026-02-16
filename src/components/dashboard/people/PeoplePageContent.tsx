// src/components/dashboard/people/PeoplePageContent.tsx
"use client";

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Users, UserPlus, Info, Loader2, Briefcase, Slack, LayoutGrid, List, Trash2, Shield, ShieldOff, GitMerge } from 'lucide-react';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { useAuth } from '@/contexts/AuthContext';
import { useIntegrations } from '@/contexts/IntegrationsContext';
import { addPerson, mergePeople, onPeopleSnapshot, updatePerson } from '@/lib/data';
import type { PersonWithTaskCount } from '@/types/person';
import DashboardHeader from '../DashboardHeader';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getPotentialPersonMatches, getRankedPersonMatches } from '@/lib/people-matching';
import { cn } from '@/lib/utils';
import SlackSyncDialog from './SlackSyncDialog';

const getInitials = (name: string | null | undefined) => {
    if (!name) return 'U';
    return name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
};

export default function PeoplePageContent() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { isSlackConnected } = useIntegrations();
  const [people, setPeople] = useState<PersonWithTaskCount[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showBlocked, setShowBlocked] = useState(false);
  const [isUpdatingBlocked, setIsUpdatingBlocked] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [selectedPeopleIds, setSelectedPeopleIds] = useState<Set<string>>(new Set());
  const [isBulkDeleteOpen, setIsBulkDeleteOpen] = useState(false);
  const [isMatchDialogOpen, setIsMatchDialogOpen] = useState(false);
  const [isMergingId, setIsMergingId] = useState<string | null>(null);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [sourceSearch, setSourceSearch] = useState("");
  const [targetSearch, setTargetSearch] = useState("");
  const [isAddPersonOpen, setIsAddPersonOpen] = useState(false);
  const [isSavingPerson, setIsSavingPerson] = useState(false);
  const [newPersonName, setNewPersonName] = useState("");
  const [newPersonEmail, setNewPersonEmail] = useState("");
  const [newPersonTitle, setNewPersonTitle] = useState("");
  const [isSlackSyncDialogOpen, setIsSlackSyncDialogOpen] = useState(false);

  const visiblePeople = useMemo(
    () => people.filter((person: any) => !person.isBlocked),
    [people]
  );
  const blockedPeople = useMemo(
    () => people.filter((person: any) => person.isBlocked),
    [people]
  );

  const potentialMatches = useMemo(() => getPotentialPersonMatches(people), [people]);

  const matchSources = useMemo(() => {
    const candidates = people.filter((person: any) => !person.isBlocked && !person.slackId);
    const term = sourceSearch.trim().toLowerCase();
    if (!term) return candidates;
    return candidates.filter((person: any) =>
      [person.name, person.email].some((value: any) =>
        value?.toLowerCase().includes(term)
      )
    );
  }, [people, sourceSearch]);

  const matchTargets = useMemo(() => {
    const candidates = people.filter(
      (person) => !person.isBlocked && person.id !== selectedSourceId
    );
    const term = targetSearch.trim().toLowerCase();
    if (!term) return candidates;
    return candidates.filter((person: any) =>
      [person.name, person.email].some((value: any) =>
        value?.toLowerCase().includes(term)
      )
    );
  }, [people, targetSearch, selectedSourceId]);

  const rankedSuggestions = useMemo(() => {
    if (!selectedSourceId) return [];
    const source = people.find((person: any) => person.id === selectedSourceId);
    if (!source) return [];
    return getRankedPersonMatches(
      { name: source.name, email: source.email },
      matchTargets,
      5
    );
  }, [selectedSourceId, people, matchTargets]);

  useEffect(() => {
    if (user?.uid) {
      setIsLoading(true);
      const unsubscribe = onPeopleSnapshot(user.uid, (loadedPeople) => {
        setPeople(loadedPeople);
        setIsLoading(false);
      });
      return () => unsubscribe();
    } else {
      setPeople([]);
      setIsLoading(false);
    }
  }, [user?.uid]);

  useEffect(() => {
    if (!isMatchDialogOpen) {
      setSelectedSourceId(null);
      setSelectedTargetId(null);
      setSourceSearch("");
      setTargetSearch("");
    }
  }, [isMatchDialogOpen]);


  const refreshPeople = async () => {
    try {
      const response = await fetch("/api/people");
      if (response.ok) {
        const data = await response.json();
        setPeople(data);
      }
    } catch (error) {
      console.error("Failed to refresh people:", error);
    }
  };

  const visiblePeopleIds = useMemo(
    () => visiblePeople.map((person: any) => person.id),
    [visiblePeople]
  );

  const togglePersonSelection = (personId: string) => {
    setSelectedPeopleIds((prev) => {
      const next = new Set(prev);
      if (next.has(personId)) {
        next.delete(personId);
      } else {
        next.add(personId);
      }
      return next;
    });
  };

  const handleSelectAllVisible = (checked: boolean) => {
    setSelectedPeopleIds(checked ? new Set(visiblePeopleIds) : new Set());
  };


  const handleBulkBlock = async (nextBlocked: boolean) => {
    if (!user?.uid) return;
    try {
      await Promise.all(
        Array.from(selectedPeopleIds).map((personId: any) =>
          updatePerson(user.uid, personId, { isBlocked: nextBlocked })
        )
      );
      toast({
        title: nextBlocked ? "People Blocked" : "People Unblocked",
        description: `${selectedPeopleIds.size} people updated.`,
      });
      setSelectedPeopleIds(new Set());
    } catch (error) {
      console.error("Bulk update failed:", error);
      toast({
        title: "Bulk update failed",
        description: "Could not update selected people.",
        variant: "destructive",
      });
    }
  };

  const handleBulkDelete = async () => {
    if (!selectedPeopleIds.size) return;
    try {
      await Promise.all(
        Array.from(selectedPeopleIds).map(async (personId) => {
          const response = await fetch(`/api/people/${personId}`, { method: "DELETE" });
          if (!response.ok) {
            const payload = await response.json().catch(() => ({}));
            throw new Error(payload.error || "Delete failed");
          }
        })
      );
      toast({
        title: "People Deleted",
        description: `${selectedPeopleIds.size} people removed.`,
      });
      setSelectedPeopleIds(new Set());
      refreshPeople();
    } catch (error) {
      console.error("Bulk delete failed:", error);
      toast({
        title: "Bulk delete failed",
        description: "Could not delete selected people.",
        variant: "destructive",
      });
    } finally {
      setIsBulkDeleteOpen(false);
    }
  };

  const handleMergePeople = async (sourceId: string, targetId: string) => {
    setIsMergingId(sourceId);
    try {
      await mergePeople(sourceId, targetId);
      toast({
        title: "People Merged",
        description: "The profiles have been merged and tasks reassigned.",
      });
      refreshPeople();
    } catch (error) {
      console.error("Merge failed:", error);
      toast({
        title: "Merge failed",
        description: "Could not merge these people.",
        variant: "destructive",
      });
    } finally {
      setIsMergingId(null);
    }
  };

  const handleManualMerge = async () => {
    if (!selectedSourceId || !selectedTargetId) return;
    await handleMergePeople(selectedSourceId, selectedTargetId);
    setSelectedSourceId(null);
    setSelectedTargetId(null);
  };

  const handleDeleteSource = async (personId: string) => {
    try {
      const response = await fetch(`/api/people/${personId}`, { method: "DELETE" });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "Delete failed");
      }
      toast({ title: "Person Removed", description: "This person has been removed." });
      refreshPeople();
      if (selectedSourceId === personId) {
        setSelectedSourceId(null);
      }
    } catch (error) {
      console.error("Delete failed:", error);
      toast({ title: "Delete Failed", description: "Could not delete this person.", variant: "destructive" });
    }
  };

  const renderMatchConfidence = (confidence: number) => {
    const label =
      confidence >= 0.9 ? "High" : confidence >= 0.8 ? "Medium" : "Low";
    const variant =
      confidence >= 0.9 ? "default" : confidence >= 0.8 ? "secondary" : "outline";
    return (
      <Badge variant={variant} className="text-xs">
        {label} ({Math.round(confidence * 100)}%)
      </Badge>
    );
  };

  const handleOpenSlackSyncDialog = () => {
    if (!isSlackConnected) {
      toast({
        title: "Slack not connected",
        description: "Connect Slack in Settings before syncing.",
        variant: "destructive",
      });
      return;
    }
    setIsSlackSyncDialogOpen(true);
  };


  const handleUnblockPerson = async (personId: string) => {
    if (!user?.uid) return;
    setIsUpdatingBlocked(personId);
    try {
      await updatePerson(user.uid, personId, { isBlocked: false });
      toast({
        title: "Person Unblocked",
        description: "This person will be available for discovery again.",
      });
    } catch (error) {
      console.error("Error unblocking person:", error);
      toast({
        title: "Unblock Failed",
        description: "Could not unblock this person.",
        variant: "destructive",
      });
    } finally {
      setIsUpdatingBlocked(null);
    }
  };

  const handleCreatePerson = async () => {
    if (!user?.uid) return;
    if (!newPersonName.trim()) {
      toast({ title: "Name required", variant: "destructive" });
      return;
    }
    setIsSavingPerson(true);
    try {
      await addPerson(user.uid, {
        name: newPersonName.trim(),
        email: newPersonEmail.trim() || null,
        title: newPersonTitle.trim() || null,
      }, "manual");
      toast({ title: "Person Added", description: `${newPersonName.trim()} was added.` });
      setIsAddPersonOpen(false);
      setNewPersonName("");
      setNewPersonEmail("");
      setNewPersonTitle("");
    } catch (error) {
      console.error("Failed to add person:", error);
      toast({ title: "Add Failed", description: "Could not add this person.", variant: "destructive" });
    } finally {
      setIsSavingPerson(false);
    }
  };

  const getTaskCounts = (person: PersonWithTaskCount) => {
    const counts = person.taskCounts;
    return {
      todo: counts?.todo ?? person.taskCount ?? 0,
      inprogress: counts?.inprogress ?? 0,
      done: counts?.done ?? 0,
    };
  };

  return (
    <div className="flex flex-col h-full">
      <DashboardHeader
        pageIcon={Users}
        pageTitle={<h1 className="text-2xl font-bold font-headline">People</h1>}
      >
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => setViewMode((prev) => (prev === "grid" ? "list" : "grid"))}
          >
            {viewMode === "grid" ? <List className="h-4 w-4 mr-2" /> : <LayoutGrid className="h-4 w-4 mr-2" />}
            {viewMode === "grid" ? "List View" : "Grid View"}
          </Button>
          <Button variant="outline" onClick={() => setIsMatchDialogOpen(true)}>
            <GitMerge className="h-4 w-4 mr-2" />
            Match People
            {potentialMatches.length > 0 && (
              <Badge variant="secondary" className="ml-2">
                {potentialMatches.length}
              </Badge>
            )}
          </Button>
          <Button variant="outline" onClick={() => setShowBlocked((prev) => !prev)}>
            {showBlocked ? "Hide Blocked" : "Manage Blocked"}
            {blockedPeople.length > 0 && (
              <Badge variant="secondary" className="ml-2">
                {blockedPeople.length}
              </Badge>
            )}
          </Button>
          <Button
            variant="outline"
            onClick={handleOpenSlackSyncDialog}
            disabled={!isSlackConnected || isSlackSyncDialogOpen}
          >
            <Slack className="h-4 w-4 mr-2" />
            Sync Slack Users
          </Button>
          <Button onClick={() => setIsAddPersonOpen(true)}>
            <UserPlus className="h-4 w-4 mr-2" />
            Add Person Manually
          </Button>
        </div>
      </DashboardHeader>

      <div className="flex-grow p-4 sm:p-6 lg:p-8 space-y-6 overflow-auto">
        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>This is Your Team Hub!</AlertTitle>
          <AlertDescription>
            This view is automatically populated when you process a meeting transcript. The AI extracts attendees and lists them here. Clicking on a person will show you all tasks assigned to them across all your sessions.
          </AlertDescription>
        </Alert>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
            <p className="ml-3 text-muted-foreground">Loading people...</p>
          </div>
        ) : visiblePeople.length === 0 && !(showBlocked && blockedPeople.length > 0) ? (
          <Card>
            <CardHeader>
              <CardTitle>Directory is Empty</CardTitle>
              <CardDescription>
                No people have been extracted yet. Process a meeting transcript in the "Chat" or "Meeting Planner" page to get started.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-center py-12 text-muted-foreground">
                <Users className="h-12 w-12 mx-auto mb-4" />
                <p>People you collaborate with will appear here.</p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-8">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Checkbox
                  checked={selectedPeopleIds.size > 0 && selectedPeopleIds.size === visiblePeopleIds.length}
                  onCheckedChange={(checked) => handleSelectAllVisible(Boolean(checked))}
                />
                <span>Select all</span>
                {selectedPeopleIds.size > 0 && (
                  <Badge variant="secondary">{selectedPeopleIds.size} selected</Badge>
                )}
              </div>
              {selectedPeopleIds.size > 0 && (
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => setSelectedPeopleIds(new Set())}>
                    Clear
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => handleBulkBlock(true)}>
                    <Shield className="h-4 w-4 mr-2" />
                    Block
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => handleBulkBlock(false)}>
                    <ShieldOff className="h-4 w-4 mr-2" />
                    Unblock
                  </Button>
                  <Button variant="destructive" size="sm" onClick={() => setIsBulkDeleteOpen(true)}>
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete
                  </Button>
                </div>
              )}
            </div>

            {viewMode === "grid" ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                {visiblePeople.map((person: any) => {
                  const personId = String(person.id);
                  const counts = getTaskCounts(person);
                  return (
                    <Card key={personId} className="relative h-full flex flex-col hover:border-primary hover:shadow-lg transition-all">
                      <div className="absolute top-3 left-3">
                        <Checkbox
                          checked={selectedPeopleIds.has(personId)}
                          onCheckedChange={() => togglePersonSelection(personId)}
                        />
                      </div>
                      <Link href={`/people/${personId}`} className="h-full flex flex-col">
                        <CardContent className="p-6 flex flex-col items-center text-center flex-grow">
                          <Avatar className="w-20 h-20 mb-4 border-2 border-primary/20">
                            <AvatarImage src={person.avatarUrl || `https://api.dicebear.com/8.x/initials/svg?seed=${person.name}`} alt={person.name} />
                            <AvatarFallback className="text-2xl">{getInitials(person.name)}</AvatarFallback>
                          </Avatar>
                          <h3 className="font-bold text-lg">{person.name}</h3>
                          {person.title && <p className="text-sm text-muted-foreground">{person.title}</p>}
                          {person.email && <p className="text-xs text-muted-foreground mt-1">{person.email}</p>}
                        </CardContent>
                        <CardFooter className="p-3 bg-muted/50 border-t flex justify-center items-center gap-2 text-sm text-muted-foreground">
                          <Briefcase size={14} />
                          <div className="flex items-center gap-2 text-xs">
                            <Badge variant="secondary">Todo {counts.todo}</Badge>
                            <Badge variant="outline">In progress {counts.inprogress}</Badge>
                            <Badge variant="outline">Done {counts.done}</Badge>
                          </div>
                        </CardFooter>
                      </Link>
                    </Card>
                  );
                })}
              </div>
            ) : (
              <div className="border rounded-lg overflow-hidden">
                <div className="grid grid-cols-[40px_1fr_1fr_140px] gap-4 items-center bg-muted/40 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <span />
                  <span>Name</span>
                  <span>Email</span>
                  <span>Tasks</span>
                </div>
                {visiblePeople.map((person: any) => {
                  const personId = String(person.id);
                  const counts = getTaskCounts(person);
                  return (
                    <div key={personId} className="grid grid-cols-[40px_1fr_1fr_140px] gap-4 items-center px-4 py-3 border-t">
                      <Checkbox
                        checked={selectedPeopleIds.has(personId)}
                        onCheckedChange={() => togglePersonSelection(personId)}
                      />
                      <Link href={`/people/${personId}`} className="flex items-center gap-3">
                        <Avatar className="h-9 w-9 border">
                          <AvatarImage src={person.avatarUrl || `https://api.dicebear.com/8.x/initials/svg?seed=${person.name}`} alt={person.name} />
                          <AvatarFallback>{getInitials(person.name)}</AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="font-semibold">{person.name}</p>
                          {person.title && <p className="text-xs text-muted-foreground">{person.title}</p>}
                        </div>
                      </Link>
                      <span className="text-sm text-muted-foreground">{person.email || "No email"}</span>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <Badge variant="secondary">Todo {counts.todo}</Badge>
                        <Badge variant="outline">In progress {counts.inprogress}</Badge>
                        <Badge variant="outline">Done {counts.done}</Badge>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {showBlocked && blockedPeople.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Blocked People</h3>
                  <Badge variant="destructive">{blockedPeople.length}</Badge>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                  {blockedPeople.map((person: any) => (
                    <Card key={person.id} className="border-dashed">
                      <CardContent className="p-5 flex items-center gap-4">
                        <Avatar className="h-12 w-12 border">
                          <AvatarImage src={person.avatarUrl || `https://api.dicebear.com/8.x/initials/svg?seed=${person.name}`} alt={person.name} />
                          <AvatarFallback>{getInitials(person.name)}</AvatarFallback>
                        </Avatar>
                        <div className="flex-1">
                          <p className="font-semibold">{person.name}</p>
                          <p className="text-xs text-muted-foreground">{person.email || "No email"}</p>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleUnblockPerson(person.id)}
                          disabled={isUpdatingBlocked === person.id}
                        >
                          {isUpdatingBlocked === person.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            "Unblock"
                          )}
                        </Button>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      <SlackSyncDialog
        isOpen={isSlackSyncDialogOpen}
        onClose={() => setIsSlackSyncDialogOpen(false)}
        onSynced={() => refreshPeople()}
      />
      <Dialog open={isAddPersonOpen} onOpenChange={setIsAddPersonOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Person</DialogTitle>
            <DialogDescription>
              Add someone manually to your people directory.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="person-name">Name</Label>
              <Input
                id="person-name"
                value={newPersonName}
                onChange={(event) => setNewPersonName(event.target.value)}
                placeholder="Jane Doe"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="person-email">Email</Label>
              <Input
                id="person-email"
                type="email"
                value={newPersonEmail}
                onChange={(event) => setNewPersonEmail(event.target.value)}
                placeholder="jane@company.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="person-title">Title</Label>
              <Input
                id="person-title"
                value={newPersonTitle}
                onChange={(event) => setNewPersonTitle(event.target.value)}
                placeholder="Product Manager"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddPersonOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreatePerson} disabled={isSavingPerson}>
              {isSavingPerson ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={isMatchDialogOpen} onOpenChange={setIsMatchDialogOpen}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>Match Discovered People</DialogTitle>
            <DialogDescription>
              Match discovered people (left) with saved profiles (right). Linking is irreversible and reassigns tasks.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_80px_1fr] gap-6 max-h-[65vh] overflow-auto pr-2">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">Discovered (not linked)</p>
                <Badge variant="secondary">{matchSources.length}</Badge>
              </div>
              <Input
                placeholder="Search discovered..."
                value={sourceSearch}
                onChange={(event) => setSourceSearch(event.target.value)}
              />
              <div className="space-y-2">
                {matchSources.length === 0 && (
                  <div className="text-xs text-muted-foreground text-center py-6">
                    No discovered people to match.
                  </div>
                )}
                {matchSources.map((person: any) => (
                  <div
                    key={person.id}
                    className={cn(
                      "flex items-center justify-between gap-2 rounded-md border p-2",
                      selectedSourceId === person.id && "border-primary bg-primary/5"
                    )}
                  >
                    <button
                      className="flex items-center gap-3 text-left flex-1"
                      onClick={() => {
                        setSelectedSourceId(person.id);
                        setSelectedTargetId(null);
                      }}
                    >
                      <Avatar className="h-8 w-8">
                        <AvatarImage src={person.avatarUrl || `https://api.dicebear.com/8.x/initials/svg?seed=${person.name}`} />
                        <AvatarFallback>{getInitials(person.name)}</AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="font-semibold text-sm">{person.name}</p>
                        <p className="text-xs text-muted-foreground">{person.email || "No email"}</p>
                      </div>
                    </button>
                    <Button variant="ghost" size="icon" onClick={() => handleDeleteSource(person.id)}>
                      <Trash2 className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
            <div className="hidden lg:flex items-center justify-center">
              <div className="flex flex-col items-center gap-2 text-xs text-muted-foreground">
                <span>Match</span>
                <span>?</span>
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">Saved</p>
                <Badge variant="secondary">{matchTargets.length}</Badge>
              </div>
              <Input
                placeholder="Search saved..."
                value={targetSearch}
                onChange={(event) => setTargetSearch(event.target.value)}
              />
              {selectedSourceId && rankedSuggestions.length > 0 && (
                <div className="rounded-md border p-3 bg-muted/30 space-y-2">
                  <p className="text-xs font-semibold uppercase text-muted-foreground">Suggested matches</p>
                  {rankedSuggestions.map((match: any) => (
                    <button
                      key={match.person.id}
                      className={cn(
                        "flex items-center justify-between gap-2 rounded-md border p-2 w-full text-left",
                        selectedTargetId === match.person.id && "border-primary bg-primary/5"
                      )}
                      onClick={() => setSelectedTargetId(match.person.id)}
                    >
                      <div className="flex items-center gap-3">
                        <Avatar className="h-7 w-7">
                          <AvatarImage src={match.person.avatarUrl || `https://api.dicebear.com/8.x/initials/svg?seed=${match.person.name}`} />
                          <AvatarFallback>{getInitials(match.person.name)}</AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="text-sm font-semibold">{match.person.name}</p>
                          <p className="text-xs text-muted-foreground">{match.person.email || "No email"}</p>
                        </div>
                      </div>
                      {renderMatchConfidence(match.confidence)}
                    </button>
                  ))}
                </div>
              )}
              <div className="space-y-2">
                {matchTargets.map((person: any) => (
                  <button
                    key={person.id}
                    className={cn(
                      "flex items-center gap-3 rounded-md border p-2 w-full text-left",
                      selectedTargetId === person.id && "border-primary bg-primary/5"
                    )}
                    onClick={() => setSelectedTargetId(person.id)}
                  >
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={person.avatarUrl || `https://api.dicebear.com/8.x/initials/svg?seed=${person.name}`} />
                      <AvatarFallback>{getInitials(person.name)}</AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="font-semibold text-sm">{person.name}</p>
                      <p className="text-xs text-muted-foreground">{person.email || "No email"}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter className="justify-between">
            <div className="text-xs text-muted-foreground">
              Merging will reassign tasks and remove the discovered profile from meetings and chats.
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => setIsMatchDialogOpen(false)}>
                Close
              </Button>
              <Button onClick={handleManualMerge} disabled={!selectedSourceId || !selectedTargetId}>
                Merge Selected
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog open={isBulkDeleteOpen} onOpenChange={setIsBulkDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete selected people?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the selected people from your directory and unassigns their tasks. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive hover:bg-destructive/90 text-destructive-foreground" onClick={handleBulkDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}



