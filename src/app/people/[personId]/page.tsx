// src/app/people/[personId]/page.tsx
import DashboardPageLayout from '@/components/layouts/DashboardPageLayout';
import PersonDetailPageContent from '@/components/dashboard/people/PersonDetailPageContent';
import type { Metadata } from 'next';

// This is an example of generating metadata dynamically based on params
export async function generateMetadata({ params }: { params: Promise<{ personId: string }> }): Promise<Metadata> {
  const { personId } = await params;
  // In a real app, you would fetch person data here based on the personId
  // For now, we'll just use the ID in the title
  return {
    title: `Person Details | ${personId}`,
    description: `View all tasks and information for person ${personId}.`,
  };
}

export default async function PersonDetailPage({ params }: { params: Promise<{ personId: string }> }) {
  const { personId } = await params;
  return (
    <DashboardPageLayout>
      <PersonDetailPageContent personId={personId} />
    </DashboardPageLayout>
  );
}
