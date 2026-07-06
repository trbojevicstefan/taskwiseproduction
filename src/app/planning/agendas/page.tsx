
// src/app/planning/agendas/page.tsx
// Priority 12 — the agenda entry point: upcoming meetings that need an agenda
// (linking into the agenda workspace at /planning/agendas/[meetingId]) plus
// the existing Google Calendar Meeting Planner below it, unchanged.
import DashboardPageLayout from '@/components/layouts/DashboardPageLayout';
import AgendaInbox from '@/components/dashboard/planning/AgendaInbox';
import MeetingPlannerPageContent from '@/components/dashboard/meetings/MeetingPlannerPageContent';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Meeting Agendas | TaskWiseAI',
  description: 'Prepare agendas for upcoming meetings and push them to Google Calendar.',
};

export default function MeetingAgendasPage() {
  return (
    <DashboardPageLayout>
      <div className="flex h-full min-h-0 flex-col overflow-y-auto">
        <AgendaInbox />
        <div className="min-h-0 flex-1">
          <MeetingPlannerPageContent />
        </div>
      </div>
    </DashboardPageLayout>
  );
}
