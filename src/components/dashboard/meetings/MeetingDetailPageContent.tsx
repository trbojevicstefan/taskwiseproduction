
// src/components/dashboard/meetings/MeetingDetailPageContent.tsx
"use client";

import React from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Video } from 'lucide-react';
import DashboardHeader from '../DashboardHeader';

// This page is now a transitional component.
// The primary detail view is the Sheet in MeetingsPageContent.
// This page can be used as a fallback or for direct linking in the future.

export default function MeetingDetailPageContent({ meetingId }: { meetingId: string }) {
  const router = useRouter();

  // Redirect back to the main meetings page, which will handle the detail view.
  // We could also pass a query param to auto-open the sheet, e.g., /meetings?open=meetingId
  React.useEffect(() => {
    router.replace('/meetings'); 
  }, [router, meetingId]);

  return (
    <div className="flex flex-col h-full">
      <DashboardHeader pageIcon={Video} pageTitle="Loading Meeting..." />
      <div className="flex-grow flex items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
        <p className="ml-3 text-muted-foreground">Redirecting to meetings view...</p>
      </div>
    </div>
  );
}
