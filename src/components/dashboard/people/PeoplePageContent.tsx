// src/components/dashboard/people/PeoplePageContent.tsx
"use client";

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Users, UserPlus, Info, Loader2, Mail, Briefcase, Slack } from 'lucide-react';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { useAuth } from '@/contexts/AuthContext';
import { useIntegrations } from '@/contexts/IntegrationsContext';
import { onPeopleSnapshot } from '@/lib/data';
import type { PersonWithTaskCount } from '@/types/person';
import DashboardHeader from '../DashboardHeader';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';

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
  const [isSyncingSlack, setIsSyncingSlack] = useState(false);

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
  }, [user]);

  const handleSyncSlackUsers = async () => {
    if (!isSlackConnected) {
      toast({
        title: "Slack not connected",
        description: "Connect Slack in Settings before syncing.",
        variant: "destructive",
      });
      return;
    }
    setIsSyncingSlack(true);
    try {
      const response = await fetch("/api/slack/users/sync", { method: "POST" });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Slack sync failed.");
      }
      toast({
        title: "Slack users synced",
        description: `Added ${data.created} and updated ${data.updated} people.`,
      });
    } catch (error: any) {
      toast({
        title: "Slack sync failed",
        description: error.message || "Could not sync Slack users.",
        variant: "destructive",
      });
    } finally {
      setIsSyncingSlack(false);
    }
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
            onClick={handleSyncSlackUsers}
            disabled={!isSlackConnected || isSyncingSlack}
          >
            {isSyncingSlack ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Slack className="h-4 w-4 mr-2" />
            )}
            Sync Slack Users
          </Button>
          <Button>
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
        ) : people.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>Directory is Empty</CardTitle>
              <CardDescription>
                No people have been extracted yet. Process a meeting transcript in the "Chat" or "Planning" page to get started.
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
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {people.map(person => (
              <Link href={`/people/${person.id}`} key={person.id} passHref>
                <Card className="h-full flex flex-col hover:border-primary hover:shadow-lg transition-all cursor-pointer">
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
                      <span>{person.taskCount} Assigned Task{person.taskCount !== 1 ? 's' : ''}</span>
                  </CardFooter>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
