
// src/app/meetings/page.tsx
import DashboardPageLayout from '@/components/layouts/DashboardPageLayout';
import MeetingsPageContent from '@/components/dashboard/meetings/MeetingsPageContent';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Meetings | TaskWiseAI',
  description: 'Review and process your meeting transcripts.',
};

export default function MeetingsPage() {
  return (
    <DashboardPageLayout>
      <MeetingsPageContent />
    </DashboardPageLayout>
  );
}
