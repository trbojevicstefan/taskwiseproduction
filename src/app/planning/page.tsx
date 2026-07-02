
// src/app/planning/page.tsx
import DashboardPageLayout from '@/components/layouts/DashboardPageLayout';
import PlanningWorkspacePageContent from '@/components/dashboard/planning/PlanningWorkspacePageContent';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Planning | TaskWiseAI',
  description: 'Turn upcoming meetings and open tasks into a practical plan.',
};

export default function PlanningPage() {
  return (
    <DashboardPageLayout>
      <PlanningWorkspacePageContent />
    </DashboardPageLayout>
  );
}
