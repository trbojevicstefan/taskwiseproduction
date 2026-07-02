// src/app/explore/page.tsx
import DashboardPageLayout from '@/components/layouts/DashboardPageLayout';
import ExplorePageContent from '@/components/dashboard/explore/ExplorePageContent';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Explore | TaskWiseAI',
  description: 'Visually explore and interact with your sessions and tasks over time.',
};

export default function ExplorePage() {
  return (
    <DashboardPageLayout>
        <ExplorePageContent />
    </DashboardPageLayout>
  );
}
