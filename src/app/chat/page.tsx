// src/app/chat/page.tsx
import DashboardPageLayout from '@/components/layouts/DashboardPageLayout';
import ChatPageContent from '@/components/dashboard/chat/ChatPageContent';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Chat | TaskWiseAI',
  description: 'Chat with AI to manage your tasks.',
};

export default function ChatPage() {
  return (
    <DashboardPageLayout>
      <ChatPageContent />
    </DashboardPageLayout>
  );
}
