// src/app/reports/page.tsx
import DashboardPageLayout from '@/components/layouts/DashboardPageLayout';
import ReportsPageContent from '@/components/dashboard/reports/ReportsPageContent';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Reports | TaskWiseAI',
  description: 'Analytics and insights across meetings, tasks, and team performance.',
};

export default function ReportsPage() {
  return (
    <DashboardPageLayout>
        <ReportsPageContent />
    </DashboardPageLayout>
  );
}
