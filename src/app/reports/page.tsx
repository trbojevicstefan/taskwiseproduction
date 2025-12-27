// src/app/reports/page.tsx
import DashboardPageLayout from '@/components/layouts/DashboardPageLayout';
import MeetingPlannerPageContent from '@/components/dashboard/meetings/MeetingPlannerPageContent';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Meeting Planner | TaskWiseAI',
  description: 'Plan upcoming meetings with Taskwise agendas.',
};

export default function ReportsPage() {
  return (
    <DashboardPageLayout>
        <MeetingPlannerPageContent />
    </DashboardPageLayout>
  );
}
