
// src/app/planning/page.tsx
import DashboardPageLayout from '@/components/layouts/DashboardPageLayout';
import MeetingPlannerPageContent from '@/components/dashboard/meetings/MeetingPlannerPageContent';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Meeting Planner | TaskWiseAI',
  description: 'Plan upcoming meetings, align tasks, and prepare agendas.',
};

export default function PlanningPage() {
  return (
    <DashboardPageLayout>
      <MeetingPlannerPageContent />
    </DashboardPageLayout>
  );
}
