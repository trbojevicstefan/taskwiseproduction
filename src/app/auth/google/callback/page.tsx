
// src/app/auth/google/callback/page.tsx
"use client";

import { useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';

function GoogleCallbackContent() {
  const searchParams = useSearchParams();

  useEffect(() => {
    // This effect runs inside the popup window.
    const code = searchParams.get('code');
    const error = searchParams.get('error');

    if (window.opener) {
        if (code) {
            // Send a success message to the parent window
            window.opener.postMessage({ type: 'googleAuthSuccess', code: code }, window.location.origin);
        } else if (error) {
            // Send an error message to the parent window
            window.opener.postMessage({ type: 'googleAuthError', message: error }, window.location.origin);
        }
        // The parent window is responsible for closing the popup,
        // but we can add a fallback close for safety.
         setTimeout(() => window.close(), 500);
    }

  }, [searchParams]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-background p-4">
      <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
      <p className="text-lg text-muted-foreground">Finalizing Google Connection...</p>
      <p className="text-sm text-muted-foreground">Please wait, this window will close automatically.</p>
    </div>
  );
}

export default function GoogleCallbackPage() {
  return (
    <Suspense fallback={
      <div className="flex flex-col items-center justify-center min-h-screen bg-background p-4">
        <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
        <p className="text-lg text-muted-foreground">Loading...</p>
      </div>
    }>
      <GoogleCallbackContent />
    </Suspense>
  );
}
