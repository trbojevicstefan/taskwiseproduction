
// src/app/auth/slack/callback/page.tsx
"use client";

import { useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';


function SlackCallbackContent() {
  const searchParams = useSearchParams();

  useEffect(() => {
    const query = searchParams.toString();
    window.location.replace(`/api/slack/oauth/callback?${query}`);
  }, [searchParams]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-background p-4">
      <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
      <p className="text-lg text-muted-foreground">Finalizing Slack Connection...</p>
      <p className="text-sm text-muted-foreground">Please wait, this window will close automatically.</p>
    </div>
  );
}


export default function SlackCallbackPage() {
    return (
        <Suspense fallback={
            <div className="flex flex-col items-center justify-center min-h-screen bg-background p-4">
                <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
                <p className="text-lg text-muted-foreground">Loading...</p>
            </div>
        }>
            <SlackCallbackContent />
        </Suspense>
    );
}
