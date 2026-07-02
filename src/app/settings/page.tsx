// src/app/settings/page.tsx
import DashboardPageLayout from '@/components/layouts/DashboardPageLayout';
import SettingsPageContent from '@/components/dashboard/settings/SettingsPageContent';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Settings | TaskWiseAI',
  description: 'Manage your account and application settings.',
};

export default function SettingsPage() {
  return (
    <DashboardPageLayout>
        <SettingsPageContent />
    </DashboardPageLayout>
  );
}
