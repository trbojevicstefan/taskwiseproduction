
// src/app/planning/page.tsx
import DashboardPageLayout from '@/components/layouts/DashboardPageLayout';
import PlanningPageContent from '@/components/dashboard/planning/PlanningPageContent';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Planning | TaskWiseAI',
  description: 'Break down ideas into actionable plans and visualize them.',
};

export default function PlanningPage() {
  return (
    <DashboardPageLayout>
      <PlanningPageContent />
    </DashboardPageLayout>
  );
}
