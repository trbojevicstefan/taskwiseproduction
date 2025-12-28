
// src/app/meetings/[meetingId]/page.tsx
import DashboardPageLayout from '@/components/layouts/DashboardPageLayout';
import MeetingDetailPageContent from '@/components/dashboard/meetings/MeetingDetailPageContent';
import type { Metadata } from 'next';

export async function generateMetadata({ params }: { params: Promise<{ meetingId: string }> }): Promise<Metadata> {
  const { meetingId } = await params;
  // In a real app, you might fetch the meeting title here.
  // For now, we'll just use the ID.
  return {
    title: `Meeting Details | ${meetingId}`,
    description: `Review the summary, attendees, and action items for meeting ${meetingId}.`,
  };
}

export default async function MeetingDetailPage({ params }: { params: Promise<{ meetingId: string }> }) {
  const { meetingId } = await params;
  return (
    <DashboardPageLayout>
      <MeetingDetailPageContent meetingId={meetingId} />
    </DashboardPageLayout>
  );
}
