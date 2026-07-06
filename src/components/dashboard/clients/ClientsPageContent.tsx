// src/components/dashboard/clients/ClientsPageContent.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { format, formatDistanceToNow } from 'date-fns';
import {
  ArrowUpRight,
  Building2,
  CalendarClock,
  Clock,
  Loader2,
  MoreHorizontal,
  UserCheck,
  Wand2,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import DashboardHeader from '../DashboardHeader';
import DashboardScreenSkeleton from '@/components/dashboard/DashboardScreenSkeleton';
import EmptyState from '@/components/common/EmptyState';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { apiFetch } from '@/lib/api';
import { subscribeRealtimeUpdates } from '@/lib/realtime-client';
import { updatePerson } from '@/lib/data';
import type { Company } from '@/types/company';
import type { PersonWithTaskCount } from '@/types/person';

interface ClientGroup {
  key: string;
  name: string;
  /** First-class company id when the group matches a companies record. */
  companyId: string | null;
  people: PersonWithTaskCount[];
  openCount: number;
  overdueCount: number;
  lastMeetingAt: string | null;
}

interface ReclassifyResult {
  ok: boolean;
  scanned: number;
  updated: number;
  counts: { teammate: number; client: number; unknown: number };
}

const getInitials = (name: string | null | undefined) => {
  if (!name) return 'U';
  return name.split(' ').map((n) => n[0]).join('').toUpperCase().substring(0, 2);
};

const extractEmailDomain = (email?: string | null): string | null => {
  if (!email) return null;
  const trimmed = email.trim().toLowerCase();
  const atIndex = trimmed.lastIndexOf('@');
  if (atIndex <= 0 || atIndex === trimmed.length - 1) return null;
  const domain = trimmed.slice(atIndex + 1);
  if (!domain.includes('.') || /\s/.test(domain)) return null;
  return domain;
};

const parseDate = (value?: string | null): Date | null => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
};

const formatRelativeDate = (value?: string | null): string | null => {
  const date = parseDate(value);
  return date ? formatDistanceToNow(date, { addSuffix: true }) : null;
};

const formatShortDate = (value?: string | null): string | null => {
  const date = parseDate(value);
  return date ? format(date, 'MMM d, yyyy') : null;
};

const getOpenTaskCount = (person: PersonWithTaskCount) =>
  person.taskCounts?.open ?? person.taskCount ?? 0;

const getOverdueTaskCount = (person: PersonWithTaskCount) =>
  person.overdueTaskCount ?? 0;

function OverdueBadge({ count }: { count: number }) {
  if (count > 0) {
    return <Badge variant="destructive">Overdue {count}</Badge>;
  }
  return (
    <Badge variant="outline" className="text-muted-foreground">
      Overdue 0
    </Badge>
  );
}

function ClientPersonRow({
  person,
  onMarkTeammate,
  isMarking,
}: {
  person: PersonWithTaskCount;
  onMarkTeammate: (person: PersonWithTaskCount) => void;
  isMarking: boolean;
}) {
  const openCount = getOpenTaskCount(person);
  const overdueCount = getOverdueTaskCount(person);
  const lastContact = formatRelativeDate(person.lastMeetingAt);
  const followUp = formatShortDate(person.nextFollowUpAt);

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 border-t">
      <Link href={`/people/${person.id}`} className="flex items-center gap-3 min-w-0 flex-1">
        <Avatar className="h-9 w-9 border">
          <AvatarImage
            src={person.avatarUrl || `https://api.dicebear.com/8.x/initials/svg?seed=${person.name}`}
            alt={person.name}
          />
          <AvatarFallback>{getInitials(person.name)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p className="font-semibold text-sm truncate">{person.name}</p>
          <p className="text-xs text-muted-foreground truncate">{person.email || 'No email'}</p>
        </div>
      </Link>
      <div className="flex items-center gap-2 text-xs">
        <Badge variant="secondary">Open {openCount}</Badge>
        <OverdueBadge count={overdueCount} />
      </div>
      <div className="hidden md:flex flex-col items-end gap-0.5 text-xs text-muted-foreground min-w-[150px]">
        <span className="flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {lastContact ? `Last contact ${lastContact}` : 'No meetings yet'}
        </span>
        {followUp && (
          <span className="flex items-center gap-1">
            <CalendarClock className="h-3 w-3" />
            Follow up {followUp}
          </span>
        )}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8" title="Client actions">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <Link href={`/people/${person.id}`}>
              <ArrowUpRight className="mr-2 h-4 w-4" />
              Open person
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onMarkTeammate(person)} disabled={isMarking}>
            {isMarking ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <UserCheck className="mr-2 h-4 w-4" />
            )}
            Mark as teammate
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function ClientGroupCard({
  group,
  onMarkTeammate,
  markingId,
}: {
  group: ClientGroup;
  onMarkTeammate: (person: PersonWithTaskCount) => void;
  markingId: string | null;
}) {
  const lastMeeting = formatRelativeDate(group.lastMeetingAt);

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
              <Building2 className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="min-w-0">
              {group.companyId ? (
                <Link
                  href={`/clients/${group.companyId}`}
                  className="group/company inline-flex items-center gap-1"
                >
                  <CardTitle className="text-base truncate group-hover/company:underline">
                    {group.name}
                  </CardTitle>
                  <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
                </Link>
              ) : (
                <CardTitle className="text-base truncate">{group.name}</CardTitle>
              )}
              <CardDescription className="text-xs">
                {group.people.length} {group.people.length === 1 ? 'person' : 'people'}
                {lastMeeting ? ` · Last meeting ${lastMeeting}` : ' · No meetings yet'}
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary">Open {group.openCount}</Badge>
            <OverdueBadge count={group.overdueCount} />
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5 pt-2">
          {group.people.map((person) => (
            <Badge key={person.id} variant="outline" className="font-normal">
              {person.name}
            </Badge>
          ))}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {group.people.map((person) => (
          <ClientPersonRow
            key={person.id}
            person={person}
            onMarkTeammate={onMarkTeammate}
            isMarking={markingId === person.id}
          />
        ))}
      </CardContent>
    </Card>
  );
}

export default function ClientsPageContent() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [clients, setClients] = useState<PersonWithTaskCount[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isReclassifying, setIsReclassifying] = useState(false);
  const [markingTeammateId, setMarkingTeammateId] = useState<string | null>(null);

  const refreshClients = useCallback(async () => {
    try {
      const people = await apiFetch<PersonWithTaskCount[]>('/api/people?type=client');
      setClients(people.filter((person) => !person.isBlocked));
    } catch (error) {
      console.error('Failed to load clients:', error);
    }
    try {
      // GET /api/companies also resolves-or-creates companies from the
      // clients' manual company values and email domains (idempotent).
      const companyList = await apiFetch<Company[]>('/api/companies');
      setCompanies(Array.isArray(companyList) ? companyList : []);
    } catch (error) {
      console.error('Failed to load companies:', error);
    }
  }, []);

  useEffect(() => {
    if (!user?.uid) {
      setClients([]);
      setIsLoading(false);
      return;
    }
    let active = true;
    setIsLoading(true);
    const load = async () => {
      await refreshClients();
      if (active) setIsLoading(false);
    };
    void load();
    const unsubscribe = subscribeRealtimeUpdates(
      ['people', 'meetings', 'tasks', 'board'],
      () => {
        void refreshClients();
      }
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, [user?.uid, refreshClients]);

  const groups = useMemo<ClientGroup[]>(() => {
    // Match a group to a first-class company record: primarily by shared
    // people ids, falling back to name/alias/domain equality.
    const companyByPersonId = new Map<string, Company>();
    companies.forEach((company) => {
      (company.peopleIds || []).forEach((personId) => {
        if (!companyByPersonId.has(personId)) {
          companyByPersonId.set(personId, company);
        }
      });
    });
    const companyByNameKey = new Map<string, Company>();
    companies.forEach((company) => {
      const keys = [company.name, company.domain || '', ...(company.aliases || [])]
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean);
      keys.forEach((key) => {
        if (!companyByNameKey.has(key)) companyByNameKey.set(key, company);
      });
    });

    const map = new Map<string, ClientGroup>();
    clients.forEach((person) => {
      const company = person.company?.trim();
      const name = company || extractEmailDomain(person.email) || 'No company';
      const key = name.toLowerCase();
      let group = map.get(key);
      if (!group) {
        group = {
          key,
          name,
          companyId: companyByNameKey.get(key)?.id ?? null,
          people: [],
          openCount: 0,
          overdueCount: 0,
          lastMeetingAt: null,
        };
        map.set(key, group);
      }
      if (!group.companyId) {
        group.companyId = companyByPersonId.get(person.id)?.id ?? null;
      }
      group.people.push(person);
      group.openCount += getOpenTaskCount(person);
      group.overdueCount += getOverdueTaskCount(person);
      if (
        person.lastMeetingAt &&
        (!group.lastMeetingAt || person.lastMeetingAt > group.lastMeetingAt)
      ) {
        group.lastMeetingAt = person.lastMeetingAt;
      }
    });
    return Array.from(map.values())
      .map((group) => ({
        ...group,
        people: [...group.people].sort(
          (a, b) =>
            getOverdueTaskCount(b) - getOverdueTaskCount(a) ||
            (a.name || '').localeCompare(b.name || '')
        ),
      }))
      .sort((a, b) => {
        if (b.overdueCount !== a.overdueCount) return b.overdueCount - a.overdueCount;
        if (a.lastMeetingAt !== b.lastMeetingAt) {
          if (!a.lastMeetingAt) return 1;
          if (!b.lastMeetingAt) return -1;
          return b.lastMeetingAt.localeCompare(a.lastMeetingAt);
        }
        return a.name.localeCompare(b.name);
      });
  }, [clients, companies]);

  const handleReclassify = async () => {
    setIsReclassifying(true);
    try {
      const result = await apiFetch<ReclassifyResult>('/api/people/reclassify', {
        method: 'POST',
      });
      toast({
        title: 'Classification complete',
        description: `${result.scanned} people scanned, ${result.updated} updated. Found ${result.counts.client} ${result.counts.client === 1 ? 'client' : 'clients'}.`,
      });
      await refreshClients();
    } catch (error) {
      console.error('Failed to reclassify people:', error);
      toast({
        title: 'Classification failed',
        description: 'Could not auto-classify people. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsReclassifying(false);
    }
  };

  const handleMarkTeammate = async (person: PersonWithTaskCount) => {
    if (!user?.uid) return;
    setMarkingTeammateId(person.id);
    try {
      await updatePerson(user.uid, person.id, { personType: 'teammate' });
      toast({
        title: 'Marked as teammate',
        description: `${person.name} was moved to your team.`,
      });
      await refreshClients();
    } catch (error) {
      console.error('Failed to mark person as teammate:', error);
      toast({
        title: 'Update failed',
        description: 'Could not update this person.',
        variant: 'destructive',
      });
    } finally {
      setMarkingTeammateId(null);
    }
  };

  const reclassifyButton = (
    <Button variant="outline" onClick={handleReclassify} disabled={isReclassifying}>
      {isReclassifying ? (
        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
      ) : (
        <Wand2 className="h-4 w-4 mr-2" />
      )}
      Auto-classify people
    </Button>
  );

  return (
    <div className="flex flex-col h-full">
      <DashboardHeader
        pageIcon={Building2}
        pageTitle={<h1 className="text-2xl font-bold font-headline">Clients</h1>}
        description="See which external people and companies are waiting on you."
      >
        <div className="flex items-center gap-2">{reclassifyButton}</div>
      </DashboardHeader>

      <div className="flex-grow p-4 sm:p-6 lg:p-8 space-y-6 overflow-auto">
        {isLoading ? (
          <DashboardScreenSkeleton className="px-0 py-2" />
        ) : clients.length === 0 ? (
          <Card>
            <CardContent className="py-8">
              <EmptyState
                icon={Building2}
                title="No clients yet"
                description="People with an external, non-free email domain are classified as clients automatically. Run auto-classification to sort your directory, or set someone's type to Client from their profile."
                action={
                  <Button onClick={handleReclassify} disabled={isReclassifying}>
                    {isReclassifying ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Wand2 className="h-4 w-4 mr-2" />
                    )}
                    Auto-classify people
                  </Button>
                }
              />
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            <p className="text-sm text-muted-foreground">
              {clients.length} {clients.length === 1 ? 'client' : 'clients'} across {groups.length}{' '}
              {groups.length === 1 ? 'company' : 'companies'}
            </p>
            {groups.map((group) => (
              <ClientGroupCard
                key={group.key}
                group={group}
                onMarkTeammate={handleMarkTeammate}
                markingId={markingTeammateId}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
