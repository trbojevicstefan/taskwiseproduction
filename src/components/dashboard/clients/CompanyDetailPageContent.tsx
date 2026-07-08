// src/components/dashboard/clients/CompanyDetailPageContent.tsx
"use client";

/**
 * Priority 9 — company/account profile page. Aggregates the company's people,
 * meetings, and open commitments from GET /api/companies/[id], and offers a
 * one-click source-grounded report plus inline editing of the company record.
 */

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { format, formatDistanceToNow } from 'date-fns';
import {
  AlertTriangle,
  Building2,
  CalendarClock,
  CalendarDays,
  ClipboardList,
  Edit3,
  FileText,
  Globe,
  Loader2,
  Users,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import DashboardHeader from '../DashboardHeader';
import DashboardScreenSkeleton from '@/components/dashboard/DashboardScreenSkeleton';
import ProfileReportDialog from '@/components/dashboard/common/ProfileReportDialog';
import EmptyState from '@/components/common/EmptyState';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { apiFetch } from '@/lib/api';
import { cn } from '@/lib/utils';
import type {
  Company,
  CompanyMeetingSummary,
  CompanyProfileStats,
  CompanyTaskSummary,
} from '@/types/company';

interface CompanyPersonSummary {
  id: string;
  name: string;
  email: string | null;
  title: string | null;
  avatarUrl: string | null;
  personType: string;
  nextFollowUpAt: string | null;
}

interface CompanyProfileResponse {
  company: Company;
  people: CompanyPersonSummary[];
  meetings: CompanyMeetingSummary[];
  openTasks: CompanyTaskSummary[];
  stats: CompanyProfileStats;
}

interface CompanyDetailPageContentProps {
  companyId: string;
}

const getInitials = (name: string | null | undefined) => {
  if (!name) return 'C';
  return name.split(' ').map((n) => n[0]).join('').toUpperCase().substring(0, 2);
};

const formatShortDate = (value?: string | null): string | null => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : format(date, 'MMM d, yyyy');
};

const formatRelative = (value?: string | null): string | null => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? null
    : formatDistanceToNow(date, { addSuffix: true });
};

export default function CompanyDetailPageContent({
  companyId,
}: CompanyDetailPageContentProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [profile, setProfile] = useState<CompanyProfileResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isReportOpen, setIsReportOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDomain, setEditDomain] = useState('');
  const [editAliases, setEditAliases] = useState('');

  const loadProfile = useCallback(async () => {
    try {
      const payload = await apiFetch<CompanyProfileResponse>(
        `/api/companies/${companyId}`
      );
      setProfile(payload);
      setLoadError(null);
    } catch (error) {
      console.error('Failed to load company profile:', error);
      setLoadError('Company not found or could not be loaded.');
    }
  }, [companyId]);

  useEffect(() => {
    if (!user?.uid) {
      setIsLoading(false);
      return;
    }
    let active = true;
    setIsLoading(true);
    loadProfile().finally(() => {
      if (active) setIsLoading(false);
    });
    return () => {
      active = false;
    };
  }, [user?.uid, loadProfile]);

  const openEditDialog = () => {
    if (!profile) return;
    setEditName(profile.company.name);
    setEditDomain(profile.company.domain || '');
    setEditAliases((profile.company.aliases || []).join(', '));
    setIsEditOpen(true);
  };

  const handleSaveCompany = async () => {
    if (!profile) return;
    setIsSaving(true);
    try {
      await apiFetch(`/api/companies/${profile.company.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: editName.trim() || profile.company.name,
          domain: editDomain.trim() || null,
          aliases: editAliases
            .split(',')
            .map((alias) => alias.trim())
            .filter(Boolean),
        }),
      });
      toast({ title: 'Company updated', description: 'Changes were saved.' });
      setIsEditOpen(false);
      await loadProfile();
    } catch (error) {
      console.error('Failed to update company:', error);
      toast({
        title: 'Update failed',
        description: 'Could not save the company changes.',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return <DashboardScreenSkeleton className="py-8" />;
  }

  if (loadError || !profile) {
    return (
      <div className="text-center py-20">
        <h2 className="text-2xl font-bold">Company Not Found</h2>
        <p className="text-muted-foreground">
          {loadError || 'The company you are looking for does not exist.'}
        </p>
        <Link href="/clients">
          <Button variant="link" className="mt-4">Back to Clients</Button>
        </Link>
      </div>
    );
  }

  const { company, people, meetings, openTasks, stats } = profile;
  const lastContacted = formatRelative(stats.lastContactedAt);
  const nextFollowUp = formatShortDate(stats.nextFollowUpAt);

  return (
    <div className="flex flex-col h-full">
      <DashboardHeader
        pageIcon={Building2}
        pageTitle={
          <h1 className="text-2xl font-bold font-headline">{company.name}</h1>
        }
        description="Company profile: people, meetings, and open commitments."
      >
        <Button variant="outline" onClick={openEditDialog}>
          <Edit3 className="mr-2 h-4 w-4" />
          Edit company
        </Button>
        <Button onClick={() => setIsReportOpen(true)}>
          <FileText className="mr-2 h-4 w-4" />
          Generate report
        </Button>
      </DashboardHeader>

      <div className="flex-grow p-4 sm:p-6 lg:p-8 space-y-6 overflow-auto">
        <div className="max-w-5xl mx-auto space-y-6">
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {company.domain && (
              <Badge variant="outline" className="flex items-center gap-1">
                <Globe className="h-3 w-3" />
                {company.domain}
              </Badge>
            )}
            {(company.aliases || []).map((alias) => (
              <Badge key={alias} variant="secondary" className="font-normal">
                {alias}
              </Badge>
            ))}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3" data-testid="company-stats">
            <div className="dense-card">
              <p className="text-xs text-muted-foreground">People</p>
              <p className="text-xl font-semibold">{stats.peopleCount}</p>
            </div>
            <div className="dense-card">
              <p className="text-xs text-muted-foreground">Open</p>
              <p className="text-xl font-semibold">{stats.openTaskCount}</p>
            </div>
            <div className="dense-card">
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" /> Overdue
              </p>
              <p className={cn('text-xl font-semibold', stats.overdueTaskCount > 0 && 'text-destructive')}>
                {stats.overdueTaskCount}
              </p>
            </div>
            <div className="dense-card">
              <p className="text-xs text-muted-foreground">Completed</p>
              <p className="text-xl font-semibold">{stats.completedTaskCount}</p>
            </div>
            <div className="dense-card">
              <p className="text-xs text-muted-foreground">Last contacted</p>
              <p className="text-sm font-medium">{lastContacted || 'Never'}</p>
            </div>
            <div className="dense-card">
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <CalendarClock className="h-3 w-3" /> Follow-up
              </p>
              <p className="text-sm font-medium">{nextFollowUp || 'Not set'}</p>
            </div>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-3">
                <Users className="text-muted-foreground" /> People ({people.length})
              </CardTitle>
              <CardDescription>
                Everyone linked to {company.name}. Open a profile for tasks and history.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {people.length ? (
                people.map((person) => (
                  <Link
                    key={person.id}
                    href={`/people/${person.id}`}
                    className="data-row flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors"
                  >
                    <Avatar className="h-9 w-9 border">
                      <AvatarImage
                        src={person.avatarUrl || `https://api.dicebear.com/8.x/initials/svg?seed=${person.name}`}
                        alt={person.name}
                      />
                      <AvatarFallback>{getInitials(person.name)}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-sm truncate">{person.name}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {person.title || person.email || 'No details'}
                      </p>
                    </div>
                    <Badge variant="outline" className="capitalize flex-shrink-0">
                      {person.personType}
                    </Badge>
                  </Link>
                ))
              ) : (
                <EmptyState
                  icon={Users}
                  title="No people yet"
                  description="Assign a company to client people, or add people to this company from their profiles."
                />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-3">
                <ClipboardList className="text-muted-foreground" /> Open Commitments ({openTasks.length})
              </CardTitle>
              <CardDescription>
                Open tasks assigned to {company.name}&apos;s people, overdue first.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {openTasks.length ? (
                openTasks.map((task) => (
                  <div
                    key={task.id}
                    className="data-row flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-sm truncate">{task.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {task.assigneeName || 'Unassigned'}
                        {task.dueAt ? ` · Due ${formatShortDate(task.dueAt)}` : ' · No due date'}
                      </p>
                    </div>
                    {task.overdue ? (
                      <Badge variant="destructive">Overdue</Badge>
                    ) : (
                      <Badge variant="secondary" className="capitalize">{task.status}</Badge>
                    )}
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground py-4">
                  No open commitments for this company.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-3">
                <CalendarDays className="text-muted-foreground" /> Meetings ({meetings.length})
              </CardTitle>
              <CardDescription>
                Meetings matched by attendees, organizer, or the company domain.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {meetings.length ? (
                meetings.map((meeting) => (
                  <Link
                    key={meeting.id}
                    href={`/meetings/${meeting.id}`}
                    className="data-row flex items-center justify-between gap-4 px-4 py-3 hover:bg-muted/50 transition-colors"
                  >
                    <span className="font-medium text-sm truncate">{meeting.title}</span>
                    <span className="text-xs text-muted-foreground flex-shrink-0">
                      {formatShortDate(meeting.startTime) || 'No date'}
                    </span>
                  </Link>
                ))
              ) : (
                <p className="text-sm text-muted-foreground py-4">
                  No meetings recorded with this company yet.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <ProfileReportDialog
        isOpen={isReportOpen}
        onClose={() => setIsReportOpen(false)}
        endpoint={`/api/companies/${company.id}/report`}
        subjectName={company.name}
      />

      <Dialog open={isEditOpen} onOpenChange={(open) => !open && setIsEditOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit company</DialogTitle>
            <DialogDescription>
              Manual changes override domain inference for this account.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="company-name">Name</Label>
              <Input
                id="company-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="Company name"
              />
            </div>
            <div>
              <Label htmlFor="company-domain">Domain</Label>
              <Input
                id="company-domain"
                value={editDomain}
                onChange={(e) => setEditDomain(e.target.value)}
                placeholder="acme.com"
              />
            </div>
            <div>
              <Label htmlFor="company-aliases">Aliases (comma-separated)</Label>
              <Input
                id="company-aliases"
                value={editAliases}
                onChange={(e) => setEditAliases(e.target.value)}
                placeholder="Acme Corp, ACME Inc"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveCompany} disabled={isSaving || !editName.trim()}>
              {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
