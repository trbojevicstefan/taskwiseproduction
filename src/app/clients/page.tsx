// src/app/clients/page.tsx
import DashboardPageLayout from '@/components/layouts/DashboardPageLayout';
import ClientsPageContent from '@/components/dashboard/clients/ClientsPageContent';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Clients | TaskWiseAI',
  description: 'See which external people and companies are waiting on you.',
};

export default function ClientsPage() {
  return (
    <DashboardPageLayout>
      <ClientsPageContent />
    </DashboardPageLayout>
  );
}
