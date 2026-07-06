// src/app/clients/[companyId]/page.tsx
import DashboardPageLayout from '@/components/layouts/DashboardPageLayout';
import CompanyDetailPageContent from '@/components/dashboard/clients/CompanyDetailPageContent';
import type { Metadata } from 'next';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ companyId: string }>;
}): Promise<Metadata> {
  const { companyId } = await params;
  return {
    title: `Company Profile | ${companyId}`,
    description: `People, meetings, and open commitments for company ${companyId}.`,
  };
}

export default async function CompanyDetailPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  return (
    <DashboardPageLayout>
      <CompanyDetailPageContent companyId={companyId} />
    </DashboardPageLayout>
  );
}
