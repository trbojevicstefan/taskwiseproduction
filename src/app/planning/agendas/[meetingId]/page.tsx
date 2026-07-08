// src/app/planning/agendas/[meetingId]/page.tsx
// Priority 12 — agenda workspace for one future meeting.
import DashboardPageLayout from '@/components/layouts/DashboardPageLayout';
import AgendaWorkspacePageContent from '@/components/dashboard/planning/AgendaWorkspacePageContent';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Agenda Workspace | TaskWiseAI',
  description: 'Prepare the agenda, attendees, and open work for a meeting.',
};

export default async function AgendaWorkspacePage({
  params,
}: {
  params: Promise<{ meetingId: string }>;
}) {
  const { meetingId } = await params;
  return (
    <DashboardPageLayout>
      <AgendaWorkspacePageContent meetingId={meetingId} />
    </DashboardPageLayout>
  );
}
