
// src/app/meetings/[meetingId]/page.tsx
import DashboardPageLayout from '@/components/layouts/DashboardPageLayout';
import MeetingDetailPageContent from '@/components/dashboard/meetings/MeetingDetailPageContent';
import type { Metadata } from 'next';

export async function generateMetadata({ params }: { params: { meetingId: string } }): Promise<Metadata> {
  // In a real app, you might fetch the meeting title here.
  // For now, we'll just use the ID.
  return {
    title: `Meeting Details | ${params.meetingId}`,
    description: `Review the summary, attendees, and action items for meeting ${params.meetingId}.`,
  };
}

export default function MeetingDetailPage({ params }: { params: { meetingId: string } }) {
  return (
    <DashboardPageLayout>
      <MeetingDetailPageContent meetingId={params.meetingId} />
    </DashboardPageLayout>
  );
}
