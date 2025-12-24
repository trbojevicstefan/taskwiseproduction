// src/app/reports/page.tsx
import DashboardPageLayout from '@/components/layouts/DashboardPageLayout';
import ReportingPageContent from '@/components/dashboard/reports/ReportingPageContent';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Reports | TaskWiseAI',
  description: 'View reports and analytics for your tasks.',
};

export default function ReportsPage() {
  return (
    <DashboardPageLayout>
        <ReportingPageContent />
    </DashboardPageLayout>
  );
}
