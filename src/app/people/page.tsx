// src/app/people/page.tsx
import DashboardPageLayout from '@/components/layouts/DashboardPageLayout';
import PeoplePageContent from '@/components/dashboard/people/PeoplePageContent';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'People | TaskWiseAI',
  description: 'Manage people and view their assigned tasks.',
};

export default function PeoplePage() {
  return (
    <DashboardPageLayout>
        <PeoplePageContent />
    </DashboardPageLayout>
  );
}
