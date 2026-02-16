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
import { Loader2, UserCheck, UserPlus, Info, Sparkles } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { getBestPersonMatch, getRankedPersonMatches, type CandidateMatch } from '@/lib/people-matching';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';


interface PeopleDiscoveryDialogProps {
  isOpen: boolean;
  onClose: (peopleToCreate: Partial<Person>[]) => void;
  onMatch?: (payload: { person: Partial<Person>; matchedPerson: Person }) => Promise<void> | void;
  discoveredPeople: any[]; // People from AI
  existingPeople: Person[]; // People from directory
}

const getInitials = (name: string) => name ? name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2) : 'U';

export default function PeopleDiscoveryDialog({
  isOpen,
  onClose,
  onMatch,
  discoveredPeople,
  existingPeople,
}: PeopleDiscoveryDialogProps) {
  const [peopleToCreate, setPeopleToCreate] = useState<Set<string>>(new Set());
  const [resolvedKeys, setResolvedKeys] = useState<Set<string>>(new Set());
  const [matchCandidate, setMatchCandidate] = useState<any | null>(null);
  const [matchSuggestions, setMatchSuggestions] = useState<CandidateMatch[]>([]);
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const [isMatching, setIsMatching] = useState(false);

  const getPersonKey = (person: { name?: string; email?: string | null }) =>
    (person.email || person.name || "").toLowerCase();

  const {
    newPeople,
    existingDiscoveredPeople,
    potentialMatches,
  } = useMemo(() => {
    const existingNames = new Set(existingPeople.map(p => p.name.toLowerCase()));
    const existingEmails = new Set(existingPeople.map(p => p.email?.toLowerCase()).filter(Boolean));
    const blockedNames = new Set(existingPeople.filter(p => p.isBlocked).map(p => p.name.toLowerCase()));
    const blockedEmails = new Set(existingPeople.filter(p => p.isBlocked && p.email).map(p => p.email!.toLowerCase()));

    const filteredDiscovered = discoveredPeople.filter(dp => {
        const nameKey = dp.name?.toLowerCase();
        const emailKey = dp.email?.toLowerCase();
        if (nameKey && blockedNames.has(nameKey)) return false;
        if (emailKey && blockedEmails.has(emailKey)) return false;
        return true;
    });

    const autoMatchThreshold = 0.9;
    const reviewMatchThreshold = 0.78;

    const newPeople: any[] = [];
    const existingDiscoveredPeople: any[] = [];
    const potentialMatches: any[] = [];

    filteredDiscovered.forEach(dp => {
      const nameKey = dp.name?.toLowerCase();
      const emailKey = dp.email?.toLowerCase();
      const isExactMatch =
        (nameKey && existingNames.has(nameKey)) ||
        (emailKey && existingEmails.has(emailKey));

      if (isExactMatch) {
        existingDiscoveredPeople.push({ ...dp, matchConfidence: 1 });
        return;
      }

      const autoMatch = getBestPersonMatch(
        { name: dp.name, email: dp.email },
        existingPeople,
        autoMatchThreshold
      );
      if (autoMatch) {
        existingDiscoveredPeople.push({
          ...dp,
          matchConfidence: autoMatch.confidence,
          matchedPerson: autoMatch.person,
        });
        return;
      }

      const reviewMatch = getBestPersonMatch(
        { name: dp.name, email: dp.email },
        existingPeople,
        reviewMatchThreshold
      );
      if (reviewMatch) {
        potentialMatches.push({
          ...dp,
          matchedPerson: reviewMatch.person,
          matchConfidence: reviewMatch.confidence,
        });
        return;
      }

      newPeople.push(dp);
    });

    return { newPeople, existingDiscoveredPeople, potentialMatches };
  }, [discoveredPeople, existingPeople]);


  useEffect(() => {
    if (isOpen) {
      // Pre-select all new people by default
      const initialKeys = new Set(
        newPeople.map((person: any) => getPersonKey(person))
      );
      setPeopleToCreate(initialKeys);
    }
    setResolvedKeys(new Set());
    setMatchCandidate(null);
    setSelectedMatchId(null);
    setMatchSuggestions([]);
  }, [isOpen, newPeople]);

  useEffect(() => {
    if (!isOpen || !onMatch) return;
    let active = true;
    const autoThreshold = 0.95;
    const candidates = [...newPeople, ...potentialMatches].filter(
      (person) => !resolvedKeys.has(getPersonKey(person))
    );
    if (candidates.length === 0) return;

    const run = async () => {
      for (const candidate of candidates) {
        if (!active) return;
        const best = getBestPersonMatch(
          { name: candidate.name, email: candidate.email },
          existingPeople,
          autoThreshold
        );
        if (!best) continue;
        await onMatch({ person: candidate, matchedPerson: best.person });
        const key = getPersonKey(candidate);
        setResolvedKeys((prev) => new Set(prev).add(key));
        setPeopleToCreate((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    };

    run();
    return () => {
      active = false;
    };
  }, [isOpen, onMatch, newPeople, potentialMatches, existingPeople, resolvedKeys]);

  const handleTogglePerson = (key: string) => {
    setPeopleToCreate(prev => {
      const newSet = new Set(prev);
      if (newSet.has(key)) {
        newSet.delete(key);
      } else {
        newSet.add(key);
      }
      return newSet;
    });
  };

  const handleConfirm = () => {
    const selectedKeys = peopleToCreate;
    const allCandidates = [
      ...newPeople,
      ...potentialMatches,
    ].filter((person: any) => !resolvedKeys.has(getPersonKey(person)));
    const finalPeopleToCreate = allCandidates.filter((p: any) =>
      selectedKeys.has(getPersonKey(p))
    );
    
    // IMPORTANT: Strip the `isExisting` property before passing it to the parent.
    const cleanPeopleData = finalPeopleToCreate.map(({ isExisting, matchConfidence, matchedPerson, ...rest }) => rest);

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
  const totalNew = newPeople.filter((person: any) => !resolvedKeys.has(getPersonKey(person))).length;
  const totalExisting = existingDiscoveredPeople.length;
  const totalPotential = potentialMatches.length;

  const renderConfidenceBadge = (confidence: number) => {
    const label =
      confidence >= 0.9 ? "High" : confidence >= 0.8 ? "Medium" : "Low";
    const variant = confidence >= 0.9 ? "default" : confidence >= 0.8 ? "secondary" : "outline";
    return <Badge variant={variant}>{label} ({Math.round(confidence * 100)}%)</Badge>;
  };


  const openMatchDialog = (person: any) => {
    const suggestions = getRankedPersonMatches(
      { name: person.name, email: person.email },
      existingPeople,
      6
    );
    setMatchCandidate(person);
    setMatchSuggestions(suggestions);
    setSelectedMatchId(suggestions[0]?.person.id || null);
  };

  const handleConfirmMatch = async () => {
    if (!matchCandidate || !selectedMatchId || !onMatch) return;
    const matchedPerson = existingPeople.find((person: any) => person.id === selectedMatchId);
    if (!matchedPerson) return;
    setIsMatching(true);
    try {
      await onMatch({ person: matchCandidate, matchedPerson });
      const key = getPersonKey(matchCandidate);
      setResolvedKeys((prev) => new Set(prev).add(key));
      setPeopleToCreate((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      setMatchCandidate(null);
      setSelectedMatchId(null);
      setMatchSuggestions([]);
    } finally {
      setIsMatching(false);
    }
  };

  const visibleNewPeople = newPeople.filter(
    (person) => !resolvedKeys.has(getPersonKey(person))
  );
  const visiblePotentialMatches = potentialMatches.filter(
    (person) => !resolvedKeys.has(getPersonKey(person))
  );
  const visibleExistingMatches = existingDiscoveredPeople.filter(
    (person) => !resolvedKeys.has(getPersonKey(person))
  );

  return (
    <>
      <Dialog open={isOpen} onOpenChange={() => onClose([])}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>People Discovered</DialogTitle>
            <DialogDescription>
              The AI found {totalDiscovered} people. {totalNew > 0 ? `${totalNew} are new and will be added to your directory.` : `All people found already exist in your directory.`}
              {totalPotential > 0 ? ` ${totalPotential} look similar to existing people.` : ""}
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-80 -mx-6 px-6">
            <div className="space-y-4">
              {visibleNewPeople.length > 0 && (
                  <div>
                      <h4 className="text-sm font-semibold mb-2 flex items-center gap-2"><UserPlus className="h-4 w-4 text-primary"/> New People to Add</h4>
                      <div className="space-y-1 rounded-lg border p-2">
                          {visibleNewPeople.map((person, index) => (
                              <div key={`new-${index}`} className="flex items-center gap-3 p-2 rounded-md hover:bg-muted/50">
                                  <Checkbox 
                                      id={`person-new-${index}`}
                                      checked={peopleToCreate.has(getPersonKey(person))}
                                      onCheckedChange={() => handleTogglePerson(getPersonKey(person))}
                                  />
                                  <Avatar className="h-8 w-8">
                                      <AvatarImage src={`https://api.dicebear.com/8.x/initials/svg?seed=${person.name}`} />
                                      <AvatarFallback>{getInitials(person.name)}</AvatarFallback>
                                  </Avatar>
                                  <Label htmlFor={`person-new-${index}`} className="flex-grow cursor-pointer">
                                      <p className="font-semibold text-sm">{person.name}</p>
                                      {person.title && <p className="text-xs text-muted-foreground">{person.title}</p>}
                                  </Label>
                                  {onMatch && (
                                    <Button
                                      variant="outline"
                                      size="xs"
                                      onClick={() => openMatchDialog(person)}
                                    >
                                      <Sparkles className="h-3 w-3 mr-1" />
                                      Match
                                    </Button>
                                  )}
                              </div>
                          ))}
                      </div>
                  </div>
              )}
              {visiblePotentialMatches.length > 0 && (
                   <div>
                      <h4 className="text-sm font-semibold mb-2 flex items-center gap-2"><UserCheck className="h-4 w-4 text-yellow-500"/> Possible Matches</h4>
                      <div className="space-y-2 rounded-lg border p-2 bg-muted/20">
                          {visiblePotentialMatches.map((person, index) => (
                              <div key={`potential-${index}`} className="flex items-start gap-3 p-2 rounded-md hover:bg-muted/40">
                                  <Checkbox
                                    id={`person-potential-${index}`}
                                    checked={peopleToCreate.has(getPersonKey(person))}
                                    onCheckedChange={() => handleTogglePerson(getPersonKey(person))}
                                  />
                                  <div className="flex-1">
                                    <div className="flex items-center gap-2">
                                      <Avatar className="h-7 w-7">
                                        <AvatarImage src={`https://api.dicebear.com/8.x/initials/svg?seed=${person.name}`} />
                                        <AvatarFallback>{getInitials(person.name)}</AvatarFallback>
                                      </Avatar>
                                      <div>
                                        <p className="font-semibold text-sm">{person.name}</p>
                                        {person.title && <p className="text-xs text-muted-foreground">{person.title}</p>}
                                      </div>
                                    </div>
                                    {person.matchedPerson && (
                                      <div className="mt-2 text-xs text-muted-foreground flex items-center gap-2">
                                        <span>Matches</span>
                                        <span className="font-semibold text-foreground">{person.matchedPerson.name}</span>
                                        {renderConfidenceBadge(person.matchConfidence || 0)}
                                      </div>
                                    )}
                                    <p className="text-xs text-muted-foreground mt-1">Leave unchecked to avoid creating a duplicate.</p>
                                  </div>
                              </div>
                          ))}
                      </div>
                  </div>
              )}
            {visibleExistingMatches.length > 0 && (
                 <div>
                    <h4 className="text-sm font-semibold mb-2 flex items-center gap-2"><UserCheck className="h-4 w-4 text-green-500"/> Matched Existing People</h4>
                     <div className="space-y-1 rounded-lg border p-2 bg-muted/30">
                        {visibleExistingMatches.map((person, index) => (
                            <div key={`existing-${index}`} className="flex items-center gap-3 p-2 rounded-md opacity-80">
                                <UserCheck className="h-5 w-5 text-green-500 ml-1.5 flex-shrink-0"/>
                                <Avatar className="h-8 w-8">
                                    <AvatarImage src={`https://api.dicebear.com/8.x/initials/svg?seed=${person.name}`} />
                                      <AvatarFallback>{getInitials(person.name)}</AvatarFallback>
                                  </Avatar>
                                  <div className="flex-1">
                                      <p className="font-semibold text-sm">{person.name}</p>
                                      {person.title && <p className="text-xs text-muted-foreground">{person.title}</p>}
                                  </div>
                                  {person.matchConfidence !== undefined && renderConfidenceBadge(person.matchConfidence)}
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
      <Dialog open={Boolean(matchCandidate)} onOpenChange={() => setMatchCandidate(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Match to Existing Person</DialogTitle>
            <DialogDescription>
              Choose an existing person to link with this discovered profile. This action is irreversible.
            </DialogDescription>
          </DialogHeader>
          {matchCandidate && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <Avatar className="h-10 w-10">
                  <AvatarImage src={`https://api.dicebear.com/8.x/initials/svg?seed=${matchCandidate.name}`} />
                  <AvatarFallback>{getInitials(matchCandidate.name)}</AvatarFallback>
                </Avatar>
                <div>
                  <p className="font-semibold">{matchCandidate.name}</p>
                  <p className="text-xs text-muted-foreground">{matchCandidate.email || "No email"}</p>
                </div>
              </div>
              {matchSuggestions.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase text-muted-foreground">Top suggestions</p>
                  <div className="space-y-2">
                    {matchSuggestions.map((match: any) => (
                      <button
                        key={match.person.id}
                        className={cn(
                          "w-full flex items-center justify-between gap-3 rounded-md border p-2 text-left",
                          selectedMatchId === match.person.id && "border-primary bg-primary/5"
                        )}
                        onClick={() => setSelectedMatchId(match.person.id)}
                      >
                        <div className="flex items-center gap-3">
                          <Avatar className="h-8 w-8">
                            <AvatarImage src={match.person.avatarUrl || `https://api.dicebear.com/8.x/initials/svg?seed=${match.person.name}`} />
                            <AvatarFallback>{getInitials(match.person.name)}</AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="font-semibold text-sm">{match.person.name}</p>
                            <p className="text-xs text-muted-foreground">{match.person.email || "No email"}</p>
                          </div>
                        </div>
                        {renderConfidenceBadge(match.confidence)}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="space-y-2">
                <Label className="text-xs uppercase text-muted-foreground">Manual match</Label>
                <Select value={selectedMatchId ?? ""} onValueChange={setSelectedMatchId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a person" />
                  </SelectTrigger>
                  <SelectContent>
                    {existingPeople.map((person: any) => (
                      <SelectItem key={person.id} value={person.id}>
                        {person.name} {person.email ? `(${person.email})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Alert>
                <AlertTitle>Irreversible</AlertTitle>
                <AlertDescription>
                  This will link the discovered person to an existing profile and skip creating a new entry.
                </AlertDescription>
              </Alert>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                if (matchCandidate) {
                  const key = getPersonKey(matchCandidate);
                  setPeopleToCreate((prev) => {
                    const next = new Set(prev);
                    next.add(key);
                    return next;
                  });
                }
                setMatchCandidate(null);
              }}
            >
              Create new person instead
            </Button>
            <Button variant="outline" onClick={() => setMatchCandidate(null)}>
              Cancel
            </Button>
            <Button onClick={handleConfirmMatch} disabled={!selectedMatchId || isMatching}>
              {isMatching ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Confirm Match
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

