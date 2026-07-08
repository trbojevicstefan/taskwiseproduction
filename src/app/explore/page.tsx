// src/app/explore/page.tsx
import DashboardPageLayout from '@/components/layouts/DashboardPageLayout';
import CalendarPageContent from '@/components/dashboard/calendar/CalendarPageContent';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Calendar | TaskWiseAI',
  description: 'See what happened, what is due, and who needs a reminder.',
};

export default function ExplorePage() {
  return (
    <DashboardPageLayout>
        <CalendarPageContent />
    </DashboardPageLayout>
  );
}
