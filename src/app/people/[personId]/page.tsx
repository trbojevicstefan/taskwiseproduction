// src/app/people/[personId]/page.tsx
import DashboardPageLayout from '@/components/layouts/DashboardPageLayout';
import PersonDetailPageContent from '@/components/dashboard/people/PersonDetailPageContent';
import type { Metadata } from 'next';

// This is an example of generating metadata dynamically based on params
export async function generateMetadata({ params }: { params: { personId: string } }): Promise<Metadata> {
  // In a real app, you would fetch person data here based on the personId
  // For now, we'll just use the ID in the title
  return {
    title: `Person Details | ${params.personId}`,
    description: `View all tasks and information for person ${params.personId}.`,
  };
}

export default function PersonDetailPage({ params }: { params: { personId: string } }) {
  return (
    <DashboardPageLayout>
      <PersonDetailPageContent personId={params.personId} />
    </DashboardPageLayout>
  );
}
