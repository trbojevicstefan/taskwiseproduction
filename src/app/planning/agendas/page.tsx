
// src/app/planning/agendas/page.tsx
// The Google Calendar agenda-prep tool (Meeting Planner) — moved unchanged
// from /planning when the Phase 5 planning workspace took over that route.
import DashboardPageLayout from '@/components/layouts/DashboardPageLayout';
import MeetingPlannerPageContent from '@/components/dashboard/meetings/MeetingPlannerPageContent';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Meeting Agendas | TaskWiseAI',
  description: 'Prepare agendas for upcoming meetings and push them to Google Calendar.',
};

export default function MeetingAgendasPage() {
  return (
    <DashboardPageLayout>
      <MeetingPlannerPageContent />
    </DashboardPageLayout>
  );
}
