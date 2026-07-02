
// src/app/meetings/page.tsx
import DashboardPageLayout from '@/components/layouts/DashboardPageLayout';
import MeetingsPageContent from '@/components/dashboard/meetings/MeetingsPageContent';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Home | TaskWiseAI',
  description: 'Create task lists from meetings and review recent work.',
};

export default function MeetingsPage() {
  return (
    <DashboardPageLayout>
      <MeetingsPageContent />
    </DashboardPageLayout>
  );
}
